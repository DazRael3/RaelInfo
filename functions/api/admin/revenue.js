import { json, error, requireDatabase } from '../../../functions-shared/http.js';
import { isRevenueAdmin } from '../../../functions-shared/admin.js';

export async function onRequestGet({ request, env }) {
  if (!isRevenueAdmin(request, env)) return error('Unauthorized.', 401, { 'WWW-Authenticate': 'Bearer' });
  try {
    const db = requireDatabase(env);
    const [clicks, conversions, events, proInterest, inquiries, inquiryCount] = await Promise.all([
      db.prepare(`SELECT offer_id AS offerId, partner_name AS partnerName, market, category, placement, COUNT(*) AS clicks, MAX(clicked_at) AS lastClick
        FROM affiliate_clicks GROUP BY offer_id, partner_name, market, category, placement
        ORDER BY clicks DESC LIMIT 100`).all(),
      db.prepare(`SELECT offer_id AS offerId, partner_name AS partnerName, market, currency, status,
          COUNT(*) AS conversions, SUM(commission_amount) AS commissionAmount
        FROM affiliate_conversions GROUP BY offer_id, partner_name, market, currency, status
        ORDER BY partner_name, market, currency, status`).all(),
      db.prepare(`SELECT event_name AS eventName, category, market, SUM(event_count) AS events
        FROM daily_site_events WHERE event_date >= date('now', '-30 days')
        GROUP BY event_name, category, market ORDER BY events DESC`).all(),
      db.prepare("SELECT COUNT(*) AS total FROM pro_interest WHERE status = 'active'").first(),
      db.prepare(`SELECT id, contact_name AS contactName, contact_email AS contactEmail, organization,
          inquiry_type AS inquiryType, website, message, status, legal_hold AS legalHold,
          legal_hold_reason AS legalHoldReason, created_at AS createdAt
        FROM business_inquiries ORDER BY created_at DESC LIMIT 50`).all(),
      db.prepare('SELECT COUNT(*) AS total FROM business_inquiries').first()
    ]);
    const recentConversions = await db.prepare(`SELECT id, offer_id AS offerId, partner_name AS partnerName,
      external_ref AS externalRef, market, commission_amount AS commissionAmount, currency, status,
      conversion_date AS conversionDate, created_at AS createdAt
      FROM affiliate_conversions ORDER BY conversion_date DESC, created_at DESC LIMIT 100`).all();
    return json({
      generatedAt: new Date().toISOString(),
      clicks: clicks.results || [],
      conversions: conversions.results || [],
      recentConversions: recentConversions.results || [],
      events: events.results || [],
      proInterest: Number(proInterest?.total || 0),
      inquiryCount: Number(inquiryCount?.total || 0),
      inquiries: inquiries.results || []
    });
  } catch (err) {
    console.error('Revenue dashboard query failed:', err.message);
    return error('Unable to load revenue metrics.', 503);
  }
}
