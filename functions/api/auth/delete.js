import { json, error, readJson, isSameOrigin, checkCsrf, requireDatabase, clearSessionCookieHeaders, setCookies } from '../../../functions-shared/http.js';
import { getAuthenticatedUser, signInWithSupabase, deleteSupabaseUser } from '../../../functions-shared/supabase-auth.js';

export async function onRequestPost({ request, env }) {
  if (!isSameOrigin(request)) return error('Request origin not allowed.', 403);
  if (!checkCsrf(request)) return error('Security token expired. Refresh the page and try again.', 403);
  if (!env.SUPABASE_SECRET_KEY && !env.SUPABASE_SERVICE_ROLE_KEY) return error('Account deletion is not enabled yet. The site administrator must configure the Supabase secret key.', 503);
  try {
    const db = requireDatabase(env);
    const auth = await getAuthenticatedUser(request, env);
    if (!auth.user?.id || !auth.user?.email) return error('Please sign in again.', 401);
    const body = await readJson(request);
    const password = String(body.password || '');
    if (!password || password.length > 200) return error('Enter your password to confirm account deletion.', 400);

    try {
      await signInWithSupabase(env, auth.user.email, password);
    } catch {
      return error('Password confirmation did not match.', 401);
    }

    await deleteSupabaseUser(env, auth.user.id, auth.accessToken);
    await db.batch([
      db.prepare('DELETE FROM portfolio_positions WHERE user_id = ?').bind(auth.user.id),
      db.prepare('DELETE FROM users WHERE id = ?').bind(auth.user.id)
    ]);
    return setCookies(json({ ok: true }), clearSessionCookieHeaders(request));
  } catch (err) {
    console.error('Account deletion error:', err.message);
    if (err.message.startsWith('Request body')) return error(err.message, 400);
    return error('Account deletion could not be completed. Contact RaelInfo support.', 503);
  }
}
