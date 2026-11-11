import { cachedJson } from './cache.js';
import { enforceProviderThrottleOrThrow } from './rate-limit.js';

export const NEWS_SOURCES = Object.freeze([
  {
    id: 'sec',
    name: 'U.S. Securities and Exchange Commission',
    url: 'https://www.sec.gov/news/pressreleases.rss',
    host: 'sec.gov'
  },
  {
    id: 'federal-reserve',
    name: 'Federal Reserve',
    url: 'https://www.federalreserve.gov/feeds/press_all.xml',
    host: 'federalreserve.gov'
  },
  {
    id: 'bank-of-canada',
    name: 'Bank of Canada',
    url: 'https://www.bankofcanada.ca/content_type/press-releases/feed/',
    host: 'bankofcanada.ca'
  }
]);

const CACHE_TTL_SECONDS = 300;
const MAX_STALE_SECONDS = 86400;
const MAX_FEED_BYTES = 1_000_000;
const MAX_ARTICLES_PER_SOURCE = 60;

function decodeXml(value) {
  return String(value || '').replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (match, entity) => {
      const key = entity.toLowerCase();

      if (key === 'amp') return '&';
      if (key === 'lt') return '<';
      if (key === 'gt') return '>';
      if (key === 'quot') return '"';
      if (key === 'apos') return "'";

      const code = key.startsWith('#x')
        ? Number.parseInt(key.slice(2), 16)
        : Number.parseInt(key.slice(1), 10);

      if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) {
        return match;
      }

      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
  );
}

function cleanXmlText(value) {
  return decodeXml(
    String(value || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
  ).trim();
}

function readXmlTag(block, names) {
  for (const name of names) {
    const pattern = new RegExp(
      `<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${name}\\s*>`,
      'i'
    );

    const match = block.match(pattern);

    if (match?.[1]) {
      return cleanXmlText(match[1]);
    }
  }

  return '';
}

function normalizeArticleDate(value) {
  if (!value) return null;

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : null;
}

function allowedPublisherUrl(value, source) {
  try {
    const url = new URL(value);

    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      (
        url.hostname === source.host ||
        url.hostname.endsWith(`.${source.host}`)
      )
    ) ? url.href : null;
  } catch {
    return null;
  }
}

export function parseOfficialFeed(xml, source) {
  if (!NEWS_SOURCES.some(item => item.id === source?.id)) {
    throw new Error('Unknown official news publisher.');
  }

  if (typeof xml !== 'string' || !xml.trim()) {
    throw new Error(`${source.name} returned an empty feed.`);
  }

  if (new TextEncoder().encode(xml).byteLength > MAX_FEED_BYTES) {
    throw new Error(`${source.name} feed exceeded the response size limit.`);
  }

  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error(`${source.name} returned unsupported XML declarations.`);
  }

  const blocks = [
    ...xml.matchAll(/<item\b[^>]*>[\s\S]*?<\/item\s*>/gi)
  ];

  const articles = [];

  for (const match of blocks.slice(0, MAX_ARTICLES_PER_SOURCE)) {
    const block = match[0];

    const title = readXmlTag(block, ['title']).slice(0, 400);

    const rawLink =
      readXmlTag(block, ['link']) ||
      block.match(/\brdf:about\s*=\s*["']([^"']+)["']/i)?.[1] ||
      '';

    const url = allowedPublisherUrl(
      cleanXmlText(rawLink),
      source
    );

    if (!title || !url) continue;

    const publishedAt = normalizeArticleDate(
      readXmlTag(block, [
        'pubDate',
        'date',
        'published',
        'updated'
      ])
    );

    const description = readXmlTag(block, [
      'description',
      'summary',
      'content'
    ]).slice(0, 1000);

    articles.push({
      title,
      url,
      source: source.name,
      publishedAt,
      language: 'en',
      description
    });
  }

  const unique = new Map();

  for (const article of articles) {
    if (!unique.has(article.url)) {
      unique.set(article.url, article);
    }
  }

  const result = [...unique.values()];

  if (!result.length) {
    throw new Error(`${source.name} returned no valid articles.`);
  }

  return result;
}

export function matchesNewsQuery(article, query) {
  const clauses = String(query || '')
    .split(/\s+OR\s+/i)
    .map(clause =>
      clause.toLowerCase().match(/[a-z0-9]+/g) || []
    )
    .filter(words => words.length > 0);

  if (!clauses.length) return true;

  const searchable = [
    article.title,
    article.description,
    article.source
  ].join(' ').toLowerCase();

  return clauses.some(words =>
    words.every(word => searchable.includes(word))
  );
}

async function fetchOfficialSource(source) {
  const response = await fetch(source.url, {
    method: 'GET',
    headers: {
      Accept: 'application/rss+xml, application/rdf+xml, application/xml, text/xml;q=0.9',
      'User-Agent': 'RaelInfo/3.2.0 (contact=support@raelinfo.com)'
    },
    signal: AbortSignal.timeout(12000),
    redirect: 'follow'
  });

  if (!response.ok) {
    const err = new Error(
      `${source.name} returned HTTP ${response.status}.`
    );
    err.status = response.status;

    const retryAfter = Number(response.headers.get('Retry-After'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      err.retryAfter = Math.min(3600, Math.ceil(retryAfter));
    }

    throw err;
  }

  const contentType = response.headers.get('content-type') || '';

  if (!/(xml|rss|rdf)/i.test(contentType)) {
    throw new Error(`${source.name} returned an unexpected content type.`);
  }

  const declaredLength = Number(
    response.headers.get('content-length') || 0
  );

  if (declaredLength > MAX_FEED_BYTES) {
    throw new Error(`${source.name} feed exceeded the response size limit.`);
  }

  const xml = await response.text();

  return parseOfficialFeed(xml, source);
}

async function getSourceArticles(env, source) {
  return cachedJson(
    env,
    `news-official:${source.id}:v1`,
    CACHE_TTL_SECONDS,
    () => fetchOfficialSource(source),
    MAX_STALE_SECONDS,
    () => enforceProviderThrottleOrThrow(
      env,
      `news-${source.id}`,
      5000
    )
  );
}

export async function getOfficialNews(env, query) {
  const results = await Promise.allSettled(
    NEWS_SOURCES.map(async source => ({
      source,
      result: await getSourceArticles(env, source)
    }))
  );

  const articles = [];
  const availableSources = [];
  const unavailableSources = [];
  const failures = [];

  let allStale = true;
  let latestSavedAt = 0;

  for (let index = 0; index < results.length; index += 1) {
    const entry = results[index];
    const source = NEWS_SOURCES[index];

    if (entry.status !== 'fulfilled') {
      unavailableSources.push(source.name);
      failures.push(entry.reason);
      continue;
    }

    const { result } = entry.value;

    availableSources.push(source.name);
    allStale = allStale && result.stale;
    latestSavedAt = Math.max(latestSavedAt, result.savedAt);

    for (const article of result.data) {
      if (matchesNewsQuery(article, query)) {
        articles.push({
          ...article,
          stale: result.stale
        });
      }
    }
  }

  if (!availableSources.length) {
    const err = new Error('All official news sources are temporarily unavailable.');

    const retryable = failures.find(item =>
      item?.code === 'PROVIDER_THROTTLED' ||
      item?.status === 429 ||
      item?.status === 503
    );

    if (retryable) {
      err.status = 503;
      err.retryAfter = retryable.retryAfter || 30;
    } else {
      err.status = 502;
    }

    throw err;
  }

  const unique = new Map();

  for (const article of articles) {
    if (!unique.has(article.url)) {
      unique.set(article.url, article);
    }
  }

  const sortedArticles = [...unique.values()]
    .sort((a, b) =>
      (Date.parse(b.publishedAt || '') || 0) -
      (Date.parse(a.publishedAt || '') || 0)
    )
    .slice(0, 60);

  return {
    articles: sortedArticles,
    availableSources,
    unavailableSources,
    stale: allStale,
    savedAt: latestSavedAt || Math.floor(Date.now() / 1000),
    source: 'Official financial and economic releases'
  };
}
