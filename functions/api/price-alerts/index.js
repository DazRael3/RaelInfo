import {
  json,
  error,
  readJson,
  isSameOrigin,
  checkCsrf,
  requireDatabase
} from '../../../functions-shared/http.js';

import {
  getAuthenticatedUser,
  withAuthCookies
} from '../../../functions-shared/supabase-auth.js';

import { enforceRateLimit } from '../../../functions-shared/rate-limit.js';

function normalizeSymbol(value) {
  const symbol = String(value ?? '').trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(symbol) ? symbol : null;
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await getAuthenticatedUser(request, env);

    if (!auth.user?.id) {
      return error('Please sign in to view your price alerts.', 401);
    }

    const db = requireDatabase(env);

    const result = await db.prepare(`
      SELECT
        id,
        symbol,
        currency,
        direction,
        target_price AS targetPrice,
        status,
        created_at AS createdAt,
        updated_at AS updatedAt,
        triggered_at AS triggeredAt,
        triggered_price AS triggeredPrice
      FROM price_alerts
      WHERE user_id = ?
      ORDER BY
        CASE status WHEN 'active' THEN 0 ELSE 1 END,
        created_at DESC
    `).bind(auth.user.id).all();

    return withAuthCookies(
      json({ alerts: result.results || [] }),
      auth
    );
  } catch (err) {
    console.error('Price alert read error:', err.message);
    return error('Unable to load price alerts.', 503);
  }
}

export async function onRequestPost({ request, env }) {
  if (!isSameOrigin(request)) {
    return error('Request origin not allowed.', 403);
  }

  if (!checkCsrf(request)) {
    return error('Security token expired. Refresh the page and try again.', 403);
  }

  try {
    const auth = await getAuthenticatedUser(request, env);

    if (!auth.user?.id) {
      return error('Please sign in to create price alerts.', 401);
    }

    const db = requireDatabase(env);

    const rate = await enforceRateLimit(
      env,
      request,
      'price-alert-create',
      40,
      900,
      auth.user.id
    );

    if (!rate.allowed) {
      return error('Too many alert changes. Please wait and try again.', 429, {
        'Retry-After': String(rate.retryAfter)
      });
    }

    const body = await readJson(request, 2048);

    const symbol = normalizeSymbol(body.symbol);
    const currency = String(body.currency || '').toUpperCase();
    const direction = String(body.direction || '').toLowerCase();
    const targetPriceInput = body.targetPrice;
    const targetPrice = Number(targetPriceInput);

    if (!symbol) {
      return error('Enter a valid ticker symbol.', 400);
    }

    if (!['USD', 'CAD'].includes(currency)) {
      return error('Currency must be USD or CAD.', 400);
    }

    if (!['above', 'below'].includes(direction)) {
      return error('Choose an above or below alert.', 400);
    }

    if (
      (
        typeof targetPriceInput !== 'number' &&
        !(typeof targetPriceInput === 'string' && targetPriceInput.trim() !== '')
      ) ||
      !Number.isFinite(targetPrice) ||
      targetPrice <= 0 ||
      targetPrice > 1000000000
    ) {
      return error('Enter a target price greater than zero and no more than 1,000,000,000.', 400);
    }

    const count = await db.prepare(`
      SELECT COUNT(*) AS total
      FROM price_alerts
      WHERE user_id = ? AND status = 'active'
    `).bind(auth.user.id).first();

    if (Number(count?.total || 0) >= 50) {
      return error('You can have up to 50 active price alerts.', 400);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.prepare(`
      INSERT INTO price_alerts (
        id, user_id, symbol, currency, direction,
        target_price, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).bind(
      id,
      auth.user.id,
      symbol,
      currency,
      direction,
      targetPrice,
      now,
      now
    ).run();

    return withAuthCookies(
      json({
        ok: true,
        alert: {
          id,
          symbol,
          currency,
          direction,
          targetPrice,
          status: 'active',
          createdAt: now,
          updatedAt: now,
          triggeredAt: null,
          triggeredPrice: null
        }
      }, 201),
      auth
    );
  } catch (err) {
    console.error('Price alert create error:', err.message);

    return err.message?.startsWith('Request body')
      ? error(err.message, 400)
      : error('Unable to create this price alert.', 503);
  }
}
