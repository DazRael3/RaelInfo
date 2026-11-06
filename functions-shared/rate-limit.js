import { requireDatabase, sha256Base64Url } from './http.js';

let lastCleanupAt = 0;

export async function enforceRateLimit(env, request, scope, limit = 8, windowSeconds = 900) {
  const db = requireDatabase(env);
  if (Date.now() - lastCleanupAt > 86_400_000) {
    lastCleanupAt = Date.now();
    await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(Math.floor(Date.now() / 1000) - 172_800).run();
  }
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const keyHash = await sha256Base64Url(`${scope}:${ip}`);
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  await db.prepare(`
    INSERT INTO rate_limits (bucket_key, window_start, hits)
    VALUES (?, ?, 1)
    ON CONFLICT(bucket_key, window_start) DO UPDATE SET hits = hits + 1
  `).bind(keyHash, windowStart).run();
  const row = await db.prepare('SELECT hits FROM rate_limits WHERE bucket_key = ? AND window_start = ?')
    .bind(keyHash, windowStart).first();
  const retryAfter = Math.max(1, windowStart + windowSeconds - now);
  if (Number(row?.hits || 0) > limit) return { allowed: false, retryAfter };
  return { allowed: true, retryAfter };
}
