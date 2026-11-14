import assert from 'node:assert/strict';

import {
  onRequestGet,
  onRequestPost
} from '../functions/api/price-alerts/index.js';

import {
  onRequestPatch,
  onRequestDelete
} from '../functions/api/price-alerts/[id].js';

const origin = 'https://www.raelinfo.com';

const users = {
  a: {
    id: 'price-alert-user-a',
    email: 'alert-a@example.com'
  },
  b: {
    id: 'price-alert-user-b',
    email: 'alert-b@example.com'
  }
};

const alerts = new Map();

function addAlert(id, userId, status = 'active') {
  alerts.set(id, {
    id,
    user_id: userId,
    symbol: 'AAPL',
    currency: 'USD',
    direction: 'above',
    target_price: 150,
    status,
    created_at: '2026-11-14T10:00:00.000Z',
    updated_at: '2026-11-14T10:00:00.000Z',
    triggered_at: status === 'triggered' ? '2026-11-14T10:01:00.000Z' : null,
    triggered_price: status === 'triggered' ? 155 : null
  });
}

addAlert('own-triggered', users.a.id, 'triggered');
addAlert('own-active', users.a.id, 'active');
addAlert('foreign-triggered', users.b.id, 'triggered');

const rateRows = new Map();

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
          const [bucket, window] = values;
          const key = `${bucket}:${window}`;
          rateRows.set(key, (rateRows.get(key) || 0) + 1);
          return {};
        }

        if (sql.includes('INSERT INTO price_alerts')) {
          const [
            id,
            userId,
            symbol,
            currency,
            direction,
            targetPrice,
            createdAt,
            updatedAt
          ] = values;

          alerts.set(id, {
            id,
            user_id: userId,
            symbol,
            currency,
            direction,
            target_price: targetPrice,
            status: 'active',
            created_at: createdAt,
            updated_at: updatedAt,
            triggered_at: null,
            triggered_price: null
          });

          return { meta: { changes: 1 } };
        }

        if (sql.includes('UPDATE price_alerts')) {
          const [updatedAt, id, userId] = values;
          const alert = alerts.get(id);

          if (
            !alert ||
            alert.user_id !== userId ||
            alert.status !== 'triggered'
          ) {
            return { meta: { changes: 0 } };
          }

          alert.status = 'active';
          alert.triggered_at = null;
          alert.triggered_price = null;
          alert.updated_at = updatedAt;

          return { meta: { changes: 1 } };
        }

        if (sql.includes('DELETE FROM price_alerts')) {
          const [id, userId] = values;
          const alert = alerts.get(id);

          if (!alert || alert.user_id !== userId) {
            return { meta: { changes: 0 } };
          }

          alerts.delete(id);
          return { meta: { changes: 1 } };
        }

        throw new Error(`Unexpected database run: ${sql}`);
      },

      async first() {
        if (sql.includes('SELECT hits FROM rate_limits')) {
          const [bucket, window] = values;
          return {
            hits: rateRows.get(`${bucket}:${window}`) || 0
          };
        }

        if (sql.includes('SELECT COUNT(*)')) {
          const [userId] = values;

          return {
            total: [...alerts.values()].filter(alert =>
              alert.user_id === userId &&
              alert.status === 'active'
            ).length
          };
        }

        throw new Error(`Unexpected database first: ${sql}`);
      },

      async all() {
        if (sql.includes('FROM price_alerts')) {
          const [userId] = values;

          const results = [...alerts.values()]
            .filter(alert => alert.user_id === userId)
            .map(alert => ({
              id: alert.id,
              symbol: alert.symbol,
              currency: alert.currency,
              direction: alert.direction,
              targetPrice: alert.target_price,
              status: alert.status,
              createdAt: alert.created_at,
              updatedAt: alert.updated_at,
              triggeredAt: alert.triggered_at,
              triggeredPrice: alert.triggered_price
            }));

          return { results };
        }

        throw new Error(`Unexpected database all: ${sql}`);
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

    if (authorization === 'Bearer user-a-token') {
      return new Response(JSON.stringify(users.a), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (authorization === 'Bearer user-b-token') {
      return new Response(JSON.stringify(users.b), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      message: 'Invalid token'
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  throw new Error(`Unexpected network request: ${url}`);
};

let requestNumber = 0;

function makeRequest(method, path, {
  user = 'a',
  body,
  csrf = true,
  originHeader = origin,
  ip
} = {}) {
  const headers = {
    Origin: originHeader,
    'Sec-Fetch-Site': 'same-origin',
    'CF-Connecting-IP': ip || `192.0.2.${(++requestNumber % 200) + 1}`
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  headers.Cookie = csrf
    ? 'raelinfo_csrf=test-csrf-token'
    : 'raelinfo_csrf=wrong-token';

  if (user) {
    headers.Cookie =
      `raelinfo_access=user-${user}-token; ${headers.Cookie}`;
  }

  if (csrf) {
    headers['X-CSRF-Token'] = 'test-csrf-token';
  }

  return new Request(`${origin}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
}

async function getAlerts(user = 'a') {
  return onRequestGet({
    request: makeRequest('GET', '/api/price-alerts', { user }),
    env
  });
}

async function createAlert(body, options = {}) {
  return onRequestPost({
    request: makeRequest('POST', '/api/price-alerts', {
      body,
      ...options
    }),
    env
  });
}

async function updateAlert(id, options = {}) {
  return onRequestPatch({
    request: makeRequest('PATCH', `/api/price-alerts/${id}`, options),
    env,
    params: { id }
  });
}

async function deleteAlert(id, options = {}) {
  return onRequestDelete({
    request: makeRequest('DELETE', `/api/price-alerts/${id}`, options),
    env,
    params: { id }
  });
}

try {
  console.log('\n========== PRICE ALERT API TESTS ==========\n');

  // Authentication and GET ownership.
  const unauthenticated = await getAlerts(null);
  assert.equal(unauthenticated.status, 401);

  const userAResponse = await getAlerts('a');
  assert.equal(userAResponse.status, 200);

  const userABody = await userAResponse.json();
  assert.ok(userABody.alerts.some(alert => alert.id === 'own-triggered'));
  assert.ok(userABody.alerts.some(alert => alert.id === 'own-active'));
  assert.ok(!userABody.alerts.some(alert => alert.id === 'foreign-triggered'));

  const userBResponse = await getAlerts('b');
  assert.equal(userBResponse.status, 200);

  const userBBody = await userBResponse.json();
  assert.ok(userBBody.alerts.some(alert => alert.id === 'foreign-triggered'));
  assert.ok(!userBBody.alerts.some(alert => alert.id === 'own-active'));

  console.log('PASS: GET requires authentication and returns only the account owner’s alerts.');

  // POST security protections.
  const wrongOrigin = await createAlert(
    { symbol: 'AAPL', currency: 'USD', direction: 'above', targetPrice: 150 },
    { originHeader: 'https://attacker.example' }
  );
  assert.equal(wrongOrigin.status, 403);

  const noCsrf = await createAlert(
    { symbol: 'AAPL', currency: 'USD', direction: 'above', targetPrice: 150 },
    { csrf: false }
  );
  assert.equal(noCsrf.status, 403);

  const noAuth = await createAlert(
    { symbol: 'AAPL', currency: 'USD', direction: 'above', targetPrice: 150 },
    { user: null }
  );
  assert.equal(noAuth.status, 401);

  console.log('PASS: POST rejects cross-origin, invalid-CSRF, and unauthenticated requests.');

  // Input validation.
  const invalidCases = [
    [{ symbol: '', currency: 'USD', direction: 'above', targetPrice: 150 }, 'symbol'],
    [{ symbol: 'INVALID TICKER!', currency: 'USD', direction: 'above', targetPrice: 150 }, 'symbol'],
    [{ symbol: 'AAPL', currency: 'EUR', direction: 'above', targetPrice: 150 }, 'currency'],
    [{ symbol: 'AAPL', currency: 'USD', direction: 'sideways', targetPrice: 150 }, 'direction'],
    [{ symbol: 'AAPL', currency: 'USD', direction: 'above', targetPrice: 0 }, 'zero target'],
    [{ symbol: 'AAPL', currency: 'USD', direction: 'above', targetPrice: true }, 'boolean target'],
    [{ symbol: 'AAPL', currency: 'USD', direction: 'above', targetPrice: -1 }, 'negative target'],
    [{ symbol: 'AAPL', currency: 'USD', direction: 'above', targetPrice: 1_000_000_001 }, 'excessive target'],
    [{ symbol: 'AAPL', currency: 'USD', direction: 'above', targetPrice: 'not-a-number' }, 'nonnumeric target']
  ];

  for (const [body, label] of invalidCases) {
    const response = await createAlert(body);
    assert.equal(response.status, 400, `Invalid ${label} should be rejected`);
  }

  console.log('PASS: Invalid symbols, currencies, directions, and target prices are rejected.');

  // Valid creation and normalization.
  const created = await createAlert({
    symbol: ' aapl ',
    currency: 'usd',
    direction: 'ABOVE',
    targetPrice: '125.50'
  });

  assert.equal(created.status, 201);

  const createdBody = await created.json();
  assert.equal(createdBody.ok, true);
  assert.equal(createdBody.alert.symbol, 'AAPL');
  assert.equal(createdBody.alert.currency, 'USD');
  assert.equal(createdBody.alert.direction, 'above');
  assert.equal(createdBody.alert.targetPrice, 125.5);
  assert.equal(createdBody.alert.status, 'active');
  assert.ok(createdBody.alert.id);

  const createdId = createdBody.alert.id;
  assert.ok(alerts.has(createdId));

  console.log('PASS: Valid alerts are inserted and ticker/currency/direction values are normalized.');

  // Active alert cap.
  for (let index = 0; index < 50; index += 1) {
    addAlert(`cap-alert-${index}`, users.a.id, 'active');
  }

  const capped = await createAlert({
    symbol: 'MSFT',
    currency: 'USD',
    direction: 'above',
    targetPrice: 500
  });

  assert.equal(capped.status, 400);
  assert.ok(
    [...alerts.values()].filter(alert =>
      alert.user_id === users.a.id && alert.status === 'active'
    ).length >= 50
  );

  for (let index = 0; index < 50; index += 1) {
    alerts.delete(`cap-alert-${index}`);
  }

  console.log('PASS: The 50-active-alert limit is enforced.');

  // PATCH reactivation and ownership.
  const reactivated = await updateAlert('own-triggered');

  assert.equal(reactivated.status, 200);

  const reactivatedBody = await reactivated.json();
  assert.equal(reactivatedBody.ok, true);
  assert.equal(reactivatedBody.status, 'active');
  assert.equal(alerts.get('own-triggered').triggered_at, null);
  assert.equal(alerts.get('own-triggered').triggered_price, null);

  const activePatch = await updateAlert('own-active');
  assert.equal(activePatch.status, 404);

  const foreignPatch = await updateAlert('foreign-triggered');
  assert.equal(foreignPatch.status, 404);
  assert.equal(alerts.get('foreign-triggered').status, 'triggered');

  console.log('PASS: Only the owner’s triggered alert can be reactivated.');

  // DELETE ownership.
  const deleted = await deleteAlert('own-active');
  assert.equal(deleted.status, 200);
  assert.equal(alerts.has('own-active'), false);

  const foreignDelete = await deleteAlert('foreign-triggered');
  assert.equal(foreignDelete.status, 404);
  assert.equal(alerts.has('foreign-triggered'), true);

  console.log('PASS: Deletion is owner-scoped and cannot remove another user’s alert.');

  // PATCH and DELETE security protections.
  const patchNoCsrf = await updateAlert('own-triggered', { csrf: false });
  assert.equal(patchNoCsrf.status, 403);

  const deleteWrongOrigin = await deleteAlert('foreign-triggered', {
    originHeader: 'https://attacker.example'
  });
  assert.equal(deleteWrongOrigin.status, 403);

  const deleteNoAuth = await deleteAlert('foreign-triggered', {
    user: null
  });
  assert.equal(deleteNoAuth.status, 401);

  console.log('PASS: PATCH and DELETE enforce origin, CSRF, and authentication protections.');

  // Independent rate-limit test using user B and a dedicated IP.
  let lastResponse;

  for (let index = 0; index < 41; index += 1) {
    lastResponse = await createAlert({
      symbol: 'MSFT',
      currency: 'USD',
      direction: 'above',
      targetPrice: 500
    }, {
      user: 'b',
      ip: '198.51.100.77'
    });

    if (index < 40) {
      assert.equal(
        lastResponse.status,
        201,
        `Create request ${index + 1} should be allowed`
      );
    }
  }

  assert.equal(lastResponse.status, 429);
  assert.ok(Number(lastResponse.headers.get('Retry-After')) >= 1);

  console.log('PASS: The 41st alert creation within the rate window is blocked.');

  console.log('\nAll price alert API tests passed.');
} finally {
  globalThis.fetch = originalFetch;
}
