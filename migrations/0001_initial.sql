-- RaelInfo production schema.
-- Supabase Auth owns password credentials and login sessions.
-- D1 stores the RaelInfo user profile, per-user portfolio positions, API cache and hashed rate-limit buckets.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolio_positions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  shares REAL NOT NULL CHECK (shares > 0),
  average_cost REAL NOT NULL CHECK (average_cost >= 0),
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'CAD')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_portfolio_user_created
  ON portfolio_positions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_cache (
  cache_key TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_provider_cache_expires
  ON provider_cache(expires_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window
  ON rate_limits(window_start);
