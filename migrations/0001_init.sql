-- Revotech Asset Tag Manager — skema asas (D1 / SQLite)
-- Semua cap masa disimpan sebagai ISO-8601 UTC yang dijana oleh Worker.

CREATE TABLE IF NOT EXISTS zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  rev INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id INTEGER NOT NULL REFERENCES zones(id),
  name TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL,
  UNIQUE (zone_id, name)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'operator', 'viewer')),
  zone_id INTEGER REFERENCES zones(id),
  team_id INTEGER REFERENCES teams(id),
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS substations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id INTEGER NOT NULL REFERENCES zones(id),
  name TEXT NOT NULL,
  code TEXT NOT NULL COLLATE NOCASE,
  functional_location TEXT,
  lat REAL,
  lng REAL,
  is_sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (zone_id, code)
);

CREATE TABLE IF NOT EXISTS poles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_code TEXT NOT NULL UNIQUE,
  zone_id INTEGER NOT NULL REFERENCES zones(id),
  substation_id INTEGER NOT NULL REFERENCES substations(id),
  team_id INTEGER REFERENCES teams(id),
  no_tiang_rondaan TEXT NOT NULL,
  no_tiang_lama TEXT,
  street TEXT,
  pole_type TEXT,
  material TEXT,
  height_m REAL,
  install_year INTEGER,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  prev_pole_id INTEGER,
  status TEXT NOT NULL DEFAULT 'baru' CHECK (status IN ('baru', 'ok', 'defect', 'sedang', 'selesai')),
  open_defects INTEGER NOT NULL DEFAULT 0,
  total_defects INTEGER NOT NULL DEFAULT 0,
  last_rondaan_at TEXT,
  photo_id INTEGER,
  notes TEXT,
  is_sample INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_by_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (substation_id, no_tiang_rondaan)
);
CREATE INDEX IF NOT EXISTS idx_poles_zone ON poles(zone_id, deleted_at);

CREATE TABLE IF NOT EXISTS defects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  pole_id INTEGER NOT NULL REFERENCES poles(id),
  zone_id INTEGER NOT NULL REFERENCES zones(id),
  category TEXT NOT NULL,
  task_type TEXT NOT NULL CHECK (task_type IN ('T1', 'T2', 'RENTIS', 'CAT')),
  severity TEXT NOT NULL DEFAULT 'sederhana' CHECK (severity IN ('rendah', 'sederhana', 'tinggi')),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'belum' CHECK (status IN ('belum', 'sedang', 'selesai', 'disahkan')),
  assigned_team_id INTEGER REFERENCES teams(id),
  reported_by INTEGER,
  reported_by_name TEXT,
  reported_at TEXT NOT NULL,
  started_by INTEGER,
  started_at TEXT,
  completed_by INTEGER,
  completed_by_name TEXT,
  completed_at TEXT,
  verified_by INTEGER,
  verified_by_name TEXT,
  verified_at TEXT,
  is_sample INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_defects_pole ON defects(pole_id);
CREATE INDEX IF NOT EXISTS idx_defects_zone ON defects(zone_id, status);

-- Log kitar hayat (append-only): setiap stage tiang / defect direkod di sini.
CREATE TABLE IF NOT EXISTS stage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pole_id INTEGER NOT NULL REFERENCES poles(id),
  zone_id INTEGER NOT NULL,
  defect_id INTEGER,
  stage TEXT NOT NULL,
  actor_id INTEGER,
  actor_name TEXT,
  note TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_pole ON stage_events(pole_id, at);
CREATE INDEX IF NOT EXISTS idx_events_zone ON stage_events(zone_id, at);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pole_id INTEGER NOT NULL REFERENCES poles(id),
  defect_id INTEGER,
  stage_event_id INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('profil', 'rondaan', 'sebelum', 'selepas')),
  r2_key TEXT NOT NULL,
  thumb_key TEXT,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_by INTEGER,
  uploaded_by_name TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_pole ON photos(pole_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  actor_name TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  detail TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
