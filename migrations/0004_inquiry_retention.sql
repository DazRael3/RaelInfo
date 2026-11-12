ALTER TABLE business_inquiries
  ADD COLUMN legal_hold INTEGER NOT NULL DEFAULT 0 CHECK (legal_hold IN (0, 1));

ALTER TABLE business_inquiries
  ADD COLUMN legal_hold_reason TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_business_inquiries_retention
  ON business_inquiries(legal_hold, created_at);