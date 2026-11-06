import { requireDatabase } from './http.js';

const memory = new Map();
const inFlight = new Map();

export async function cachedJson(env, key, ttlSeconds, loader, maxStaleSeconds = 86_400) {
  const now = Math.floor(Date.now() / 1000);
  const warm = memory.get(key);
  if (warm && warm.expiresAt > now) return { data: warm.data, stale: false, savedAt: warm.savedAt };

  const db = requireDatabase(env);
  const row = await db.prepare('SELECT payload_json, saved_at, expires_at FROM provider_cache WHERE cache_key = ?')
    .bind(key).first();
  let staleRow = null;
  if (row?.payload_json) {
    try {
      staleRow = { data: JSON.parse(row.payload_json), savedAt: Number(row.saved_at), expiresAt: Number(row.expires_at) };
      if (staleRow.expiresAt > now) {
        memory.set(key, staleRow);
        return { data: staleRow.data, stale: false, savedAt: staleRow.savedAt };
      }
    } catch { staleRow = null; }
  }

  if (inFlight.has(key)) return inFlight.get(key);
  const task = (async () => {
    try {
      const data = await loader();
      const savedAt = Math.floor(Date.now() / 1000);
      const entry = { data, savedAt, expiresAt: savedAt + ttlSeconds };
      memory.set(key, entry);
      await db.prepare(`
        INSERT INTO provider_cache (cache_key, payload_json, saved_at, expires_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          payload_json = excluded.payload_json,
          saved_at = excluded.saved_at,
          expires_at = excluded.expires_at
      `).bind(key, JSON.stringify(data), savedAt, savedAt + ttlSeconds).run();
      return { data, stale: false, savedAt };
    } catch (err) {
      if (staleRow && now - staleRow.savedAt <= maxStaleSeconds) {
        return { data: staleRow.data, stale: true, savedAt: staleRow.savedAt, upstreamError: err };
      }
      throw err;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, task);
  return task;
}

export function cacheHeaders(result) {
  return {
    'X-RaelInfo-Cache': result.stale ? 'stale' : 'fresh',
    'X-RaelInfo-Data-Time': new Date(result.savedAt * 1000).toISOString(),
    ...(result.stale ? { Warning: '110 - "Response is stale"' } : {})
  };
}
