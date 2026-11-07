import { json, error, isSameOrigin, checkCsrf, requireDatabase } from '../../../functions-shared/http.js';
import { getAuthenticatedUser, withAuthCookies } from '../../../functions-shared/supabase-auth.js';

export async function onRequestGet({ request, env }) {
  try {
    const auth = await getAuthenticatedUser(request, env);
    if (!auth.user?.id) return error('Sign in to manage your RaelInfo Pro interest.', 401);
    const db = requireDatabase(env);
    const row = await db.prepare('SELECT status, created_at AS createdAt FROM pro_interest WHERE user_id = ?').bind(auth.user.id).first();
    return withAuthCookies(json({ joined: row?.status === 'active', status: row?.status || 'not_joined', createdAt: row?.createdAt || null }), auth);
  } catch (err) {
    console.error('Pro interest read error:', err.message);
    return error('Unable to load product-interest status.', 503);
  }
}

export async function onRequestPost({ request, env }) {
  if (!isSameOrigin(request)) return error('Request origin not allowed.', 403);
  if (!checkCsrf(request)) return error('Security token expired. Refresh the page and try again.', 403);
  try {
    const auth = await getAuthenticatedUser(request, env);
    if (!auth.user?.id) return error('Sign in to register interest.', 401);
    const db = requireDatabase(env);
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO pro_interest (user_id, status, created_at, updated_at)
      VALUES (?, 'active', ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET status = 'active', updated_at = excluded.updated_at
    `).bind(auth.user.id, now, now).run();
    return withAuthCookies(json({ ok: true, joined: true }), auth);
  } catch (err) {
    console.error('Pro interest join error:', err.message);
    return error('Unable to save your interest. Please try again.', 503);
  }
}

export async function onRequestDelete({ request, env }) {
  if (!isSameOrigin(request)) return error('Request origin not allowed.', 403);
  if (!checkCsrf(request)) return error('Security token expired. Refresh the page and try again.', 403);
  try {
    const auth = await getAuthenticatedUser(request, env);
    if (!auth.user?.id) return error('Sign in to manage your interest.', 401);
    const db = requireDatabase(env);
    await db.prepare("UPDATE pro_interest SET status = 'withdrawn', updated_at = ? WHERE user_id = ?")
      .bind(new Date().toISOString(), auth.user.id).run();
    return withAuthCookies(json({ ok: true, joined: false }), auth);
  } catch (err) {
    console.error('Pro interest withdrawal error:', err.message);
    return error('Unable to withdraw your interest. Please try again.', 503);
  }
}
