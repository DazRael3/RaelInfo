import {
  json,
  error,
  readJson,
  isSameOrigin,
  requireDatabase,
  ensureUserProfile,
  randomToken,
  sessionCookieHeaders,
  setCookies
} from '../../../functions-shared/http.js';

import { enforceRateLimit } from '../../../functions-shared/rate-limit.js';

import {
  verifySupabaseRecoveryOtp,
  getSupabaseUser
} from '../../../functions-shared/supabase-auth.js';

export async function onRequestPost({ request, env }) {
  if (!isSameOrigin(request)) {
    return error('Request origin not allowed.', 403);
  }

  try {
    const body = await readJson(request);
    const email = String(body.email || '').trim().toLowerCase();
    const token = String(body.token || '').trim();

    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return error('Enter a valid email address.', 400);
    }

    if (!/^\d{6}$/.test(token)) {
      return error('Enter the six-digit recovery code from your email.', 400);
    }

    const ipRate = await enforceRateLimit(
      env, request, 'auth-recovery-verify-ip', 30, 900
    );

    if (!ipRate.allowed) {
      return error('Too many verification attempts. Request a new code later.', 429, {
        'Retry-After': String(ipRate.retryAfter)
      });
    }

    const emailRate = await enforceRateLimit(
      env, request, 'auth-recovery-verify-email', 5, 900, email
    );

    if (!emailRate.allowed) {
      return error('Too many verification attempts. Request a new code later.', 429, {
        'Retry-After': String(emailRate.retryAfter)
      });
    }

    const tokens = await verifySupabaseRecoveryOtp(env, email, token);

    if (
      !tokens?.access_token ||
      !tokens?.refresh_token ||
      tokens.access_token.length < 20 ||
      tokens.refresh_token.length < 20
    ) {
      return error('The recovery code is invalid or expired. Request a new one.', 400);
    }

    const user = await getSupabaseUser(env, tokens.access_token);

    if (
      !user?.id ||
      !user.email ||
      user.email.toLowerCase() !== email
    ) {
      return error('The recovery code is invalid or expired. Request a new one.', 401);
    }

    await ensureUserProfile(requireDatabase(env), user);

    const csrf = randomToken(32);
    const response = json({
      ok: true,
      message: 'Recovery code verified.',
      user: { id: user.id, email: user.email }
    });

    return setCookies(
      response,
      sessionCookieHeaders(request, tokens, csrf)
    );
  } catch (err) {
    console.error('Recovery code verification error:', err.message);

    if (err.message.startsWith('Request body')) {
      return error(err.message, 400);
    }

    if ([400, 401, 403, 422].includes(err.status)) {
      return error('The recovery code is invalid or expired. Request a new one.', 400);
    }

    if (err.status === 429) {
      return error('Too many verification attempts. Please try again later.', 429);
    }

    return error('Recovery verification is temporarily unavailable. Please try again.', 503);
  }
}
