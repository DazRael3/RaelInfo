CREATE TABLE IF NOT EXISTS account_deletion_pending (
  user_id TEXT PRIMARY KEY NOT NULL,
  requested_at TEXT NOT NULL
);
