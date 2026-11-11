import assert from 'node:assert/strict';
import {
  NEWS_SOURCES,
  parseOfficialFeed,
  matchesNewsQuery
} from '../functions-shared/news.js';
import { onRequestGet } from '../functions/api/news.js';

const [sec, fed, canada] = NEWS_SOURCES;

const secXml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<item>
<title>Finance market oversight announcement</title>
<link>https://www.sec.gov/news/press-release-one</link>
<pubDate>Wed, 11 Nov 2026 12:00:00 GMT</pubDate>
<description>Official financial markets announcement.</description>
</item>
</channel></rss>`;

const fedXml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<item>
<title><![CDATA[Finance and monetary policy update]]></title>
<link>https://www.federalreserve.gov/newsevents/pressreleases/test.htm</link>
<pubDate>Wed, 11 Nov 2026 13:00:00 GMT</pubDate>
<description>Federal Reserve policy announcement.</description>
</item>
</channel></rss>`;

const canadaXml = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
xmlns="http://purl.org/rss/1.0/"
xmlns:dc="http://purl.org/dc/elements/1.1/">
<item rdf:about="https://www.bankofcanada.ca/2026/11/financial-policy-update/">
<title>Finance and financial stability update</title>
<link>https://www.bankofcanada.ca/2026/11/financial-policy-update/</link>
<dc:date>2026-11-11T14:00:00Z</dc:date>
<description>Bank of Canada announcement.</description>
</item>
</rdf:RDF>`;

const secArticles = parseOfficialFeed(secXml, sec);
const fedArticles = parseOfficialFeed(fedXml, fed);
const canadaArticles = parseOfficialFeed(canadaXml, canada);

assert.equal(secArticles.length, 1);
assert.equal(fedArticles.length, 1);
assert.equal(canadaArticles.length, 1);
assert.equal(secArticles[0].source, sec.name);
assert.equal(fedArticles[0].source, fed.name);
assert.equal(canadaArticles[0].source, canada.name);
assert.equal(secArticles[0].publishedAt, '2026-11-11T12:00:00.000Z');
assert.equal(fedArticles[0].title, 'Finance and monetary policy update');
assert.equal(canadaArticles[0].publishedAt, '2026-11-11T14:00:00.000Z');

console.log('PASS: SEC RSS, Federal Reserve RSS and Bank of Canada RDF feeds parse correctly.');

assert.throws(
  () => parseOfficialFeed(
    '<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss/>',
    sec
  ),
  /unsupported XML declarations/
);

assert.throws(
  () => parseOfficialFeed(
    `<rss><item><title>External</title><link>https://example.com/story</link></item></rss>`,
    sec
  ),
  /no valid articles/
);

assert.throws(
  () => parseOfficialFeed(
    `<rss><item><title>Wrong host</title><link>https://evil.sec.gov.example.com/story</link></item></rss>`,
    sec
  ),
  /no valid articles/
);

assert.throws(
  () => parseOfficialFeed(
    `<rss>${'x'.repeat(1_000_001)}</rss>`,
    sec
  ),
  /size limit/
);

assert.throws(
  () => parseOfficialFeed('<rss/>', { id: 'unknown', name: 'Unknown', host: 'example.com' }),
  /Unknown official news publisher/
);

console.log('PASS: XML declarations, oversized feeds and untrusted article URLs are rejected.');

assert.equal(
  matchesNewsQuery(secArticles[0], 'finance OR cryptocurrency'),
  true
);
assert.equal(
  matchesNewsQuery(secArticles[0], 'cryptocurrency OR bitcoin'),
  false
);
assert.equal(
  matchesNewsQuery(secArticles[0], 'finance market'),
  true
);

console.log('PASS: OR search and multi-word matching work locally.');

// D1 mock for route, provider throttles and shared cache.
const rateRows = new Map();
const cacheRows = new Map();
const throttleRows = new Map();

const DB = {
  prepare(sql) {
    let values = [];

    return {
      bind(...args) {
        values = args;
        return this;
      },

      async run() {
        if (sql.includes('INSERT INTO rate_limits')) {
          const [bucket, window] = values;
          const key = `${bucket}:${window}`;
          rateRows.set(key, (rateRows.get(key) || 0) + 1);
        }

        if (sql.includes('INSERT INTO provider_cache')) {
          const [key, payload, savedAt, expiresAt] = values;
          cacheRows.set(key, {
            payload_json: payload,
            saved_at: savedAt,
            expires_at: expiresAt
          });
        }

        return {};
      },

      async first() {
        if (sql.includes('INSERT INTO provider_throttles')) {
          const [key, nextAllowedAt, now] = values;
          const current = throttleRows.get(key);

          if (current === undefined || current <= now) {
            throttleRows.set(key, nextAllowedAt);
            return { next_allowed_at: nextAllowedAt };
          }

          return null;
        }

        if (sql.includes('SELECT next_allowed_at')) {
          return {
            next_allowed_at: throttleRows.get(values[0]) ?? null
          };
        }

        if (sql.includes('SELECT hits')) {
          const [bucket, window] = values;
          return { hits: rateRows.get(`${bucket}:${window}`) || 0 };
        }

        if (sql.includes('SELECT payload_json')) {
          return cacheRows.get(values[0]) || null;
        }

        return null;
      }
    };
  }
};

const originalFetch = globalThis.fetch;
const fetchCounts = new Map();

const fixtures = new Map([
  [sec.url, secXml],
  [fed.url, fedXml],
  [canada.url, canadaXml]
]);

globalThis.fetch = async input => {
  const url = String(input);
  const source = NEWS_SOURCES.find(item => item.url === url);

  if (!source) throw new Error(`Unexpected upstream URL: ${url}`);

  fetchCounts.set(source.id, (fetchCounts.get(source.id) || 0) + 1);

  if (source.id === 'bank-of-canada') {
    return new Response('Temporarily unavailable', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  return new Response(fixtures.get(url), {
    status: 200,
    headers: {
      'Content-Type': source.id === 'federal-reserve'
        ? 'text/xml'
        : 'application/rss+xml'
    }
  });
};

try {
  const env = { DB };

  const response = await onRequestGet({
    request: new Request(
      'https://www.raelinfo.com/api/news?q=finance',
      { headers: { 'CF-Connecting-IP': '192.0.2.80' } }
    ),
    env
  });

  assert.equal(response.status, 200);

  const body = await response.json();

  assert.equal(body.source, 'Official financial and economic releases');
  assert.equal(body.articles.length, 2);
  assert.equal(body.availableSources.length, 2);
  assert.equal(body.unavailableSources.length, 1);
  assert.equal(body.stale, false);

  assert.equal(fetchCounts.get('sec'), 1);
  assert.equal(fetchCounts.get('federal-reserve'), 1);
  assert.equal(fetchCounts.get('bank-of-canada'), 1);

  console.log('PASS: News API returns available sources when one publisher is unavailable.');

  const secondResponse = await onRequestGet({
    request: new Request(
      'https://www.raelinfo.com/api/news?q=monetary',
      { headers: { 'CF-Connecting-IP': '192.0.2.81' } }
    ),
    env
  });

  assert.equal(secondResponse.status, 200);

  const secondBody = await secondResponse.json();

  assert.equal(secondBody.articles.length, 1);
  assert.equal(secondBody.articles[0].source, fed.name);

  assert.equal(fetchCounts.get('sec'), 1);
  assert.equal(fetchCounts.get('federal-reserve'), 1);
  assert.equal(fetchCounts.get('bank-of-canada'), 1);

  console.log('PASS: Different search phrases reuse the shared publisher caches.');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('All official news provider tests passed.');
