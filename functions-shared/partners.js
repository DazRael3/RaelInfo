const ALLOWED_CATEGORIES = new Set(['housing', 'saving', 'debt', 'crossborder', 'planning']);
const ALLOWED_MARKETS = new Set(['US', 'CA']);
const ALLOWED_CURRENCIES = new Set(['USD', 'CAD']);

function safeText(value, maxLength, fallback = '') {
  return String(value || fallback).trim().slice(0, maxLength);
}

function normalizeOffer(raw) {
  if (!raw || typeof raw !== 'object' || raw.active !== true || raw.approved !== true) return null;
  const id = safeText(raw.id, 48).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,47}$/.test(id)) return null;
  let destination;
  try {
    destination = new URL(String(raw.destinationUrl || ''));
    if (destination.protocol !== 'https:' || destination.username || destination.password) return null;
  } catch { return null; }
  const categories = Array.isArray(raw.categories)
    ? [...new Set(raw.categories.map(x => String(x).toLowerCase()).filter(x => ALLOWED_CATEGORIES.has(x)))].slice(0, 5)
    : [];
  const markets = Array.isArray(raw.markets)
    ? [...new Set(raw.markets.map(x => String(x).toUpperCase()).filter(x => ALLOWED_MARKETS.has(x)))].slice(0, 2)
    : [];
  const currencies = Array.isArray(raw.currencies)
    ? [...new Set(raw.currencies.map(x => String(x).toUpperCase()).filter(x => ALLOWED_CURRENCIES.has(x)))].slice(0, 2)
    : ['USD', 'CAD'];
  if (!categories.length || !markets.length) return null;
  return {
    id,
    partnerName: safeText(raw.partnerName, 80, 'Partner'),
    title: safeText(raw.title, 110, 'Partner resource'),
    description: safeText(raw.description, 280, 'Review the provider’s current terms, fees and eligibility.'),
    destinationUrl: destination.href,
    categories,
    markets,
    currencies,
    cta: safeText(raw.cta, 48, 'Visit provider'),
    approvedAt: safeText(raw.approvedAt, 24),
    disclosure: 'Advertisement: RaelInfo may earn a commission if you use this link. Compensation does not change the calculator result.'
  };
}

export function getApprovedPartnerOffers(env) {
  const raw = String(env.PARTNER_OFFERS_JSON || '[]');
  if (raw.length > 24_000) {
    console.error('PARTNER_OFFERS_JSON exceeds the 24 KB configuration limit.');
    return [];
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (error) {
    console.error('PARTNER_OFFERS_JSON is invalid JSON:', error.message);
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const offers = parsed.map(normalizeOffer).filter(Boolean);
  const seen = new Set();
  return offers.filter(offer => {
    if (seen.has(offer.id)) return false;
    seen.add(offer.id);
    return true;
  }).slice(0, 30);
}

export function offerForId(env, id) {
  return getApprovedPartnerOffers(env).find(offer => offer.id === String(id || '').toLowerCase()) || null;
}

export function publicOffer(offer) {
  return {
    id: offer.id,
    partnerName: offer.partnerName,
    title: offer.title,
    description: offer.description,
    categories: offer.categories,
    markets: offer.markets,
    currencies: offer.currencies,
    cta: offer.cta,
    disclosure: offer.disclosure
  };
}
