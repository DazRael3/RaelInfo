import { json, error, readJson, isSameOrigin, requireDatabase, randomToken, sessionCookieHeaders, setCookies, ensureUserProfile } from '../../../functions-shared/http.js';
import { enforceRateLimit } from '../../../functions-shared/rate-limit.js';
import { registerWithSupabase } from '../../../functions-shared/supabase-auth.js';

export async function onRequestPost({ request, env }) {
  if (!isSameOrigin(request)) return error('Request origin not allowed.', 403);
  try {
    const db = requireDatabase(env);
    const rate = await enforceRateLimit(env, request, 'auth-register', 5, 900);
    if (!rate.allowed) return error('Too many registration attempts. Please try again later.', 429, { 'Retry-After': String(rate.retryAfter) });

    const body = await readJson(request);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error('Enter a valid email address.', 400);
    if (password.length < 12 || password.length > 200) return error('Password must be at least 12 characters and no more than 200.', 400);

    const redirectTo = `${new URL(request.url).origin}/login.html`;
    const result = await registerWithSupabase(env, email, password, redirectTo);
    // Supabase returns either { user, access_token, ... } or a User object
    // directly when email confirmation is enabled. Handle both documented shapes.
    const user = result.user || (result.id ? result : null);
    if (!user?.id || !user.email) return error('The authentication provider did not return a user record. Please try again.', 502);
    await ensureUserProfile(db, user);

    if (result.access_token && result.refresh_token) {
      const csrf = randomToken(32);
      const response = json({ ok: true, needsEmailConfirmation: false, user: { id: user.id, email: user.email }, csrfToken: csrf }, 201);
      return setCookies(response, sessionCookieHeaders(request, result, csrf));
    }

    return json({
      ok: true,
      needsEmailConfirmation: true,
      user: { id: user.id, email: user.email },
      message: 'Check your email for a confirmation link. After confirming, return here and sign in.'
    }, 201);
  } catch (err) {
    console.error('Registration error:', err.message);
    if (err.status === 429) return error('Email registration is temporarily rate-limited. Please wait and try again.', 429);
    if (err.message.startsWith('Request body')) return error(err.message, 400);
    if (err.status === 422 || err.status === 400 || err.status === 409) return error('Registration could not be completed. Check the email address and password, or try signing in.', 400);
    return error(err.message.includes('not configured') ? err.message : 'Account registration is temporarily unavailable.', 503);
  }
}
