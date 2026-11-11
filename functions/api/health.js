import { getApprovedPartnerOffers } from '../../functions-shared/partners.js';
import { json, requireDatabase } from '../../functions-shared/http.js';

export async function onRequestGet({ env }) {
  let database = false;
  try {
    const db = requireDatabase(env);
    await db.prepare('SELECT 1 AS ok').first();
    database = true;
  } catch (err) {
    console.error('Health database check:', err.message);
  }
  const sec = Boolean(env.SEC_USER_AGENT && String(env.SEC_USER_AGENT).includes('@') && !String(env.SEC_USER_AGENT).includes('example.com'));
  return json({
    ok: database,
    service: 'RaelInfo API',
    version: '3.2.0',
    time: new Date().toISOString(),
    database,
    providers: {
      auth: Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY),
      crypto: 'CoinLore (public endpoint)',
      fx: 'Frankfurter (public endpoint)',
      news: 'Official SEC, Federal Reserve and Bank of Canada feeds',
      stocks: {
        alpha: Boolean(env.ALPHA_VANTAGE_KEY),
        fmp: Boolean(env.FMP_KEY),
        eod: Boolean(env.EODHD_KEY)
      },
      sec,
      approvedPartnerOffers: getApprovedPartnerOffers(env).length,
      businessInquiriesEnabled: String(env.PARTNER_INQUIRIES_ENABLED || '').toLowerCase() === 'true',
      revenueAdminConfigured: String(env.RAELINFO_ADMIN_TOKEN || '').length >= 32
    }
  }, database ? 200 : 503);
}
