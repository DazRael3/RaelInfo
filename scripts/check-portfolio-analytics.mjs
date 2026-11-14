import assert from 'node:assert/strict';
import { calculatePortfolioAnalytics } from '../public/portfolio-analytics.js';

const result = calculatePortfolioAnalytics([
  { id: '1', symbol: 'AAA', shares: 2, averageCost: 100, currentPrice: 125, currency: 'USD' },
  { id: '2', symbol: 'BBB', shares: 3, averageCost: 20, currentPrice: 15, currency: 'USD' },
  { id: '3', symbol: 'CCC', shares: 4, averageCost: 10, currentPrice: 12, currency: 'CAD' },
  { id: '4', symbol: 'DDD', shares: 1, averageCost: 50, currentPrice: null, currency: 'CAD' }
]);

const usd = result.summaries.find(item => item.currency === 'USD');
const cad = result.summaries.find(item => item.currency === 'CAD');

assert.equal(usd.costBasis, 260);
assert.equal(usd.pricedCostBasis, 260);
assert.equal(usd.marketValue, 295);
assert.equal(usd.gainLoss, 35);
assert.equal(usd.gainLossPercent, (35 / 260) * 100);

assert.equal(cad.costBasis, 90);
assert.equal(cad.pricedCostBasis, 40);
assert.equal(cad.marketValue, 48);
assert.equal(cad.gainLoss, 8);
assert.equal(cad.pricedCount, 1);
assert.equal(cad.unpricedCount, 1);

assert.equal(result.totalPositions, 4);
assert.equal(result.pricedCount, 3);
assert.equal(result.unpricedCount, 1);
assert.equal(result.holdings.find(item => item.symbol === 'DDD').marketValue, null);
assert.equal(result.holdings.find(item => item.symbol === 'DDD').allocationPercent, null);
assert.equal(result.ranked[0].symbol, 'AAA');
assert.equal(result.ranked.at(-1).symbol, 'BBB');

const zeroBasis = calculatePortfolioAnalytics([
  { symbol: 'ZERO', shares: 1, averageCost: 0, currentPrice: 10, currency: 'USD' }
]);
assert.equal(zeroBasis.ranked.length, 0);
assert.equal(zeroBasis.summaries[0].gainLossPercent, null);

const duplicateSymbol = calculatePortfolioAnalytics([
  { symbol: 'AAA', shares: 1, averageCost: 10, currentPrice: 20, currency: 'USD' },
  { symbol: 'AAA', shares: 2, averageCost: 10, currentPrice: 30, currency: 'USD' }
]);
assert.equal(duplicateSymbol.allocationRows.length, 1);
assert.equal(duplicateSymbol.allocationRows[0].marketValue, 80);
assert.equal(duplicateSymbol.allocationRows[0].allocationPercent, 100);

console.log('PASS: USD and CAD analytics remain separate.');
console.log('PASS: Unpriced holdings are excluded from market-value calculations.');
console.log('PASS: Performance rankings handle gains, losses, and zero cost basis.');
console.log('PASS: Duplicate ticker positions are aggregated for allocation.');
console.log('All portfolio analytics tests passed.');
