import assert from 'node:assert/strict';
import { onRequestPatch } from '../functions/api/portfolio/[id].js';
import { calculatePortfolioTotals } from '../public/portfolio-calculations.js';

const origin = 'https://www.raelinfo.com';
const user = { id: 'portfolio-test-user', email: 'portfolio-test@example.com' };
const positions = new Map([
  ['owned-position', {
    id: 'owned-position',
    user_id: user.id,
    symbol: 'AAPL',
    currency: 'USD',
    current_price: null,
    price_updated_at: null
  }],
  ['foreign-position', {
    id: 'foreign-position',
    user_id: 'another-user',
    symbol: 'AAPL',
    currency: 'USD',
    current_price: null,
    price_updated_at: null
  }]
]);

const alerts = new Map([
  ['above-alert', {
    id: 'above-alert',
    user_id: user.id,
    symbol: 'AAPL',
    currency: 'USD',
    direction: 'above',
    target_price: 120,
    status: 'active',
    triggered_at: null,
    triggered_price: null
  }],
  ['below-alert', {
    id: 'below-alert',
    user_id: user.id,
    symbol: 'AAPL',
    currency: 'USD',
    direction: 'below',
    target_price: 100,
    status: 'active',
    triggered_at: null,
    triggered_price: null
  }],
  ['foreign-alert', {
    id: 'foreign-alert',
    user_id: 'another-user',
    symbol: 'AAPL',
    currency: 'USD',
    direction: 'above',
    target_price: 100,
    status: 'active',
    triggered_at: null,
    triggered_price: null
  }]
]);

const rateRows = new Map();
let alertChecks = 0;

const db = {
  prepare(sql) {
    let values = [];

    return {
      bind(...args) {
        values = args;
        return this;
      },

      async run() {
        if (sql.includes('INSERT INTO users')) return {};

        if (sql.includes('DELETE FROM rate_limits')) return {};

        if (sql.includes('INSERT INTO rate_limits')) {
          const [bucket, window] = values;
          const key = `${bucket}:${window}`;
          rateRows.set(key, (rateRows.get(key) || 0) + 1);
          return {};
        }

        if (sql.includes('UPDATE price_alerts')) {
          const [
            triggeredAt,
            triggeredPrice,
            updatedAt,
            userId,
            symbol,
            currency,
            abovePrice,
            belowPrice
          ] = values;

          alertChecks++;
          let changes = 0;

          for (const alert of alerts.values()) {
            if (
              alert.user_id !== userId ||
              alert.symbol !== symbol ||
              alert.currency !== currency ||
              alert.status !== 'active'
            ) {
              continue;
            }

            const matched =
              (alert.direction === 'above' && abovePrice >= alert.target_price) ||
              (alert.direction === 'below' && belowPrice <= alert.target_price);

            if (matched) {
              alert.status = 'triggered';
              alert.triggered_at = triggeredAt;
              alert.triggered_price = triggeredPrice;
              alert.updated_at = updatedAt;
              changes++;
            }
          }

          return { meta: { changes } };
        }

        if (sql.includes('UPDATE portfolio_positions')) {
          const [price, updatedAt, id, userId] = values;
          const position = positions.get(id);

          if (!position || position.user_id !== userId) {
            return { meta: { changes: 0 } };
          }

          position.current_price = price;
          position.price_updated_at = updatedAt;
          return { meta: { changes: 1 } };
        }

        throw new Error(`Unexpected test database statement: ${sql}`);
      },

      async first() {
        if (sql.includes('account_deletion_pending')) {
          return null;
        }

        if (sql.includes('SELECT symbol, currency')) {
          const [id, userId] = values;
          const position = positions.get(id);

          if (!position || position.user_id !== userId) {
            return null;
          }

          return {
            symbol: position.symbol,
            currency: position.currency
          };
        }

        if (sql.includes('SELECT hits FROM rate_limits')) {
          const [bucket, window] = values;
          return { hits: rateRows.get(`${bucket}:${window}`) || 0 };
        }

        throw new Error(`Unexpected test database query: ${sql}`);
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

globalThis.fetch = async (url) => {
  if (String(url).endsWith('/auth/v1/user')) {
    return new Response(JSON.stringify(user), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  throw new Error(`Unexpected network request in local test: ${url}`);
};

function makeRequest(body, {
  ip = '192.0.2.10',
  csrf = true,
  originHeader = origin
} = {}) {
  const headers = {
    Origin: originHeader,
    'Content-Type': 'application/json',
    'Sec-Fetch-Site': 'same-origin',
    'CF-Connecting-IP': ip,
    Cookie: `raelinfo_access=test-access-token; raelinfo_csrf=${csrf ? 'test-csrf-token' : 'wrong-token'}`
  };

  if (csrf) headers['X-CSRF-Token'] = 'test-csrf-token';

  return new Request(`${origin}/api/portfolio/owned-position`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body)
  });
}

async function patch(body, options = {}, id = 'owned-position') {
  return onRequestPatch({
    request: makeRequest(body, options),
    env,
    params: { id }
  });
}

try {
  // A valid price is saved and timestamped.
  const saved = await patch({ currentPrice: 125.50 });
  assert.equal(saved.status, 200, 'A valid price should be saved');
  const savedBody = await saved.json();
  assert.equal(savedBody.ok, true);
  assert.equal(savedBody.currentPrice, 125.50);
  assert.ok(savedBody.priceUpdatedAt, 'A saved price must have a timestamp');
  assert.equal(positions.get('owned-position').current_price, 125.50);
  assert.equal(positions.get('owned-position').price_updated_at, savedBody.priceUpdatedAt);

  assert.equal(alerts.get('above-alert').status, 'triggered');
  assert.equal(alerts.get('above-alert').triggered_price, 125.50);
  assert.equal(alerts.get('below-alert').status, 'active');
  assert.equal(alerts.get('foreign-alert').status, 'active');

  console.log('PASS: Saving a price triggers matching above alerts only for the account owner.');
  console.log('PASS: Authenticated user can save a manual price.');

  // Updating the same position replaces the previous price.
  const updated = await patch({ currentPrice: 130.25 }, { ip: '192.0.2.11' });
  assert.equal(updated.status, 200);
  assert.equal(positions.get('owned-position').current_price, 130.25);
  console.log('PASS: Existing manual prices can be updated.');

  // A user cannot change another user's position.
  const foreign = await patch(
    { currentPrice: 999 },
    { ip: '192.0.2.12' },
    'foreign-position'
  );
  assert.equal(foreign.status, 404);
  assert.equal(positions.get('foreign-position').current_price, null);
  console.log('PASS: A user cannot update another user’s position.');

  // Invalid values are rejected without changing the saved price.
  for (const value of [0, -1, 1_000_000_001, 'not-a-price']) {
    const response = await patch(
      { currentPrice: value },
      { ip: `192.0.2.${20 + (typeof value === 'number' ? Math.abs(value) % 100 : 1)}` }
    );
    assert.equal(response.status, 400, `Invalid price ${String(value)} must be rejected`);
  }
  assert.equal(positions.get('owned-position').current_price, 130.25);
  console.log('PASS: Zero, negative, excessive, and nonnumeric prices are rejected.');

  // Clearing a price must not evaluate or trigger alerts.
  const checksBeforeClear = alertChecks;

  // Clearing a price clears both the value and timestamp.
  const cleared = await patch({ currentPrice: null }, { ip: '192.0.2.30' });
  assert.equal(cleared.status, 200);
  const clearedBody = await cleared.json();
  assert.equal(clearedBody.currentPrice, null);
  assert.equal(clearedBody.priceUpdatedAt, null);
  assert.equal(positions.get('owned-position').current_price, null);
  assert.equal(positions.get('owned-position').price_updated_at, null);
  assert.equal(alertChecks, checksBeforeClear);
  console.log('PASS: Clearing a manual price does not evaluate alerts.');

  // A later manual price can trigger a below-target alert.
  const belowSaved = await patch(
    { currentPrice: 95 },
    { ip: '192.0.2.33' }
  );

  assert.equal(belowSaved.status, 200);
  assert.equal(alerts.get('below-alert').status, 'triggered');
  assert.equal(alerts.get('below-alert').triggered_price, 95);
  console.log('PASS: Saving a price at or below the target triggers a below alert.');

  // CSRF and same-origin protections remain enforced.
  const noCsrf = await patch(
    { currentPrice: 150 },
    { ip: '192.0.2.31', csrf: false }
  );
  assert.equal(noCsrf.status, 403);

  const wrongOrigin = await patch(
    { currentPrice: 150 },
    { ip: '192.0.2.32', originHeader: 'https://attacker.example' }
  );
  assert.equal(wrongOrigin.status, 403);
  console.log('PASS: CSRF and cross-origin requests are rejected.');

  // Rate limiting: 60 updates are accepted; the 61st is blocked.
  let lastRateResponse;
  for (let index = 0; index < 61; index += 1) {
    lastRateResponse = await patch(
      { currentPrice: 140 + index },
      { ip: '192.0.2.90' }
    );
    if (index < 60) {
      assert.equal(lastRateResponse.status, 200, `Update ${index + 1} should be allowed`);
    }
  }
  assert.equal(lastRateResponse.status, 429);
  assert.ok(Number(lastRateResponse.headers.get('Retry-After')) >= 1);
  console.log('PASS: The 61st price update within the rate window is blocked.');

  // Currency totals are independent, and unpriced positions do not enter market totals.
  const totals = calculatePortfolioTotals([
    { shares: 2, averageCost: 100, currentPrice: 125, currency: 'USD' },
    { shares: 3, averageCost: 20, currentPrice: 15, currency: 'USD' },
    { shares: 4, averageCost: 10, currentPrice: 12, currency: 'CAD' },
    { shares: 1, averageCost: 50, currentPrice: null, currency: 'CAD' }
  ]);

  assert.equal(totals.costTotals.get('USD'), 260);
  assert.equal(totals.costTotals.get('CAD'), 90);
  assert.equal(totals.marketTotals.get('USD'), 295);
  assert.equal(totals.marketTotals.get('CAD'), 48);
  assert.equal(totals.gainTotals.get('USD'), 35);
  assert.equal(totals.gainTotals.get('CAD'), 8);
  assert.equal(totals.pricedCounts.get('USD'), 2);
  assert.equal(totals.pricedCounts.get('CAD'), 1);
  console.log('PASS: USD and CAD cost, market, and gain/loss totals remain separate.');

  // Loss calculations and unpriced positions are handled correctly.
  const lossTotals = calculatePortfolioTotals([
    { shares: 5, averageCost: 20, currentPrice: 15, currency: 'USD' },
    { shares: 2, averageCost: 30, currentPrice: null, currency: 'USD' }
  ]);

  assert.equal(lossTotals.costTotals.get('USD'), 160);
  assert.equal(lossTotals.marketTotals.get('USD'), 75);
  assert.equal(lossTotals.gainTotals.get('USD'), -25);
  assert.equal(lossTotals.pricedCounts.get('USD'), 1);
  console.log('PASS: Unrealized losses and unpriced holdings are calculated correctly.');

  console.log('All manual portfolio price tests passed.');
} finally {
  globalThis.fetch = originalFetch;
}
