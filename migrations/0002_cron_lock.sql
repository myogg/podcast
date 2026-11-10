CREATE TABLE IF NOT EXISTS cron_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  lease_until INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO cron_lock (id, lease_until) VALUES (1, 0);
