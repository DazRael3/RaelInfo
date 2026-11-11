import { json, error, requireDatabase } from '../../functions-shared/http.js';
import { enforceRateLimitOrThrow } from '../../functions-shared/rate-limit.js';
import { getOfficialNews } from '../../functions-shared/news.js';

export async function onRequestGet({ request, env }) {
  const query = String(
    new URL(request.url).searchParams.get('q') ||
    'business OR finance OR stock market'
  ).trim().slice(0, 120);

  if (!query || /[<>\u0000-\u001f]/.test(query)) {
    return error('Enter a valid news search phrase.', 400);
  }

  try {
    requireDatabase(env);

    await enforceRateLimitOrThrow(
      env, request, 'market-news', 30, 60
    );

    const result = await getOfficialNews(env, query);

    return json({
      query,
      articles: result.articles,
      stale: result.stale,
      retrievedAt: new Date(result.savedAt * 1000).toISOString(),
      source: result.source,
      availableSources: result.availableSources,
      unavailableSources: result.unavailableSources
    }, 200, {
      'X-RaelInfo-Cache': result.stale ? 'stale' : 'fresh',
      'X-RaelInfo-Data-Time': new Date(
        result.savedAt * 1000
      ).toISOString(),
      ...(result.stale
        ? { Warning: '110 - "Response is stale"' }
        : {})
    });

  } catch (err) {
    if (err?.status === 429) {
      return error(
        'News searches are being requested too frequently. Please retry shortly.',
        429,
        { 'Retry-After': String(err.retryAfter || 60) }
      );
    }

    if (err?.status === 503) {
      return error(
        'Official news sources are cooling down. Please retry shortly.',
        503,
        { 'Retry-After': String(err.retryAfter || 30) }
      );
    }

    console.error('Official news service error:', err?.message || err);

    return error(
      'Official financial news is temporarily unavailable. Please retry later.',
      502
    );
  }
}
