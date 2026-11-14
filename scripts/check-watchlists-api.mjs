import assert from 'node:assert/strict';

import {
  onRequestGet as getWatchlists,
  onRequestPost as createWatchlist
} from '../functions/api/watchlists/index.js';

import {
  onRequestPatch as renameWatchlist,
  onRequestDelete as deleteWatchlist
} from '../functions/api/watchlists/[id].js';

import {
  onRequestPost as addWatchlistItem,
  onRequestDelete as removeWatchlistItem
} from '../functions/api/watchlists/[id]/items.js';

const origin = 'https://www.raelinfo.com';

const users = new Map([
  ['alice-token', { id: 'watchlist-alice', email: 'alice-test@example.com' }],
  ['bob-token', { id: 'watchlist-bob', email: 'bob-test@example.com' }],
  ['rate-token', { id: 'watchlist-rate', email: 'rate-test@example.com' }],
  ['limit-token', { id: 'watchlist-limit', email: 'limit-test@example.com' }]
]);

const state = {
  watchlists: new Map(),
  items: new Map(),
  rateLimits: new Map(),
  profiles: new Set()
};

const db = {
  prepare(sql) {
    let values = [];

    return {
      bind(...args) {
        values = args;
        return this;
      },

      async run() {
        if (sql.includes('INSERT INTO users')) {
          return {};
        }

        if (sql.includes('DELETE FROM rate_limits')) {
          return {};
        }

        if (sql.includes('INSERT INTO rate_limits')) {
          const key = `${values[0]}:${values[1]}`;
          state.rateLimits.set(key, (state.rateLimits.get(key) || 0) + 1);
          return {};
        }

        if (sql.includes('INSERT INTO watchlists')) {
          const [id, userId, name, createdAt, updatedAt] = values;

          if ([...state.watchlists.values()].some(
            list => list.user_id === userId && list.name === name
          )) {
            throw new Error('UNIQUE constraint failed: watchlists.user_id, watchlists.name');
          }

          state.watchlists.set(id, {
            id,
            user_id: userId,
            name,
            created_at: createdAt,
            updated_at: updatedAt
          });

          return { meta: { changes: 1 } };
        }

        if (sql.includes('INSERT INTO watchlist_items')) {
          const [id, watchlistId, symbol, createdAt] = values;

          if ([...state.items.values()].some(
            item => item.watchlist_id === watchlistId && item.symbol === symbol
          )) {
            throw new Error('UNIQUE constraint failed: watchlist_items.watchlist_id, watchlist_items.symbol');
          }

          state.items.set(id, {
            id,
            watchlist_id: watchlistId,
            symbol,
            created_at: createdAt
          });

          return { meta: { changes: 1 } };
        }

        if (sql.includes('UPDATE watchlists SET name=')) {
          const [name, updatedAt, id, userId] = values;
          const list = state.watchlists.get(id);

          if (!list || list.user_id !== userId) {
            return { meta: { changes: 0 } };
          }

          if ([...state.watchlists.values()].some(
            other => other.id !== id &&
              other.user_id === userId &&
              other.name === name
          )) {
            throw new Error('UNIQUE constraint failed: watchlists.user_id, watchlists.name');
          }

          list.name = name;
          list.updated_at = updatedAt;
          return { meta: { changes: 1 } };
        }

        if (sql.includes('UPDATE watchlists SET updated_at=')) {
          const [updatedAt, id, userId] = values;
          const list = state.watchlists.get(id);

          if (!list || list.user_id !== userId) {
            return { meta: { changes: 0 } };
          }

          list.updated_at = updatedAt;
          return { meta: { changes: 1 } };
        }

        if (sql.includes('DELETE FROM watchlists')) {
          const [id, userId] = values;
          const list = state.watchlists.get(id);

          if (!list || list.user_id !== userId) {
            return { meta: { changes: 0 } };
          }

          state.watchlists.delete(id);

          for (const [itemId, item] of state.items) {
            if (item.watchlist_id === id) state.items.delete(itemId);
          }

          return { meta: { changes: 1 } };
        }

        if (sql.includes('DELETE FROM watchlist_items')) {
          const [watchlistId, symbol] = values;
          const item = [...state.items.values()].find(
            entry => entry.watchlist_id === watchlistId &&
              entry.symbol === symbol
          );

          if (!item) return { meta: { changes: 0 } };

          state.items.delete(item.id);
          return { meta: { changes: 1 } };
        }

        throw new Error(`Unexpected test database statement: ${sql}`);
      },

      async first() {
        if (sql.includes('SELECT hits FROM rate_limits')) {
          const [bucket, window] = values;
          return { hits: state.rateLimits.get(`${bucket}:${window}`) || 0 };
        }

        if (sql.includes('SELECT COUNT(*) AS total FROM watchlists')) {
          const [userId] = values;
          return {
            total: [...state.watchlists.values()].filter(
              list => list.user_id === userId
            ).length
          };
        }

        if (sql.includes('SELECT COUNT(*) AS total FROM watchlist_items')) {
          const [watchlistId] = values;
          return {
            total: [...state.items.values()].filter(
              item => item.watchlist_id === watchlistId
            ).length
          };
        }

        if (sql.includes('SELECT id FROM watchlists WHERE id=? AND user_id=?')) {
          const [id, userId] = values;
          const list = state.watchlists.get(id);

          return list?.user_id === userId ? { id } : null;
        }

        throw new Error(`Unexpected test database first query: ${sql}`);
      },

      async all() {
        if (sql.includes('FROM watchlists WHERE user_id=?')) {
          const [userId] = values;

          return {
            results: [...state.watchlists.values()]
              .filter(list => list.user_id === userId)
              .map(({ id, name, created_at, updated_at }) => ({
                id,
                name,
                createdAt: created_at,
                updatedAt: updated_at
              }))
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          };
        }

        if (sql.includes('FROM watchlist_items i JOIN watchlists w')) {
          const [userId] = values;
          const ownedIds = new Set(
            [...state.watchlists.values()]
              .filter(list => list.user_id === userId)
              .map(list => list.id)
          );

          return {
            results: [...state.items.values()]
              .filter(item => ownedIds.has(item.watchlist_id))
              .map(item => ({
                id: item.id,
                watchlistId: item.watchlist_id,
                symbol: item.symbol,
                createdAt: item.created_at
              }))
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          };
        }

        throw new Error(`Unexpected test database all query: ${sql}`);
      }
    };
  }
};

const env = {
  DB: db,
  SUPABASE_URL: 'https://project.example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key'
};

const originalFetch = globalThis.fetch;

globalThis.fetch = async (url, options = {}) => {
  if (String(url).endsWith('/auth/v1/user')) {
    const authorization = options.headers?.Authorization || '';
    const token = authorization.replace(/^Bearer\s+/i, '');
    const user = users.get(token);

    if (!user) {
      return new Response(JSON.stringify({ message: 'Invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(user), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  throw new Error(`Unexpected network request in local test: ${url}`);
};

let ipCounter = 1;

function makeRequest(path, {
  token = 'alice-token',
  method = 'GET',
  body,
  csrf = true,
  originHeader = origin,
  ip
} = {}) {
  const headers = {
    Origin: originHeader,
    'Sec-Fetch-Site': 'same-origin',
    'CF-Connecting-IP': ip || `192.0.2.${ipCounter++}`,
    Cookie: `raelinfo_access=${token}; raelinfo_csrf=${csrf ? 'test-csrf-token' : 'wrong-token'}`
  };

  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf) headers['X-CSRF-Token'] = 'test-csrf-token';

  return new Request(`${origin}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

async function call(handler, path, options = {}, params = {}) {
  return handler({
    request: makeRequest(path, options),
    env,
    params
  });
}

async function create(name, options = {}) {
  return call(
    createWatchlist,
    '/api/watchlists',
    { method: 'POST', body: { name }, ...options }
  );
}

async function add(listId, symbol, options = {}) {
  return call(
    addWatchlistItem,
    `/api/watchlists/${listId}/items`,
    { method: 'POST', body: { symbol }, ...options },
    { id: listId }
  );
}

try {
  // Alice creates a list.
  const created = await create('Long-term ideas');
  assert.equal(created.status, 201);

  const createdBody = await created.json();
  const aliceListId = createdBody.watchlist.id;

  assert.ok(aliceListId);
  assert.equal(createdBody.watchlist.name, 'Long-term ideas');
  console.log('PASS: Authenticated user can create a watchlist.');

  // Duplicate list names are rejected.
  const duplicateName = await create('Long-term ideas');
  assert.equal(duplicateName.status, 409);
  console.log('PASS: Duplicate watchlist names are rejected.');

  // Alice adds tickers.
  const added = await add(aliceListId, ' aapl ');
  assert.equal(added.status, 201);
  assert.equal((await added.json()).item.symbol, 'AAPL');

  const addedSecond = await add(aliceListId, 'BRK.B');
  assert.equal(addedSecond.status, 201);
  console.log('PASS: User can add normalized ticker symbols.');

  // Duplicate tickers are rejected.
  const duplicateTicker = await add(aliceListId, 'AAPL');
  assert.equal(duplicateTicker.status, 409);
  console.log('PASS: Duplicate tickers are rejected.');

  // Bob creates a private list and ticker.
  const bobCreated = await create('Bob private list', { token: 'bob-token' });
  assert.equal(bobCreated.status, 201);
  const bobListId = (await bobCreated.json()).watchlist.id;

  const bobAdded = await add(bobListId, 'TSLA', { token: 'bob-token' });
  assert.equal(bobAdded.status, 201);
  console.log('PASS: A second user can create and populate an independent list.');

  // Alice cannot see Bob's list or its ticker.
  const aliceRead = await call(
    getWatchlists,
    '/api/watchlists',
    { token: 'alice-token' }
  );
  assert.equal(aliceRead.status, 200);

  const aliceData = await aliceRead.json();
  assert.ok(aliceData.watchlists.some(list => list.id === aliceListId));
  assert.ok(!aliceData.watchlists.some(list => list.id === bobListId));
  assert.ok(!JSON.stringify(aliceData).includes('TSLA'));
  console.log('PASS: Watchlist reads are isolated by authenticated user.');

  const bobRead = await call(
    getWatchlists,
    '/api/watchlists',
    { token: 'bob-token' }
  );
  const bobData = await bobRead.json();
  assert.equal(bobData.watchlists.length, 1);
  assert.equal(bobData.watchlists[0].id, bobListId);
  assert.equal(bobData.watchlists[0].items[0].symbol, 'TSLA');
  console.log('PASS: Each user can read their own saved tickers.');

  // Alice cannot rename or delete Bob's list.
  const foreignRename = await call(
    renameWatchlist,
    `/api/watchlists/${bobListId}`,
    { method: 'PATCH', body: { name: 'Stolen list' } },
    { id: bobListId }
  );
  assert.equal(foreignRename.status, 404);

  const foreignDelete = await call(
    deleteWatchlist,
    `/api/watchlists/${bobListId}`,
    { method: 'DELETE' },
    { id: bobListId }
  );
  assert.equal(foreignDelete.status, 404);

  // Alice cannot add or remove items from Bob's list.
  const foreignAdd = await add(bobListId, 'NVDA');
  assert.equal(foreignAdd.status, 404);

  const foreignRemove = await call(
    removeWatchlistItem,
    `/api/watchlists/${bobListId}/items?symbol=TSLA`,
    { method: 'DELETE' },
    { id: bobListId }
  );
  assert.equal(foreignRemove.status, 404);

  assert.ok(state.watchlists.has(bobListId));
  assert.ok([...state.items.values()].some(
    item => item.watchlist_id === bobListId && item.symbol === 'TSLA'
  ));
  console.log('PASS: User cannot rename, delete, add to, or remove tickers from another user’s list.');

  // Alice can rename her own list.
  const renamed = await call(
    renameWatchlist,
    `/api/watchlists/${aliceListId}`,
    { method: 'PATCH', body: { name: 'Retirement research' } },
    { id: aliceListId }
  );
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).name, 'Retirement research');
  console.log('PASS: User can rename their own watchlist.');

  // Alice can remove one of her own tickers.
  const removed = await call(
    removeWatchlistItem,
    `/api/watchlists/${aliceListId}/items?symbol=BRK.B`,
    { method: 'DELETE' },
    { id: aliceListId }
  );
  assert.equal(removed.status, 200);
  assert.ok(![...state.items.values()].some(
    item => item.watchlist_id === aliceListId && item.symbol === 'BRK.B'
  ));
  console.log('PASS: User can remove a ticker from their own watchlist.');

  // Invalid symbols are rejected.
  const invalidSymbol = await add(aliceListId, 'AAPL/TSLA');
  assert.equal(invalidSymbol.status, 400);
  console.log('PASS: Invalid ticker symbols are rejected.');

  // CSRF and origin protections.
  const noCsrf = await create('No CSRF list', { csrf: false });
  assert.equal(noCsrf.status, 403);

  const wrongOrigin = await create('Wrong origin list', {
    originHeader: 'https://attacker.example'
  });
  assert.equal(wrongOrigin.status, 403);
  console.log('PASS: Missing CSRF tokens and cross-origin mutations are rejected.');

  // Unauthenticated access is rejected.
  const unauthenticatedRead = await call(
    getWatchlists,
    '/api/watchlists',
    { token: '' }
  );
  assert.equal(unauthenticatedRead.status, 401);

  const unauthenticatedCreate = await create('Unauthenticated list', {
    token: ''
  });
  assert.equal(unauthenticatedCreate.status, 401);
  console.log('PASS: Unauthenticated watchlist access and creation are rejected.');

  // Create a separate user for the watchlist-count limit.
  for (let index = 0; index < 19; index += 1) {
    const response = await create(`Limit list ${index + 1}`, {
      token: 'bob-token'
    });
    assert.equal(response.status, 201, `Watchlist ${index + 1} should be allowed`);
  }

  const overListLimit = await create('Twenty-first list', {
    token: 'bob-token'
  });
  assert.equal(overListLimit.status, 400);
  console.log('PASS: The 20-watchlist per-user limit is enforced.');

  // Create a separate list for the 100-symbol limit.
  const capListResponse = await create('Ticker capacity', {
    token: 'rate-token'
  });
  assert.equal(capListResponse.status, 201);
  const capListId = (await capListResponse.json()).watchlist.id;

  for (let index = 0; index < 100; index += 1) {
    const symbol = `T${index}`;
    const response = await add(capListId, symbol, {
      token: 'rate-token'
    });
    assert.equal(response.status, 201, `Ticker ${symbol} should be allowed`);
  }

  const overTickerLimit = await add(capListId, 'OVER', {
    token: 'rate-token'
  });
  assert.equal(overTickerLimit.status, 400);
  console.log('PASS: The 100-ticker per-watchlist limit is enforced.');

  // Rate limiting uses 41 ticker additions, avoiding the 20-list cap.
  const rateListResponse = await create('Rate limit list', {
    token: 'limit-token',
    ip: '198.51.100.249'
  });
  assert.equal(rateListResponse.status, 201);
  const rateListId = (await rateListResponse.json()).watchlist.id;

  let lastRateResponse;

  for (let index = 0; index < 41; index += 1) {
    lastRateResponse = await add(rateListId, `R${index}`, {
      token: 'limit-token',
      ip: '198.51.100.250'
    });

    if (index < 40) {
      assert.equal(
        lastRateResponse.status,
        201,
        `Rate-limit request ${index + 1} should be allowed`
      );
    }
  }

  assert.equal(lastRateResponse.status, 429);
  assert.ok(Number(lastRateResponse.headers.get('Retry-After')) >= 1);
  console.log('PASS: The 41st watchlist mutation in the rate window is blocked.');

  // Alice can delete her own list; its items cascade away.
  const deleteOwn = await call(
    deleteWatchlist,
    `/api/watchlists/${aliceListId}`,
    { method: 'DELETE' },
    { id: aliceListId }
  );

  assert.equal(deleteOwn.status, 200);
  assert.ok(!state.watchlists.has(aliceListId));
  assert.ok(![...state.items.values()].some(
    item => item.watchlist_id === aliceListId
  ));
  console.log('PASS: Deleting an owned list removes its associated items.');

  // Bob's list remains untouched by Alice's operations.
  assert.ok(state.watchlists.has(bobListId));
  assert.ok([...state.items.values()].some(
    item => item.watchlist_id === bobListId && item.symbol === 'TSLA'
  ));
  console.log('PASS: Other users’ records remain intact after deletion.');

  console.log('\nAll watchlist API endpoint tests passed.');
} finally {
  globalThis.fetch = originalFetch;
}