import { requireDatabase } from '../../../functions-shared/http.js';
import { offerForId } from '../../../functions-shared/partners.js';
import { enforceRateLimit } from '../../../functions-shared/rate-limit.js';

const CATEGORIES = new Set(['housing', 'saving', 'debt', 'crossborder', 'planning']);
const PLACEMENTS = new Set(['calculator', 'landing', 'resource']);

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const offer = offerForId(env, url.searchParams.get('offer'));
  if (!offer) return new Response('Partner offer not found or not active.', { status: 404, headers: { 'Cache-Control': 'no-store' } });

  const market = String(url.searchParams.get('market') || '').toUpperCase();
  const category = String(url.searchParams.get('category') || '').toLowerCase();
  const placement = String(url.searchParams.get('placement') || 'calculator').toLowerCase();
  if (!offer.markets.includes(market) || !offer.categories.includes(category) || !CATEGORIES.has(category) || !PLACEMENTS.has(placement)) {
    return new Response('Partner offer is not available for this market or placement.', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const db = requireDatabase(env);
    const rate = await enforceRateLimit(env, request, `affiliate-click:${offer.id}`, 60, 60);
    if (rate.allowed) {
      await db.prepare(`
        INSERT INTO affiliate_clicks (id, offer_id, partner_name, market, category, placement, clicked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), offer.id, offer.partnerName, market, category, placement, new Date().toISOString()).run();
    }
  } catch (error) {
    // Never block a legitimately configured partner link because measurement is temporarily unavailable.
    console.error('Affiliate click measurement failed:', error.message);
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: offer.destinationUrl,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow'
    }
  });
}
