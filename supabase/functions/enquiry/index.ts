// Public endpoint for the website quote form. Validates, stores the enquiry
// and its photos, pings ntfy if configured. Deploy with --no-verify-jwt so
// customers can post without a token; the honeypot field filters bots.
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: 'expected form data' }, 400);
  }
  const get = (k: string) => String(form.get(k) ?? '').trim().slice(0, 2000);

  if (get('website')) return json({ ok: true }); // honeypot — bots fill it, humans never see it

  for (const k of ['name', 'phone', 'postcode', 'type']) {
    if (!get(k)) return json({ error: `missing ${k}` }, 400);
  }

  const { data: enq, error } = await supabase
    .from('enquiries')
    .insert({
      name: get('name'),
      phone: get('phone'),
      email: get('email') || null,
      postcode: get('postcode').toUpperCase(),
      type: get('type'),
      when_needed: get('when'),
      message: get('message')
    })
    .select('id')
    .single();
  if (error) return json({ error: 'could not save enquiry' }, 500);

  let photoCount = 0;
  const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0).slice(0, 5);
  for (const f of files) {
    if (!f.type.startsWith('image/') || f.size > 10 * 1024 * 1024) continue;
    const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().slice(0, 8);
    const path = `${enq.id}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('photos').upload(path, f, { contentType: f.type });
    if (!upErr) {
      await supabase.from('photos').insert({ enquiry_id: enq.id, path, original_name: f.name });
      photoCount++;
    }
  }

  const topic = Deno.env.get('NTFY_TOPIC');
  if (topic) {
    fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: { 'Title': 'New enquiry - Heat Dragon', 'Priority': 'high', 'Tags': 'wrench' },
      body: `${get('name')} · ${get('postcode').toUpperCase()} · ${get('type')} · wants: ${get('when') || '—'} · ${photoCount} photo${photoCount === 1 ? '' : 's'}`
    }).catch(() => {});
  }

  return json({ ok: true, id: enq.id });
});
