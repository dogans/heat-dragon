const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'heat-dragon.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  postcode TEXT NOT NULL,
  type TEXT NOT NULL,
  when_needed TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','waitlist','declined','quoted','deposit','scheduled','done')),
  quote_amount TEXT,
  quote_est TEXT,
  quote_sent_at TEXT,
  deposit_at TEXT,
  waitlist_note TEXT,
  decline_reason TEXT
);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enquiry_id INTEGER NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  date TEXT NOT NULL,
  van INTEGER NOT NULL CHECK (van IN (1,2)),
  slot TEXT NOT NULL CHECK (slot IN ('AM','PM')),
  label TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'job' CHECK (kind IN ('job','buffer','manual')),
  enquiry_id INTEGER REFERENCES enquiries(id) ON DELETE SET NULL,
  UNIQUE (date, van, slot)
);

CREATE INDEX IF NOT EXISTS idx_enquiries_status ON enquiries(status);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
`);

module.exports = { db, DATA_DIR, UPLOAD_DIR };
