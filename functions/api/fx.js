import { json, error, requireDatabase } from '../../functions-shared/http.js';
import { cachedJson, cacheHeaders } from '../../functions-shared/cache.js';
import { enforceRateLimitOrThrow } from '../../functions-shared/rate-limit.js';
import { fetchJson } from '../../functions-shared/providers.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const from = String(url.searchParams.get('from') || 'USD').toUpperCase();
  const to = String(url.searchParams.get('to') || 'CAD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || from === to) return error('Provide two different three-letter currency codes.', 400);
  try {
    requireDatabase(env);
    const result = await cachedJson(env, `fx:${from}:${to}`, 21_600, async () => {
      const data = await fetchJson(`https://api.frankfurter.dev/v2/rate/${from.toLowerCase()}/${to.toLowerCase()}`);
      if (!data || !Number.isFinite(Number(data.rate)) || data.base !== from || data.quote !== to) throw new Error('Unexpected FX response.');
      return data;
    }, 86_400, () => enforceRateLimitOrThrow(env, request, 'market-fx', 30, 60));
    return json(result.data, 200, cacheHeaders(result));
  } catch (err) {
    if (err?.status === 429) {
      return error('Market data is being refreshed too frequently. Please retry shortly.', 429, {
        'Retry-After': String(err.retryAfter || 60)
      });
    }
    console.error('FX data error:', err.message);
    return error('Exchange-rate data is temporarily unavailable.', 502);
  }
}
