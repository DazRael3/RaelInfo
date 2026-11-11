import assert from 'node:assert/strict';
import { cachedJson } from '../functions-shared/cache.js';
import { enforceRateLimitOrThrow } from '../functions-shared/rate-limit.js';

const rateRows = new Map();
const cacheRows = new Map();

const db = {
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
          const current = rateRows.get(key) || 0;
          rateRows.set(key, current + 1);
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

const env = { DB: db };

function request(ip = '192.0.2.50') {
  return new Request('https://www.raelinfo.com/api/crypto', {
    headers: { 'CF-Connecting-IP': ip }
  });
}

// A request within the limit is allowed.
const allowed = await enforceRateLimitOrThrow(
  env, request(), 'market-test', 1, 60
);
assert.equal(allowed.allowed, true);

// The next request receives a typed 429 error with a retry interval.
await assert.rejects(
  enforceRateLimitOrThrow(env, request(), 'market-test', 1, 60),
  err => err.status === 429 &&
    Number.isInteger(err.retryAfter) &&
    err.retryAfter >= 1
);
console.log('PASS: Market rate limits reject excess requests with retry metadata.');

// A cache miss invokes the guard and loader exactly once.
let guardCalls = 0;
let loaderCalls = 0;

const first = await cachedJson(
  env,
  'market-test:fresh',
  60,
  async () => {
    loaderCalls += 1;
    return { value: 'fresh-data' };
  },
  86_400,
  async () => { guardCalls += 1; }
);

assert.equal(first.data.value, 'fresh-data');
assert.equal(first.stale, false);
assert.equal(guardCalls, 1);
assert.equal(loaderCalls, 1);

// A warm in-memory cache does not consume another upstream limit.
const second = await cachedJson(
  env,
  'market-test:fresh',
  60,
  async () => {
    loaderCalls += 1;
    return { value: 'unexpected' };
  },
  86_400,
  async () => { guardCalls += 1; }
);

assert.equal(second.data.value, 'fresh-data');
assert.equal(guardCalls, 1);
assert.equal(loaderCalls, 1);
console.log('PASS: Cached responses do not consume upstream rate limits.');

// An expired but eligible D1 cache entry is served if refresh is blocked.
const now = Math.floor(Date.now() / 1000);
cacheRows.set('market-test:stale', {
  payload_json: JSON.stringify({ value: 'last-known-data' }),
  saved_at: now,
  expires_at: now - 1
});

const stale = await cachedJson(
  env,
  'market-test:stale',
  60,
  async () => {
    throw new Error('Loader must not run when refresh is blocked.');
  },
  86_400,
  async () => {
    const err = new Error('Rate limit exceeded.');
    err.status = 429;
    err.retryAfter = 30;
    throw err;
  }
);

assert.equal(stale.data.value, 'last-known-data');
assert.equal(stale.stale, true);
console.log('PASS: Eligible stale data remains available when refresh is rate-limited.');

// Without an eligible cached result, the typed 429 reaches the route.
await assert.rejects(
  cachedJson(
    env,
    'market-test:no-stale',
    60,
    async () => ({ value: 'unexpected' }),
    86_400,
    async () => {
      const err = new Error('Rate limit exceeded.');
      err.status = 429;
      err.retryAfter = 25;
      throw err;
    }
  ),
  err => err.status === 429 && err.retryAfter === 25
);
console.log('PASS: A blocked cache miss propagates HTTP 429 metadata.');
console.log('All market-data rate-limit tests passed.');
