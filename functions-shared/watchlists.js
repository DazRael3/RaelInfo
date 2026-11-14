export function normalizeWatchlistName(value) {
  const raw = String(value ?? '');

  // Reject control characters before whitespace normalization.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;

  const name = raw.trim().replace(/\s+/g, ' ');
  return name.length >= 1 && name.length <= 40 ? name : null;
}

export function normalizeWatchlistSymbol(value) {
  const symbol = String(value ?? '').trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(symbol) ? symbol : null;
}