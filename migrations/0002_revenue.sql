-- RaelInfo revenue measurement and product-interest schema.
-- No calculator inputs, portfolio values, IP addresses, or user-level advertising identifiers are stored here.

CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id TEXT PRIMARY KEY NOT NULL,
  offer_id TEXT NOT NULL,
  partner_name TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('US', 'CA')),
  category TEXT NOT NULL,
  placement TEXT NOT NULL,
  clicked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_date
  ON affiliate_clicks(clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_offer_market
  ON affiliate_clicks(offer_id, market, clicked_at DESC);

CREATE TABLE IF NOT EXISTS affiliate_conversions (
  id TEXT PRIMARY KEY NOT NULL,
  offer_id TEXT NOT NULL,
  partner_name TEXT NOT NULL,
  external_ref TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('US', 'CA')),
  commission_amount REAL NOT NULL CHECK (commission_amount >= 0),
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'CAD')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'reversed')),
  conversion_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (offer_id, external_ref)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_conversions_date
  ON affiliate_conversions(conversion_date DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_conversions_offer
  ON affiliate_conversions(offer_id, status, currency);

CREATE TABLE IF NOT EXISTS daily_site_events (
  event_date TEXT NOT NULL,
  event_name TEXT NOT NULL,
  category TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('US', 'CA')),
  event_count INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  PRIMARY KEY (event_date, event_name, category, market)
);

CREATE TABLE IF NOT EXISTS pro_interest (
  user_id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'withdrawn')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS business_inquiries (
  id TEXT PRIMARY KEY NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  organization TEXT NOT NULL,
  inquiry_type TEXT NOT NULL CHECK (inquiry_type IN ('affiliate', 'sponsorship', 'calculator_licensing', 'other')),
  website TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  consent INTEGER NOT NULL CHECK (consent = 1),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'contacted', 'closed')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_business_inquiries_status_date
  ON business_inquiries(status, created_at DESC);
