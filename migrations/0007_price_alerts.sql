CREATE TABLE IF NOT EXISTS price_alerts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  symbol TEXT NOT NULL CHECK(length(symbol) BETWEEN 1 AND 15),
  currency TEXT NOT NULL CHECK(currency IN ('USD', 'CAD')),
  direction TEXT NOT NULL CHECK(direction IN ('above', 'below')),
  target_price REAL NOT NULL CHECK(target_price > 0 AND target_price <= 1000000000),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'triggered')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  triggered_at TEXT,
  triggered_price REAL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_price_alerts_user_status
ON price_alerts(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_price_alerts_match
ON price_alerts(user_id, symbol, currency, status);
