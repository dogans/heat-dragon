// Demo data for trying the ops app locally. Never run against real data:
// it refuses if the database already has enquiries.
const { db } = require('./db');

if (db.prepare('SELECT COUNT(*) AS n FROM enquiries').get().n > 0) {
  console.error('Database is not empty — refusing to seed.');
  process.exit(1);
}

const enq = db.prepare(`
  INSERT INTO enquiries (name, phone, email, postcode, type, when_needed, message, status, quote_amount, quote_est, deposit_at, waitlist_note)
  VALUES (@name, @phone, @email, @postcode, @type, @when, @message, @status, @amount, @est, @deposit_at, @note)
`);

const rows = [
  { name: 'Sophie R.', phone: '07700900001', email: 'sophie@example.com', postcode: 'SW4 7QT', type: 'Boiler installation', when: 'As soon as possible', message: 'Our old Baxi is cutting out daily and the pressure keeps dropping. Two-bed flat, boiler is in the kitchen cupboard.', status: 'new', amount: null, est: null, deposit_at: null, note: null },
  { name: 'Tom W.', phone: '07700900002', email: 'tom@example.com', postcode: 'SE15 4AB', type: 'Bathroom renovation', when: '1–3 months', message: 'Full refit of the family bathroom. We already have tiles and a suite picked out, need everything fitted properly.', status: 'new', amount: null, est: null, deposit_at: null, note: null },
  { name: 'Priya K.', phone: '07700900003', email: 'priya@example.com', postcode: 'CR0 5DJ', type: 'Leak or repair', when: 'As soon as possible', message: 'Slow drip under the kitchen sink, tightened it myself but it keeps coming back.', status: 'new', amount: null, est: null, deposit_at: null, note: null },
  { name: 'Mrs Aydın', phone: '07700900004', email: null, postcode: 'SW16 3PQ', type: 'Central heating / radiators', when: 'Just planning ahead', message: '4 radiators + TRVs.', status: 'waitlist', amount: null, est: null, deposit_at: null, note: 'Flexible, autumn is fine' },
  { name: 'Gary P.', phone: '07700900005', email: 'gary@example.com', postcode: 'SW2 1AA', type: 'Boiler installation', when: 'Within a month', message: 'Combi swap + flue re-route.', status: 'quoted', amount: '£2,450', est: '~3 days work', deposit_at: null, note: null },
  { name: 'Louise H.', phone: '07700900006', email: 'louise@example.com', postcode: 'SE21 2BB', type: 'Unvented cylinder', when: 'Within a month', message: 'Unvented cylinder, loft install.', status: 'deposit', amount: '£3,100', est: '1 day', deposit_at: new Date().toISOString(), note: null }
];
rows.forEach(r => enq.run(r));

// This week's buffers: Wednesday + Friday PM, both vans
const monday = new Date();
monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
const isoDay = offset => {
  const d = new Date(monday);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};
const bk = db.prepare('INSERT OR IGNORE INTO bookings (date, van, slot, label, kind) VALUES (?, ?, ?, ?, ?)');
for (const van of [1, 2]) {
  bk.run(isoDay(2), van, 'PM', 'Buffer — kept free', 'buffer');
  bk.run(isoDay(4), van, 'PM', 'Buffer — kept free', 'buffer');
}
bk.run(isoDay(1), 1, 'AM', 'Boiler service — SW4', 'manual');

console.log('Seeded demo data.');
