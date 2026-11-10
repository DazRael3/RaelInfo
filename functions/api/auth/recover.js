import { json, error, readJson, isSameOrigin } from '../../../functions-shared/http.js';
import { enforceRateLimit } from '../../../functions-shared/rate-limit.js';
import { recoverSupabasePassword } from '../../../functions-shared/supabase-auth.js';

export async function onRequestPost({ request, env }) {
  if (!isSameOrigin(request)) return error('Request origin not allowed.', 403);
  try {
    const rate = await enforceRateLimit(env, request, 'auth-recover', 5, 900);
    if (!rate.allowed) return error('Too many recovery requests. Please try again later.', 429, { 'Retry-After': String(rate.retryAfter) });
    const body = await readJson(request);
    const email = String(body.email || '').trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error('Enter a valid email address.', 400);
    const redirectTo = `${new URL(request.url).origin}/login.html`;
    try { await recoverSupabasePassword(env, email, redirectTo); }
    catch (err) {
      if (err.status === 429) return error('Too many recovery requests. Please wait and try again.', 429);
      if (err.status >= 500) throw err;
      // Do not reveal whether an email address belongs to an account.
    }
    return json({ ok: true, message: 'If an account exists for that address, a password recovery email has been sent. Check your inbox and spam folder.' });
  } catch (err) {
    console.error('Password recovery error:', err.message);
    if (err.message.startsWith('Request body')) return error(err.message, 400);
    return error('Password recovery is temporarily unavailable. Please try again later.', 503);
  }
}
