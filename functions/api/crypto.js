import { json, error, requireDatabase } from '../../functions-shared/http.js';
import { cachedJson, cacheHeaders } from '../../functions-shared/cache.js';
import { fetchJson } from '../../functions-shared/providers.js';

export async function onRequestGet({ env }) {
  try {
    requireDatabase(env);
    const result = await cachedJson(env, 'crypto:btc-eth-sol', 60, async () => {
      const data = await fetchJson('https://api.coinlore.net/api/ticker/?id=90,80,48543');
      if (!Array.isArray(data) || data.length === 0) throw new Error('CoinLore returned an empty response.');
      return data;
    });
    return json(result.data, 200, cacheHeaders(result));
  } catch (err) {
    console.error('Crypto data error:', err.message);
    return error('Crypto market data is temporarily unavailable. Please try again.', 502);
  }
}
