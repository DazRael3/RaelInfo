import { json, error, isSameOrigin, checkCsrf, requireDatabase } from '../../../functions-shared/http.js';
import { getAuthenticatedUser, withAuthCookies } from '../../../functions-shared/supabase-auth.js';

export async function onRequestDelete({ request, env, params }) {
  if (!isSameOrigin(request)) return error('Request origin not allowed.', 403);
  if (!checkCsrf(request)) return error('Security token expired. Refresh the page and try again.', 403);
  try {
    const auth = await getAuthenticatedUser(request, env);
    if (!auth.user?.id) return error('Please sign in to manage your portfolio.', 401);
    const db = requireDatabase(env);
    const result = await db.prepare('DELETE FROM portfolio_positions WHERE id = ? AND user_id = ?')
      .bind(String(params.id || ''), auth.user.id).run();
    if (!result.meta?.changes) return error('Portfolio position not found.', 404);
    return withAuthCookies(json({ ok: true }), auth);
  } catch (err) {
    console.error('Portfolio delete error:', err.message);
    return error('Unable to remove this portfolio position.', 503);
  }
}
