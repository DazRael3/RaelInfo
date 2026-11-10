import { json, error, readJson, isSameOrigin, requireDatabase, randomToken, sessionCookieHeaders, setCookies, ensureUserProfile } from '../../../functions-shared/http.js';
import { enforceRateLimit } from '../../../functions-shared/rate-limit.js';
import { getSupabaseUser } from '../../../functions-shared/supabase-auth.js';

export async function onRequestPost({ request, env }) {
  if (!isSameOrigin(request)) return error('Request origin not allowed.', 403);
  try {
    const rate = await enforceRateLimit(env, request, 'auth-email-callback', 10, 900);
    if (!rate.allowed) return error('Too many authentication attempts. Please try again later.', 429, { 'Retry-After': String(rate.retryAfter) });
    const body = await readJson(request);
    const accessToken = String(body.access_token || '');
    const refreshToken = String(body.refresh_token || '');
    if (accessToken.length < 20 || accessToken.length > 8192 || refreshToken.length < 20 || refreshToken.length > 8192) return error('The email link is invalid or expired. Request a new link.', 400);
    const user = await getSupabaseUser(env, accessToken);
    if (!user?.id || !user.email) return error('The email link is invalid or expired. Request a new link.', 401);
    await ensureUserProfile(requireDatabase(env), user);
    const csrf = randomToken(32);
    const response = json({ ok: true, user: { id: user.id, email: user.email } });
    return setCookies(response, sessionCookieHeaders(request, { access_token: accessToken, refresh_token: refreshToken, expires_in: 3600 }, csrf));
  } catch (err) {
    console.error('Email authentication callback error:', err.message);
    if (err.message.startsWith('Request body')) return error(err.message, 400);
    if (err.status === 401 || err.status === 403) return error('The email link is invalid or expired. Request a new link.', 401);
    return error('Email verification could not be completed. Please try signing in.', 503);
  }
}
