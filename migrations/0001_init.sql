CREATE TABLE IF NOT EXISTS episodes (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_url TEXT NOT NULL UNIQUE,
  published_at TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('baseline', 'pending', 'processing', 'published', 'failed')),
  audio_key TEXT,
  audio_bytes INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_episodes_status_published
  ON episodes(status, published_at ASC);

CREATE INDEX IF NOT EXISTS idx_episodes_published_date
  ON episodes(published_at DESC);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
