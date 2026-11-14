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

export async function onRequestDelete({ request, env, params }) {
  if (!isSameOrigin(request)) {
    return error('Request origin not allowed.', 403);
  }

  if (!checkCsrf(request)) {
    return error('Security token expired. Refresh the page and try again.', 403);
  }

  try {
    const auth = await getAuthenticatedUser(request, env);

    if (!auth.user?.id) {
      return error('Please sign in to manage your portfolio.', 401);
    }

    const db = requireDatabase(env);

    const result = await db.prepare(`
      DELETE FROM portfolio_positions
      WHERE id = ? AND user_id = ?
    `).bind(
      String(params.id || ''),
      auth.user.id
    ).run();

    if (!result.meta?.changes) {
      return error('Portfolio position not found.', 404);
    }

    return withAuthCookies(json({ ok: true }), auth);
  } catch (err) {
    console.error('Portfolio delete error:', err.message);
    return error('Unable to remove this portfolio position.', 503);
  }
}

export async function onRequestPatch({ request, env, params }) {
  if (!isSameOrigin(request)) {
    return error('Request origin not allowed.', 403);
  }

  if (!checkCsrf(request)) {
    return error('Security token expired. Refresh the page and try again.', 403);
  }

  try {
    const auth = await getAuthenticatedUser(request, env);

    if (!auth.user?.id) {
      return error('Please sign in to manage your portfolio.', 401);
    }

    const db = requireDatabase(env);

    const rate = await enforceRateLimit(
      env,
      request,
      `portfolio-price:${auth.user.id}`,
      60,
      900
    );

    if (!rate.allowed) {
      return error('Too many portfolio price updates. Please wait and try again.', 429, {
        'Retry-After': String(rate.retryAfter)
      });
    }

    const body = await readJson(request);
    const clearing = body.currentPrice === null;
    const currentPrice = clearing ? null : Number(body.currentPrice);

    if (
      !clearing &&
      (
        !Number.isFinite(currentPrice) ||
        currentPrice <= 0 ||
        currentPrice > 1_000_000_000
      )
    ) {
      return error('Enter a price greater than zero and no more than 1,000,000,000.', 400);
    }

    const positionId = String(params.id || '');

    const position = await db.prepare(`
      SELECT symbol, currency
      FROM portfolio_positions
      WHERE id = ? AND user_id = ?
    `).bind(positionId, auth.user.id).first();

    if (!position) {
      return error('Portfolio position not found.', 404);
    }

    const priceUpdatedAt = clearing ? null : new Date().toISOString();

    const result = await db.prepare(`
      UPDATE portfolio_positions
      SET current_price = ?, price_updated_at = ?
      WHERE id = ? AND user_id = ?
    `).bind(
      currentPrice,
      priceUpdatedAt,
      positionId,
      auth.user.id
    ).run();

    if (!result.meta?.changes) {
      return error('Portfolio position not found.', 404);
    }

    // Alert evaluation is deliberately separate from the price save.
    // A failure here must not tell the user that their price save failed.
    if (!clearing && position.symbol && position.currency) {
      try {
        const now = new Date().toISOString();

        await db.prepare(`
          UPDATE price_alerts
          SET
            status = 'triggered',
            triggered_at = ?,
            triggered_price = ?,
            updated_at = ?
          WHERE user_id = ?
            AND symbol = ?
            AND currency = ?
            AND status = 'active'
            AND (
              (direction = 'above' AND ? >= target_price)
              OR
              (direction = 'below' AND ? <= target_price)
            )
        `).bind(
          now,
          currentPrice,
          now,
          auth.user.id,
          String(position.symbol).toUpperCase(),
          String(position.currency).toUpperCase(),
          currentPrice,
          currentPrice
        ).run();
      } catch (alertError) {
        console.error('Price alert evaluation error:', alertError.message);
      }
    }

    return withAuthCookies(
      json({ ok: true, currentPrice, priceUpdatedAt }),
      auth
    );
  } catch (err) {
    console.error('Portfolio price update error:', err.message);

    const message = err instanceof Error ? err.message : '';

    return message.startsWith('Request body')
      ? error(message, 400)
      : error('Unable to save this portfolio price. Please try again.', 503);
  }
}
