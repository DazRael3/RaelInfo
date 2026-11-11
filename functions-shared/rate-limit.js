import { requireDatabase, sha256Base64Url } from './http.js';

let lastCleanupAt = 0;

export async function enforceRateLimit(
  env,
  request,
  scope,
  limit = 8,
  windowSeconds = 900,
  identity = ''
) {
  const db = requireDatabase(env);

  if (Date.now() - lastCleanupAt > 86_400_000) {
    lastCleanupAt = Date.now();
    await db.prepare(
      'DELETE FROM rate_limits WHERE window_start < ?'
    ).bind(Math.floor(Date.now() / 1000) - 172_800).run();
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const normalizedIdentity = String(identity || '').trim().toLowerCase();
  const key = normalizedIdentity
    ? `${scope}:${ip}:${normalizedIdentity}`
    : `${scope}:${ip}`;

  const keyHash = await sha256Base64Url(key);
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;

  await db.prepare(`
    INSERT INTO rate_limits (bucket_key, window_start, hits)
    VALUES (?, ?, 1)
    ON CONFLICT(bucket_key, window_start) DO UPDATE SET hits = hits + 1
  `).bind(keyHash, windowStart).run();

  const row = await db.prepare(
    'SELECT hits FROM rate_limits WHERE bucket_key = ? AND window_start = ?'
  ).bind(keyHash, windowStart).first();

  const retryAfter = Math.max(1, windowStart + windowSeconds - now);

  if (Number(row?.hits || 0) > limit) {
    return { allowed: false, retryAfter };
  }

  return { allowed: true, retryAfter };
}

export async function enforceRateLimitOrThrow(
  env,
  request,
  scope,
  limit,
  windowSeconds,
  identity = ''
) {
  const result = await enforceRateLimit(
    env, request, scope, limit, windowSeconds, identity
  );

  if (!result.allowed) {
    const err = new Error('Rate limit exceeded.');
    err.status = 429;
    err.retryAfter = result.retryAfter;
    throw err;
  }

  return result;
}

export async function enforceProviderThrottleOrThrow(
  env,
  providerKey,
  intervalMs = 5000
) {
  const key = String(providerKey || '').trim().toLowerCase();

  if (!/^[a-z0-9_-]{1,64}$/.test(key)) {
    throw new Error('Invalid provider throttle key.');
  }

  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1000 || intervalMs > 300000) {
    throw new Error('Invalid provider throttle interval.');
  }

  const db = requireDatabase(env);
  const now = Date.now();
  const nextAllowedAt = now + intervalMs;

  const acquired = await db.prepare(`
    INSERT INTO provider_throttles (provider_key, next_allowed_at)
    VALUES (?, ?)
    ON CONFLICT(provider_key) DO UPDATE SET
      next_allowed_at = excluded.next_allowed_at
    WHERE provider_throttles.next_allowed_at <= ?
    RETURNING next_allowed_at
  `).bind(key, nextAllowedAt, now).first();

  if (acquired) {
    return { allowed: true, retryAfter: 0 };
  }

  const current = await db.prepare(
    'SELECT next_allowed_at FROM provider_throttles WHERE provider_key = ?'
  ).bind(key).first();

  const retryAfter = Math.max(
    1,
    Math.ceil((Number(current?.next_allowed_at || now + intervalMs) - Date.now()) / 1000)
  );

  const err = new Error('Shared provider throttle is active.');
  err.status = 503;
  err.code = 'PROVIDER_THROTTLED';
  err.retryAfter = retryAfter;
  throw err;
}
