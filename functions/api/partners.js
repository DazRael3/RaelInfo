import { json } from '../../functions-shared/http.js';
import { getApprovedPartnerOffers, publicOffer } from '../../functions-shared/partners.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const market = String(url.searchParams.get('market') || 'US').toUpperCase();
  const category = String(url.searchParams.get('category') || '').toLowerCase();
  if (!['US', 'CA'].includes(market)) return json({ offers: [] });
  const offers = getApprovedPartnerOffers(env)
    .filter(offer => offer.markets.includes(market))
    .filter(offer => !category || offer.categories.includes(category))
    .map(publicOffer);
  return json({ offers, market });
}
