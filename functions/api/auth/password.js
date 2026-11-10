import { json, error, readJson, isSameOrigin, checkCsrf } from '../../../functions-shared/http.js';
import { getAuthenticatedUser, updateSupabasePassword, withAuthCookies } from '../../../functions-shared/supabase-auth.js';
import { enforceRateLimit } from '../../../functions-shared/rate-limit.js';


export async function onRequestPost({ request, env }) {
  if (!isSameOrigin(request)) return error('Request origin not allowed.', 403);
  if (!checkCsrf(request)) return error('Security token expired. Refresh the page and try again.', 403);
  try {
    const rate = await enforceRateLimit(env, request, 'auth-password-update', 5, 900);
    if (!rate.allowed) return error('Too many password changes. Please try again later.', 429, { 'Retry-After': String(rate.retryAfter) });
    const auth = await getAuthenticatedUser(request, env);
    if (!auth.user?.id || !auth.accessToken) return error('Your recovery session has expired. Request a new password recovery email.', 401);
    const body = await readJson(request);
    const password = String(body.password || '');
    if (password.length < 12 || password.length > 200) return error('Password must be at least 12 characters and no more than 200.', 400);
    await updateSupabasePassword(env, auth.accessToken, password);
    const response = json({ ok: true, message: 'Your password has been updated. You can now sign in with your new password.' });
    return withAuthCookies(response, auth);
  } catch (err) {
    console.error('Password update error:', err.message);
    if (err.message.startsWith('Request body')) return error(err.message, 400);
    if (err.status === 401 || err.status === 403) return error('Your recovery session has expired. Request a new password recovery email.', 401);
    if (err.status === 422 || err.status === 400) return error('The new password was rejected. Use at least 12 characters.', 400);
    return error('Password update is temporarily unavailable. Please try again.', 503);
  }
}
