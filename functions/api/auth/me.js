import { json, setCookies, clearSessionCookieHeaders, cookieValue, csrfCookieHeader, newCsrfToken, requireDatabase, isAccountDeletionPending } from '../../../functions-shared/http.js';
import { getAuthenticatedUser, userForClient } from '../../../functions-shared/supabase-auth.js';

export async function onRequestGet({ request, env }) {
  try {
    // Session status must remain available to the dedicated retry-delete UI.
    // All ordinary authenticated routes still use the profile guard by default.
    const auth = await getAuthenticatedUser(request, env, { skipProfileEnsure: true });
    if (!auth.user) {
      return setCookies(json({ authenticated: false }), clearSessionCookieHeaders(request));
    }
    const deletionPending = await isAccountDeletionPending(requireDatabase(env), auth.user.id);
    let csrf = cookieValue(request, 'raelinfo_csrf');
    const cookies = [...(auth.cookies || [])];
    if (!csrf) {
      csrf = await newCsrfToken();
      cookies.push(csrfCookieHeader(request, csrf));
    }
    const response = json({
      authenticated: true,
      user: userForClient(auth.user),
      csrfToken: csrf,
      accountDeletionEnabled: Boolean(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY),
      deletionPending
    });
    return cookies.length ? setCookies(response, cookies) : response;
  } catch (err) {
    console.error('Auth session lookup error:', err.message);
    return json({ authenticated: false, error: 'Unable to verify your session right now.' }, 503);
  }
}
