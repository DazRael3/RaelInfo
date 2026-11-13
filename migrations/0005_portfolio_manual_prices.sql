-- Persist user-entered portfolio prices without relying on an external quote provider.
ALTER TABLE portfolio_positions
  ADD COLUMN current_price REAL
  CHECK (current_price IS NULL OR (current_price > 0 AND current_price <= 1000000000));

ALTER TABLE portfolio_positions
  ADD COLUMN price_updated_at TEXT;