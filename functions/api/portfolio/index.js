import { json, error, readJson, isSameOrigin, checkCsrf, requireDatabase } from '../../../functions-shared/http.js';
import { getAuthenticatedUser, withAuthCookies } from '../../../functions-shared/supabase-auth.js';
import { enforceRateLimit } from '../../../functions-shared/rate-limit.js';

export async function onRequestGet({ request, env }) {
  try {
    const auth = await getAuthenticatedUser(request, env);
    if (!auth.user?.id) return error('Please sign in to view your portfolio.', 401);
    const db = requireDatabase(env);
    const result = await db.prepare(`
      SELECT id, symbol, shares, average_cost AS averageCost, currency, current_price AS currentPrice, price_updated_at AS priceUpdatedAt, created_at AS createdAt
      FROM portfolio_positions
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).bind(auth.user.id).all();
    return withAuthCookies(json({ items: result.results || [] }), auth);
  } catch (err) {
    console.error('Portfolio read error:', err.message);
    return error('Unable to load your portfolio. Please try again.', 503);
  }
}

export async function onRequestPost({ request, env }) {
  if (!isSameOrigin(request)) return error('Request origin not allowed.', 403);
  if (!checkCsrf(request)) return error('Security token expired. Refresh the page and try again.', 403);
  try {
    const auth = await getAuthenticatedUser(request, env);
    if (!auth.user?.id) return error('Please sign in to save portfolio positions.', 401);
    const db = requireDatabase(env);
    const rate = await enforceRateLimit(env, request, `portfolio-add:${auth.user.id}`, 30, 900);
    if (!rate.allowed) return error('Too many portfolio changes. Please wait and try again.', 429, { 'Retry-After': String(rate.retryAfter) });

    const body = await readJson(request);
    const symbol = String(body.symbol || '').trim().toUpperCase();
    const shares = Number(body.shares);
    const averageCost = Number(body.averageCost);
    const currency = String(body.currency || 'USD').toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(symbol)) return error('Enter a valid ticker symbol.', 400);
    if (!Number.isFinite(shares) || shares <= 0 || shares > 1_000_000_000) return error('Shares must be greater than zero and within the supported range.', 400);
    if (!Number.isFinite(averageCost) || averageCost < 0 || averageCost > 1_000_000_000) return error('Average cost must be zero or a positive amount.', 400);
    if (!['USD', 'CAD'].includes(currency)) return error('Currency must be USD or CAD.', 400);

    const count = await db.prepare('SELECT COUNT(*) AS total FROM portfolio_positions WHERE user_id = ?').bind(auth.user.id).first();
    if (Number(count?.total || 0) >= 100) return error('Portfolio limit reached (100 positions).', 400);
    const item = { id: crypto.randomUUID(), symbol, shares, averageCost, currency, createdAt: new Date().toISOString() };
    await db.prepare(`
      INSERT INTO portfolio_positions (id, user_id, symbol, shares, average_cost, currency, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(item.id, auth.user.id, symbol, shares, averageCost, currency, item.createdAt).run();
    return withAuthCookies(json({ ok: true, item }, 201), auth);
  } catch (err) {
    console.error('Portfolio add error:', err.message);
    return err.message.startsWith('Request body')
      ? error(err.message, 400)
      : error('Unable to save this portfolio position.', 503);
  }
}
