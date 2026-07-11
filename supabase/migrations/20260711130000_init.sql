-- Heat Dragon schema: enquiries in, quotes out, deposits before dates.

create table public.enquiries (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  phone text not null,
  email text,
  postcode text not null,
  type text not null,
  when_needed text,
  message text,
  status text not null default 'new'
    check (status in ('new','waitlist','declined','quoted','deposit','scheduled','done')),
  quote_amount text,
  quote_est text,
  quote_sent_at timestamptz,
  deposit_at timestamptz,
  waitlist_note text,
  decline_reason text
);

create table public.photos (
  id bigint generated always as identity primary key,
  enquiry_id bigint not null references public.enquiries(id) on delete cascade,
  path text not null,
  original_name text
);

create table public.bookings (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  date date not null,
  van int not null check (van in (1,2)),
  slot text not null check (slot in ('AM','PM')),
  label text not null,
  kind text not null default 'job' check (kind in ('job','buffer','manual')),
  enquiry_id bigint references public.enquiries(id) on delete set null,
  unique (date, van, slot)
);

create index idx_enquiries_status on public.enquiries(status);
create index idx_bookings_date on public.bookings(date);

-- Row level security: only signed-in staff touch data.
-- The website form never talks to these tables directly — it goes through
-- the `enquiry` edge function, which uses the service role.
alter table public.enquiries enable row level security;
alter table public.photos enable row level security;
alter table public.bookings enable row level security;

create policy "staff full access" on public.enquiries
  for all to authenticated using (true) with check (true);
create policy "staff full access" on public.photos
  for all to authenticated using (true) with check (true);
create policy "staff full access" on public.bookings
  for all to authenticated using (true) with check (true);

-- Private bucket for enquiry photos; staff read via signed URLs,
-- uploads happen in the edge function with the service role.
insert into storage.buckets (id, name, public) values ('photos', 'photos', false);

create policy "staff can view photos" on storage.objects
  for select to authenticated using (bucket_id = 'photos');
