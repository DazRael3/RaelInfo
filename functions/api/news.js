import { json, error, requireDatabase } from '../../functions-shared/http.js';
import { cachedJson, cacheHeaders } from '../../functions-shared/cache.js';
import { fetchJson } from '../../functions-shared/providers.js';

export async function onRequestGet({ request, env }) {
  const query = String(new URL(request.url).searchParams.get('q') || 'business OR finance OR stock market').trim().slice(0, 120);
  if (!query || /[<>\u0000-\u001f]/.test(query)) return error('Enter a valid news search phrase.', 400);
  try {
    requireDatabase(env);
    const result = await cachedJson(env, `news:${query.toLowerCase()}`, 300, async () => {
      const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
      url.search = new URLSearchParams({ query, mode: 'ArtList', format: 'json', maxrecords: '15', timespan: '7d', sort: 'datedesc' });
      const data = await fetchJson(url, { headers: { 'User-Agent': 'RaelInfo/3.0 (business and market news)' } });
      const docs = Array.isArray(data.articles) ? data.articles : [];
      return docs.map(item => ({
        title: String(item.title || '').slice(0, 400),
        url: String(item.url || ''),
        source: String(item.domain || item.source || ''),
        publishedAt: item.seendate || item.datetime || null,
        language: item.language || null
      })).filter(item => item.title && /^https?:\/\//i.test(item.url));
    });
    return json({ query, articles: result.data, stale: result.stale, retrievedAt: new Date(result.savedAt * 1000).toISOString(), source: 'GDELT DOC API' }, 200, cacheHeaders(result));
  } catch (err) {
    console.error('News provider error:', err.message);
    return error('Business news is temporarily unavailable. Please retry in a few minutes.', 502);
  }
}
