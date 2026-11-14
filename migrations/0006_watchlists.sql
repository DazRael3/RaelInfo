CREATE TABLE IF NOT EXISTS watchlists (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(user_id,name),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_watchlists_user_updated ON watchlists(user_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS watchlist_items (
 id TEXT PRIMARY KEY NOT NULL,
 watchlist_id TEXT NOT NULL,
 symbol TEXT NOT NULL CHECK(length(symbol) BETWEEN 1 AND 15),
 created_at TEXT NOT NULL,
 UNIQUE(watchlist_id,symbol),
 FOREIGN KEY(watchlist_id) REFERENCES watchlists(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_watchlist_items_list_created ON watchlist_items(watchlist_id,created_at);
