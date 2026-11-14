import {
  json,
  error,
  isSameOrigin,
  checkCsrf,
  requireDatabase
} from '../../../functions-shared/http.js';

import {
  getAuthenticatedUser,
  withAuthCookies
} from '../../../functions-shared/supabase-auth.js';

import { enforceRateLimit } from '../../../functions-shared/rate-limit.js';

async function authorize(request, env) {
  const auth = await getAuthenticatedUser(request, env);

  if (!auth.user?.id) {
    return { response: error('Please sign in to manage price alerts.', 401) };
  }

  const db = requireDatabase(env);

  const rate = await enforceRateLimit(
    env,
    request,
    `price-alert:${auth.user.id}`,
    40,
    900
  );

  if (!rate.allowed) {
    return {
      response: error('Too many price alert changes. Please wait and try again.', 429, {
        'Retry-After': String(rate.retryAfter)
      })
    };
  }

  return { auth, db };
}

export async function onRequestPatch({ request, env, params }) {
  if (!isSameOrigin(request)) {
    return error('Request origin not allowed.', 403);
  }

  if (!checkCsrf(request)) {
    return error('Security token expired. Refresh the page and try again.', 403);
  }

  try {
    const access = await authorize(request, env);
    if (access.response) return access.response;

    const { auth, db } = access;

    const result = await db.prepare(`
      UPDATE price_alerts
      SET
        status = 'active',
        triggered_at = NULL,
        triggered_price = NULL,
        updated_at = ?
      WHERE id = ?
        AND user_id = ?
        AND status = 'triggered'
    `).bind(
      new Date().toISOString(),
      String(params.id || ''),
      auth.user.id
    ).run();

    if (!result.meta?.changes) {
      return error('Triggered price alert not found.', 404);
    }

    return withAuthCookies(json({ ok: true, status: 'active' }), auth);
  } catch (err) {
    console.error('Price alert reactivation error:', err.message);
    return error('Unable to reactivate this price alert.', 503);
  }
}

export async function onRequestDelete({ request, env, params }) {
  if (!isSameOrigin(request)) {
    return error('Request origin not allowed.', 403);
  }

  if (!checkCsrf(request)) {
    return error('Security token expired. Refresh the page and try again.', 403);
  }

  try {
    const access = await authorize(request, env);
    if (access.response) return access.response;

    const { auth, db } = access;

    const result = await db.prepare(`
      DELETE FROM price_alerts
      WHERE id = ? AND user_id = ?
    `).bind(
      String(params.id || ''),
      auth.user.id
    ).run();

    if (!result.meta?.changes) {
      return error('Price alert not found.', 404);
    }

    return withAuthCookies(json({ ok: true }), auth);
  } catch (err) {
    console.error('Price alert delete error:', err.message);
    return error('Unable to delete this price alert.', 503);
  }
}
