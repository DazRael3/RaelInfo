CREATE TABLE IF NOT EXISTS provider_throttles (
  provider_key TEXT PRIMARY KEY NOT NULL,
  next_allowed_at INTEGER NOT NULL
);
