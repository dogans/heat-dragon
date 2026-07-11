const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { db, DATA_DIR, UPLOAD_DIR } = require('./db');

const PORT = process.env.PORT || 8787;

// Admin token: from env, or generated once and kept in data/token.txt
const tokenFile = path.join(DATA_DIR, 'token.txt');
let ADMIN_TOKEN = process.env.ADMIN_TOKEN;
if (!ADMIN_TOKEN) {
  if (fs.existsSync(tokenFile)) {
    ADMIN_TOKEN = fs.readFileSync(tokenFile, 'utf8').trim();
  } else {
    ADMIN_TOKEN = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(tokenFile, ADMIN_TOKEN + '\n', { mode: 0o600 });
  }
}

const app = express();
app.use(express.json());
app.use(cors()); // the public enquiry POST comes cross-origin from the website

// ---------- uploads ----------
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const safeExt = (path.extname(file.originalname) || '.jpg').toLowerCase().slice(0, 8);
    cb(null, crypto.randomBytes(8).toString('hex') + safeExt);
  }
});
const upload = multer({
  storage,
  limits: { files: 5, fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype))
});

// ---------- naive rate limit for the public endpoint ----------
const hits = new Map(); // ip -> [timestamps]
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 60 * 60 * 1000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 10;
}

// ---------- auth ----------
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.t;
  if (token === ADMIN_TOKEN) return next();
  res.status(401).json({ error: 'unauthorised' });
}

// ---------- push notifications (ntfy.sh) ----------
// Set NTFY_TOPIC to a long secret string (e.g. heat-dragon-x7k2p9), then
// subscribe to that topic in the ntfy app on both phones. New enquiries ping
// the phones even when the ops app is closed. Unset = silently disabled.
const NTFY_TOPIC = process.env.NTFY_TOPIC;
function notifyNewEnquiry(e, photoCount) {
  if (!NTFY_TOPIC) return;
  fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
    method: 'POST',
    headers: { 'Title': 'New enquiry - Heat Dragon', 'Priority': 'high', 'Tags': 'wrench' },
    body: `${e.name} · ${e.postcode} · ${e.type} · wants: ${e.when || '—'} · ${photoCount} photo${photoCount === 1 ? '' : 's'}`
  }).catch(() => {}); // never let a notification failure break an enquiry
}

// ---------- public: enquiry from the website ----------
app.post('/api/enquiries', upload.array('photos', 5), (req, res) => {
  if (rateLimited(req.ip)) return res.status(429).json({ error: 'too many requests' });

  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot field — bots fill it, humans never see it

  const required = ['name', 'phone', 'postcode', 'type'];
  for (const k of required) {
    if (!b[k] || !String(b[k]).trim()) return res.status(400).json({ error: `missing ${k}` });
  }
  const clean = k => String(b[k] || '').trim().slice(0, 2000);

  const info = db.prepare(`
    INSERT INTO enquiries (name, phone, email, postcode, type, when_needed, message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(clean('name'), clean('phone'), clean('email'), clean('postcode').toUpperCase(),
         clean('type'), clean('when'), clean('message'));

  const insertPhoto = db.prepare('INSERT INTO photos (enquiry_id, filename, original_name) VALUES (?, ?, ?)');
  for (const f of req.files || []) insertPhoto.run(info.lastInsertRowid, f.filename, f.originalname);

  notifyNewEnquiry({
    name: clean('name'), postcode: clean('postcode').toUpperCase(),
    type: clean('type'), when: clean('when')
  }, (req.files || []).length);

  res.json({ ok: true, id: info.lastInsertRowid });
});

// ---------- authed API for the ops app ----------
const photosFor = db.prepare('SELECT filename FROM photos WHERE enquiry_id = ?');

function withPhotos(row) {
  return { ...row, photos: photosFor.all(row.id).map(p => p.filename) };
}

app.get('/api/state', auth, (_req, res) => {
  const byStatus = s => db.prepare('SELECT * FROM enquiries WHERE status = ? ORDER BY id DESC').all(s);
  const bookings = db.prepare('SELECT * FROM bookings ORDER BY date, van, slot').all();
  res.json({
    enquiries: byStatus('new').map(withPhotos),
    waitlist: byStatus('waitlist'),
    quoted: byStatus('quoted').map(withPhotos),
    deposit: byStatus('deposit').map(withPhotos),
    sched: byStatus('scheduled').map(e => {
      const bk = bookings.find(x => x.enquiry_id === e.id);
      return { ...e, booking: bk || null };
    }),
    bookings
  });
});

function getEnquiry(id) {
  return db.prepare('SELECT * FROM enquiries WHERE id = ?').get(id);
}
function setStatus(id, status, extra = {}) {
  const cols = Object.keys(extra).map(k => `${k} = ?`).join(', ');
  const sql = `UPDATE enquiries SET status = ?, updated_at = datetime('now')${cols ? ', ' + cols : ''} WHERE id = ?`;
  db.prepare(sql).run(status, ...Object.values(extra), id);
}

app.post('/api/enquiries/:id/quote', auth, (req, res) => {
  const e = getEnquiry(req.params.id);
  if (!e) return res.status(404).json({ error: 'not found' });
  const { amount, est } = req.body || {};
  if (!amount || !String(amount).trim()) return res.status(400).json({ error: 'missing amount' });
  setStatus(e.id, 'quoted', {
    quote_amount: String(amount).trim().slice(0, 40),
    quote_est: String(est || '').trim().slice(0, 80),
    quote_sent_at: new Date().toISOString()
  });
  res.json({ ok: true });
});

app.post('/api/enquiries/:id/waitlist', auth, (req, res) => {
  const e = getEnquiry(req.params.id);
  if (!e) return res.status(404).json({ error: 'not found' });
  setStatus(e.id, 'waitlist', { waitlist_note: String((req.body || {}).note || '').trim().slice(0, 300) });
  res.json({ ok: true });
});

app.post('/api/enquiries/:id/pass', auth, (req, res) => {
  const e = getEnquiry(req.params.id);
  if (!e) return res.status(404).json({ error: 'not found' });
  setStatus(e.id, 'declined', { decline_reason: String((req.body || {}).reason || '').trim().slice(0, 100) });
  res.json({ ok: true });
});

app.post('/api/enquiries/:id/deposit', auth, (req, res) => {
  const e = getEnquiry(req.params.id);
  if (!e) return res.status(404).json({ error: 'not found' });
  if (e.status !== 'quoted') return res.status(400).json({ error: 'not in quoted state' });
  setStatus(e.id, 'deposit', { deposit_at: new Date().toISOString() });
  res.json({ ok: true });
});

app.post('/api/enquiries/:id/schedule', auth, (req, res) => {
  const e = getEnquiry(req.params.id);
  if (!e) return res.status(404).json({ error: 'not found' });
  if (e.status !== 'deposit') return res.status(400).json({ error: 'not in deposit state' });
  const { date, van, slot } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || ![1, 2].includes(van) || !['AM', 'PM'].includes(slot)) {
    return res.status(400).json({ error: 'bad slot' });
  }
  try {
    db.prepare('INSERT INTO bookings (date, van, slot, label, kind, enquiry_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(date, van, slot, `${e.type} — ${e.name}`, 'job', e.id);
  } catch {
    return res.status(409).json({ error: 'slot taken' });
  }
  setStatus(e.id, 'scheduled');
  res.json({ ok: true });
});

app.post('/api/bookings', auth, (req, res) => {
  const { date, van, slot, label, kind } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || ![1, 2].includes(van) || !['AM', 'PM'].includes(slot)) {
    return res.status(400).json({ error: 'bad slot' });
  }
  const k = kind === 'buffer' ? 'buffer' : 'manual';
  const text = k === 'buffer' ? 'Buffer — kept free' : String(label || '').trim().slice(0, 120);
  if (!text) return res.status(400).json({ error: 'missing label' });
  try {
    const info = db.prepare('INSERT INTO bookings (date, van, slot, label, kind) VALUES (?, ?, ?, ?, ?)')
      .run(date, van, slot, text, k);
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch {
    res.status(409).json({ error: 'slot taken' });
  }
});

app.delete('/api/bookings/:id', auth, (req, res) => {
  const bk = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!bk) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM bookings WHERE id = ?').run(bk.id);
  // a scheduled job whose slot is removed goes back to "deposit paid — needs a date"
  if (bk.enquiry_id) setStatus(bk.enquiry_id, 'deposit');
  res.json({ ok: true });
});

app.get('/api/photos/:enquiryId/:filename', auth, (req, res) => {
  const row = db.prepare('SELECT filename FROM photos WHERE enquiry_id = ? AND filename = ?')
    .get(req.params.enquiryId, path.basename(req.params.filename));
  if (!row) return res.status(404).end();
  res.sendFile(path.join(UPLOAD_DIR, row.filename));
});

// ---------- ops app frontend ----------
app.use(express.static(path.join(__dirname, '..', 'ops')));

// ---------- customer site at /site (demo convenience) ----------
// One host demos the whole loop: /site is the customer site with its form
// wired to this backend. Production stays on static hosting with an absolute
// FORM_ENDPOINT — this route just saves running a second server for demos.
const SITE_DIR = path.join(__dirname, '..', 'site');
app.get(['/site', '/site/'], (_req, res) => {
  const html = fs.readFileSync(path.join(SITE_DIR, 'index.html'), 'utf8')
    .replace("const FORM_ENDPOINT = ''", "const FORM_ENDPOINT = '/api/enquiries'");
  res.type('html').send(html);
});
app.use('/site', express.static(SITE_DIR));

app.listen(PORT, () => {
  console.log(`Heat Dragon backend on http://localhost:${PORT}`);
  console.log(`Ops app:       http://localhost:${PORT}/`);
  console.log(`Customer site: http://localhost:${PORT}/site`);
  console.log(`Admin token:   ${ADMIN_TOKEN}`);
  console.log(`Notifications: ${NTFY_TOPIC ? 'ntfy.sh → ' + NTFY_TOPIC : 'off — set NTFY_TOPIC to enable'}`);
});
