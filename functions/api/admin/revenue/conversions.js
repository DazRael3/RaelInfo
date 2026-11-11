import { json, error, readJson, requireDatabase, isSameOrigin } from '../../../../functions-shared/http.js';
import { isRevenueAdmin } from '../../../../functions-shared/admin.js';

export async function onRequestPost({ request, env }) {
  if (!isRevenueAdmin(request, env)) return error('Unauthorized.', 401, { 'WWW-Authenticate': 'Bearer' });
  if (!isSameOrigin(request)) return error('Request origin not allowed.', 403);
  try {
    const body = await readJson(request, 4096);
    const offerId = String(body.offerId || '').trim().toLowerCase();
    const partnerName = String(body.partnerName || '').trim().slice(0, 80);
    const externalRef = String(body.externalRef || '').trim().slice(0, 120);
    const market = String(body.market || '').toUpperCase();
    const currency = String(body.currency || '').toUpperCase();
    const status = String(body.status || '').toLowerCase();
    const amountInput = body.commissionAmount;
    const amount = typeof amountInput === 'number'
      ? amountInput
      : typeof amountInput === 'string' && amountInput.trim() !== ''
        ? Number(amountInput.trim())
        : NaN;
    const conversionDate = String(body.conversionDate || '');
    if (!/^[a-z0-9][a-z0-9_-]{1,47}$/.test(offerId)) return error('Enter a valid offer ID.', 400);
    if (!partnerName || !externalRef || /[\r\n]/.test(externalRef)) return error('Partner name and a non-personal network/reference ID are required.', 400);
    if (!['US', 'CA'].includes(market) || !['USD', 'CAD'].includes(currency)) return error('Select a valid market and currency.', 400);
    if (!['pending', 'approved', 'reversed'].includes(status)) return error('Select a valid conversion status.', 400);
    if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) return error('Commission amount must be a non-negative number.', 400);
    const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(conversionDate);
    if (!dateParts) return error('Enter the conversion date as YYYY-MM-DD.', 400);
    const year = Number(dateParts[1]);
    const month = Number(dateParts[2]);
    const day = Number(dateParts[3]);
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > (daysInMonth[month - 1] || 0)) {
      return error('Enter a real calendar date as YYYY-MM-DD.', 400);
    }

    const db = requireDatabase(env);
    const now = new Date().toISOString();
    await db.prepare(`INSERT INTO affiliate_conversions
      (id, offer_id, partner_name, external_ref, market, commission_amount, currency, status, conversion_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(offer_id, external_ref) DO UPDATE SET
        partner_name = excluded.partner_name, market = excluded.market,
        commission_amount = excluded.commission_amount, currency = excluded.currency,
        status = excluded.status, conversion_date = excluded.conversion_date, updated_at = excluded.updated_at`)
      .bind(crypto.randomUUID(), offerId, partnerName, externalRef, market, amount, currency, status, conversionDate, now, now).run();
    return json({ ok: true, message: 'Conversion record saved.' }, 201);
  } catch (err) {
    console.error('Revenue conversion write failed:', err.message);
    return err.message.startsWith('Request body') ? error(err.message, 400) : error('Unable to save conversion record.', 503);
  }
}
