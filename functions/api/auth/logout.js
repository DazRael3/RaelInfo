import { json, error, isSameOrigin, checkCsrf, clearSessionCookieHeaders, setCookies } from '../../../functions-shared/http.js';
import { getAuthenticatedUser, signOutSupabase } from '../../../functions-shared/supabase-auth.js';

export async function onRequestPost({ request, env }) {
  if (!isSameOrigin(request)) return error('Request origin not allowed.', 403);
  if (!checkCsrf(request)) return error('Security token expired. Refresh the page and try again.', 403);
  try {
    const auth = await getAuthenticatedUser(request, env);
    if (auth.user && auth.accessToken) await signOutSupabase(env, auth.accessToken);
    return setCookies(json({ ok: true }), clearSessionCookieHeaders(request));
  } catch (err) {
    console.error('Logout error:', err.message);
    return error('Unable to sign out cleanly. Please try again.', 503);
  }
}
