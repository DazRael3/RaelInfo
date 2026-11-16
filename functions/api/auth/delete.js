import { json, error, readJson, isSameOrigin, checkCsrf, requireDatabase, clearSessionCookieHeaders, setCookies } from '../../../functions-shared/http.js';
import { getAuthenticatedUser, signInWithSupabase, deleteSupabaseUser } from '../../../functions-shared/supabase-auth.js';
import { enforceRateLimit } from '../../../functions-shared/rate-limit.js';

export async function onRequestPost({ request, env }) {
  if (!isSameOrigin(request)) return error('Request origin not allowed.', 403);
  if (!checkCsrf(request)) return error('Security token expired. Refresh the page and try again.', 403);
  if (!env.SUPABASE_SECRET_KEY && !env.SUPABASE_SERVICE_ROLE_KEY) return error('Account deletion is not enabled yet. The site administrator must configure the Supabase secret key.', 503);
  let deletionMarked = false;

  try {
    const db = requireDatabase(env);
    // This route alone may authenticate a pending account without recreating its D1 profile.
    const auth = await getAuthenticatedUser(request, env, { skipProfileEnsure: true });
    if (!auth.user?.id || !auth.user?.email) return error('Please sign in again.', 401);
    const body = await readJson(request);
    const password = String(body.password || '');
    const confirmation = String(body.confirmation || '');
    if (confirmation !== 'DELETE MY ACCOUNT') {
      return error('Type DELETE MY ACCOUNT to confirm permanent account deletion.', 400);
    }
    if (!password || password.length > 200) return error('Enter your password to confirm account deletion.', 400);

    const rate = await enforceRateLimit(
      env,
      request,
      'account-delete',
      5,
      900,
      auth.user.id
    );

    if (!rate.allowed) {
      return error(
        'Too many permanent deletion attempts. Please wait before trying again.',
        429,
        { 'Retry-After': String(rate.retryAfter) }
      );
    }

    try {
      await signInWithSupabase(env, auth.user.email, password);
    } catch {
      return error('Password confirmation did not match.', 401);
    }

    const requestedAt = new Date().toISOString();
    // D1 batches are atomic: the durable marker and profile deletion happen together.
    // The marker intentionally has no FK, so it survives deleting the users row.
    await db.batch([
      db.prepare(`
        INSERT INTO account_deletion_pending (user_id, requested_at)
        VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET requested_at = excluded.requested_at
      `).bind(auth.user.id, requestedAt),
      db.prepare('DELETE FROM users WHERE id = ?').bind(auth.user.id)
    ]);
    deletionMarked = true;

    // If Supabase fails, the marker remains and all normal profile creation is blocked.
    // The same authenticated endpoint can be retried after password re-verification.
    await deleteSupabaseUser(env, auth.user.id, auth.accessToken);

    // A cleanup failure leaves only an inert marker; it cannot restore account data.
    try {
      await db.prepare('DELETE FROM account_deletion_pending WHERE user_id = ?').bind(auth.user.id).run();
    } catch (cleanupError) {
      console.error('Account deletion marker cleanup failed:', cleanupError.message);
    }

    return setCookies(json({ ok: true }), clearSessionCookieHeaders(request));
  } catch (err) {
    console.error('Account deletion error:', err.message);
    if (err.status === 423) return error('Account deletion is already pending. Retry permanent deletion from this page after confirming your password.', 423);
    if (err.message.startsWith('Request body')) return error(err.message, 400);

    if (deletionMarked) {
      return error(
        'Your account deletion is pending. Normal account access is locked. Reload this page and retry permanent deletion, or contact RaelInfo support if the retry remains unavailable.',
        503
      );
    }

    return error(
      'Account deletion could not be started. Your account deletion was not confirmed. Please try again.',
      503
    );
  }
}
