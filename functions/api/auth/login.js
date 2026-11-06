import { json, error, readJson, isSameOrigin, requireDatabase, randomToken, sessionCookieHeaders, setCookies, ensureUserProfile } from '../../../functions-shared/http.js';
import { enforceRateLimit } from '../../../functions-shared/rate-limit.js';
import { signInWithSupabase } from '../../../functions-shared/supabase-auth.js';

export async function onRequestPost({ request, env }) {
  if (!isSameOrigin(request)) return error('Request origin not allowed.', 403);
  try {
    requireDatabase(env);
    const rate = await enforceRateLimit(env, request, 'auth-login', 10, 900);
    if (!rate.allowed) return error('Too many login attempts. Please wait and try again later.', 429, { 'Retry-After': String(rate.retryAfter) });

    const body = await readJson(request);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 1 || password.length > 200) {
      return error('Email address or password is incorrect.', 401);
    }

    const tokens = await signInWithSupabase(env, email, password);
    if (!tokens.access_token || !tokens.refresh_token || !tokens.user?.id) return error('Sign-in response was incomplete. Please try again.', 502);
    await ensureUserProfile(env.DB, tokens.user);
    const csrf = randomToken(32);
    const response = json({ ok: true, user: { id: tokens.user.id, email: tokens.user.email }, csrfToken: csrf });
    return setCookies(response, sessionCookieHeaders(request, tokens, csrf));
  } catch (err) {
    console.error('Login error:', err.message);
    if (err.status === 400 || err.status === 401 || err.status === 422) return error('Email address or password is incorrect. If you just registered, confirm your email first.', 401);
    if (err.status === 429) return error('Too many login attempts. Please wait and try again.', 429);
    if (err.message.startsWith('Request body')) return error(err.message, 400);
    return error(err.message.includes('not configured') ? err.message : 'Sign-in is temporarily unavailable.', 503);
  }
}
