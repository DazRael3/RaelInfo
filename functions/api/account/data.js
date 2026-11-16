
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

const ALLOWED_CATEGORIES = new Set([
  'portfolio',
  'priceAlerts',
  'watchlists'
]);

async function getContext(request, env) {
  const auth = await getAuthenticatedUser(request, env);

  if (!auth.user?.id) {
    return {
      response: error('Please sign in to manage your saved data.', 401)
    };
  }

  const db = requireDatabase(env);

  return { auth, db };
}

export async function onRequestGet({ request, env }) {
  try {
    const context = await getContext(request, env);
    if (context.response) return context.response;

    const userId = context.auth.user.id;
    const [portfolio, priceAlerts, watchlists] = await Promise.all([
      context.db.prepare(
        'SELECT COUNT(*) AS total FROM portfolio_positions WHERE user_id = ?'
      ).bind(userId).first(),
      context.db.prepare(
        'SELECT COUNT(*) AS total FROM price_alerts WHERE user_id = ?'
      ).bind(userId).first(),
      context.db.prepare(
        'SELECT COUNT(*) AS total FROM watchlists WHERE user_id = ?'
      ).bind(userId).first()
    ]);

    return withAuthCookies(json({
      counts: {
        portfolio: Number(portfolio?.total || 0),
        priceAlerts: Number(priceAlerts?.total || 0),
        watchlists: Number(watchlists?.total || 0)
      },
      account: 'retained'
    }), context.auth);
  } catch (err) {
    console.error('Account data summary error:', err.message);
    return error('Unable to load your saved-data summary.', 503);
  }
}

export async function onRequestDelete({ request, env }) {
  if (!isSameOrigin(request)) {
    return error('Request origin not allowed.', 403);
  }

  if (!checkCsrf(request)) {
    return error('Security token expired. Refresh the page and try again.', 403);
  }

  try {
    const context = await getContext(request, env);
    if (context.response) return context.response;

    const rate = await enforceRateLimit(
      env,
      request,
      'account-data-delete',
      8,
      900,
      context.auth.user.id
    );

    if (!rate.allowed) {
      return error(
        'Too many data-management requests. Please wait and try again.',
        429,
        { 'Retry-After': String(rate.retryAfter) }
      );
    }

    const body = await readJson(request, 2048);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return error('Invalid data-management request.', 400);
    }
    const clearAll = body.clearAll === true;
    const supplied = body.categories;

    if (!clearAll && !Array.isArray(supplied)) {
      return error('Choose at least one data category to delete.', 400);
    }

    if (clearAll && supplied !== undefined && !Array.isArray(supplied)) {
      return error('Invalid data category selection.', 400);
    }

    const categories = clearAll
      ? [...ALLOWED_CATEGORIES]
      : [...new Set(supplied)];

    if (
      categories.length < 1 ||
      categories.length > ALLOWED_CATEGORIES.size ||
      categories.some(category => !ALLOWED_CATEGORIES.has(category))
    ) {
      return error('Choose one or more valid data categories.', 400);
    }

    const userId = context.auth.user.id;
    const statements = [];

    // Table names are fixed allowlisted SQL, never supplied by the request.
    if (categories.includes('portfolio')) {
      statements.push(
        context.db.prepare(
          'DELETE FROM portfolio_positions WHERE user_id = ?'
        ).bind(userId)
      );
    }

    if (categories.includes('priceAlerts')) {
      statements.push(
        context.db.prepare(
          'DELETE FROM price_alerts WHERE user_id = ?'
        ).bind(userId)
      );
    }

    if (categories.includes('watchlists')) {
      // watchlist_items are removed by the watchlists foreign-key cascade.
      statements.push(
        context.db.prepare(
          'DELETE FROM watchlists WHERE user_id = ?'
        ).bind(userId)
      );
    }

    await context.db.batch(statements);

    return withAuthCookies(json({
      ok: true,
      deletedCategories: categories,
      retained: [
        'RaelInfo login and account profile',
        'Pro-interest record',
        'site-wide and business records'
      ]
    }), context.auth);
  } catch (err) {
    console.error('Account data deletion error:', err.message);
    if (err.message.startsWith('Request body')) {
      return error(err.message, 400);
    }
    return error('Your selected saved data could not be deleted. Please try again.', 503);
  }
}