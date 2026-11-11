import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const html = readFileSync(resolve('public/index.html'), 'utf8');
const start = html.indexOf('function getEffectiveFxRate() {');
const end = html.indexOf('async function refreshCrypto(', start);

assert.notEqual(start, -1, 'Crypto/FX source functions not found');
assert.notEqual(end, -1, 'Could not locate end of crypto display functions');

const source = html.slice(start, end);

const ids = [
  'manualFxRate',
  'btcPrice', 'btcChange', 'btcRank', 'btcMarketCap',
  'ethPrice', 'ethChange', 'ethRank', 'ethMarketCap',
  'solPrice', 'solChange', 'solRank', 'solMarketCap',
  'cryptoUpdated'
];

const nodes = Object.fromEntries(ids.map(id => [
  id,
  {
    value: '',
    textContent: '',
    className: ''
  }
]));

const state = {
  currency: 'USD',
  fxRate: 1.3,
  crypto: {
    BTC: { price: 50000, change24h: 2.5, rank: 1, marketCap: 1e12 },
    ETH: { price: 2500, change24h: -1.25, rank: 2, marketCap: 3e11 },
    SOL: { price: 150, change24h: 0.75, rank: 5, marketCap: 7e10 }
  },
  cryptoUpdatedAt: '2026-11-11T12:00:00.000Z',
  cryptoStale: false
};

const originalCrypto = JSON.stringify(state.crypto);
let estimateCalls = 0;

const context = {
  state,
  $: id => nodes[id] ?? null,
  Intl,
  Number,
  Date,
  calculateCryptoEstimate() { estimateCalls++; }
};

runInNewContext(source, context);

function check(condition, message) {
  assert.ok(condition, message);
  console.log(`PASS ${message}`);
}

function expected(value, currency, compact = false) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    ...(compact ? { notation: 'compact', maximumFractionDigits: 1 } :
      { maximumFractionDigits: value < 1 ? 6 : value < 100 ? 4 : 2 })
  }).format(value);
}

// USD display must retain the provider's original values.
assert.equal(context.formatCryptoPrice(50000), expected(50000, 'USD'));
assert.equal(context.formatCompactUSD(1e12), expected(1e12, 'USD', true));
check(true, 'USD prices and market capitalizations remain in source currency');

// CAD conversion uses the effective FX rate.
state.currency = 'CAD';

assert.equal(context.formatCryptoPrice(50000), expected(65000, 'CAD'));
assert.equal(context.formatCryptoPrice(2500), expected(3250, 'CAD'));
assert.equal(context.formatCryptoPrice(150), expected(195, 'CAD'));
assert.equal(context.formatCompactUSD(1e12), expected(1.3e12, 'CAD', true));
check(true, 'BTC, ETH, SOL prices and market caps convert using the CAD rate');

// Manual rate takes precedence over the cached/reference rate.
nodes.manualFxRate.value = '1.4';

assert.equal(context.formatCryptoPrice(50000), expected(70000, 'CAD'));
assert.equal(context.formatCompactUSD(1e12), expected(1.4e12, 'CAD', true));
check(true, 'Manual FX rate overrides the cached exchange rate');

// Invalid or unavailable FX must never masquerade as CAD.
nodes.manualFxRate.value = '';
state.fxRate = null;

assert.equal(context.formatCryptoPrice(50000), '—');
assert.equal(context.formatCompactUSD(1e12), '—');

state.fxRate = 0;
assert.equal(context.formatCryptoPrice(50000), '—');
assert.equal(context.formatCompactUSD(1e12), '—');

check(true, 'Unavailable and invalid FX rates safely suppress CAD values');

// Rendering must update every market card without mutating source data.
state.fxRate = 1.3;
nodes.manualFxRate.value = '';

context.renderCrypto();

for (const [symbol, prefix, price, cap, change, rank] of [
  ['BTC', 'btc', 65000, 1.3e12, '+2.50% · 24h', 'Rank #1'],
  ['ETH', 'eth', 3250, 3.9e11, '-1.25% · 24h', 'Rank #2'],
  ['SOL', 'sol', 195, 9.1e10, '+0.75% · 24h', 'Rank #5']
]) {
  assert.equal(nodes[`${prefix}Price`].textContent, expected(price, 'CAD'));
  assert.equal(nodes[`${prefix}MarketCap`].textContent,
    `Mkt cap ${expected(cap, 'CAD', true)}`);
  assert.equal(nodes[`${prefix}Change`].textContent, change);
  assert.equal(nodes[`${prefix}Rank`].textContent, rank);
  check(true, `${symbol} market card renders converted values and unchanged market metrics`);
}

assert.equal(JSON.stringify(state.crypto), originalCrypto);
check(true, 'Rendering preserves original USD provider data without double conversion');

assert.equal(estimateCalls, 1);
check(true, 'Market rendering refreshes the crypto estimator');

console.log('\nALL CRYPTO CURRENCY AUDIT TESTS PASSED');
