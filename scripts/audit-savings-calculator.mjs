import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const html = readFileSync(resolve('public/index.html'), 'utf8');
const start = html.indexOf('function calculateSavings() {');
const end = html.indexOf('function calculateCryptoEstimate()', start);

assert.notEqual(start, -1, 'calculateSavings() not found');
assert.notEqual(end, -1, 'Could not locate end of savings calculator');

const source = html.slice(start, end);

function execute(overrides = {}) {
  const values = {
    savingsStart: '5000',
    savingsMonthly: '100',
    savingsApy: '4',
    savingsYears: '3',
    ...overrides
  };

  const nodes = Object.fromEntries(
    Object.entries(values).map(([id, value]) => [
      id,
      {
        value: String(value),
        textContent: '',
        attributes: {},
        setAttribute(name, val) { this.attributes[name] = val; },
        removeAttribute(name) { delete this.attributes[name]; }
      }
    ])
  );

  for (const id of ['savingsResult', 'savingsBreakdown']) {
    nodes[id] = {
      textContent: '',
      attributes: {},
      setAttribute(name, val) { this.attributes[name] = val; },
      removeAttribute(name) { delete this.attributes[name]; }
    };
  }

  const context = {
    $: id => nodes[id] ?? null,
    money: value => `$${value.toFixed(2)}`,
    Number,
    Math
  };

  runInNewContext(`${source}\ncalculateSavings();`, context);
  return nodes;
}

function check(condition, message) {
  assert.ok(condition, message);
  console.log(`PASS ${message}`);
}

function expectedBalance(start, monthly, annualPercent, months) {
  const rate = Math.pow(1 + annualPercent / 100, 1 / 12) - 1;
  let balance = start;

  for (let i = 0; i < months; i++) {
    balance = balance * (1 + rate) + monthly;
  }

  return balance;
}

const standard = execute();
const expected = expectedBalance(5000, 100, 4, 36);
const deposits = 5000 + 100 * 36;

assert.equal(standard.savingsResult.textContent, `$${expected.toFixed(2)}`);
assert.ok(standard.savingsBreakdown.textContent.includes(`$${deposits.toFixed(2)}`));
assert.ok(standard.savingsBreakdown.textContent.includes(`$${(expected - deposits).toFixed(2)}`));
check(true, 'Standard savings projection matches independent monthly-compounding calculation');
check(true, 'Total deposits and estimated interest are correctly reported');

const zeroApy = execute({ savingsApy: '0' });
assert.equal(zeroApy.savingsResult.textContent, '$8600.00');
check(true, 'Zero APY correctly returns starting deposit plus monthly deposits');

const noMonthlyDeposits = execute({ savingsMonthly: '0' });
assert.equal(
  noMonthlyDeposits.savingsResult.textContent,
  `$${expectedBalance(5000, 0, 4, 36).toFixed(2)}`
);
check(true, 'Starting deposit compounds correctly without recurring deposits');

const zeroBalances = execute({
  savingsStart: '0',
  savingsMonthly: '0',
  savingsApy: '0'
});
assert.equal(zeroBalances.savingsResult.textContent, '$0.00');
check(true, 'Zero starting deposit and zero monthly deposits produce zero');

for (const [label, overrides, field] of [
  ['Negative starting deposit', { savingsStart: '-1' }, 'savingsStart'],
  ['Negative monthly deposit', { savingsMonthly: '-1' }, 'savingsMonthly'],
  ['Blank starting deposit', { savingsStart: '' }, 'savingsStart'],
  ['Blank monthly deposit', { savingsMonthly: '' }, 'savingsMonthly'],
  ['Non-finite starting deposit', { savingsStart: 'Infinity' }, 'savingsStart'],
  ['Negative APY', { savingsApy: '-0.01' }, 'savingsApy'],
  ['APY above 100%', { savingsApy: '100.01' }, 'savingsApy'],
  ['Blank APY', { savingsApy: '' }, 'savingsApy'],
  ['Non-finite APY', { savingsApy: 'Infinity' }, 'savingsApy'],
  ['Unsupported savings period', { savingsYears: '7' }, 'savingsYears'],
  ['Blank savings period', { savingsYears: '' }, 'savingsYears'],
  ['Fractional savings period', { savingsYears: '1.5' }, 'savingsYears']
]) {
  const result = execute(overrides);

  assert.equal(result.savingsResult.textContent, 'Invalid inputs', label);
  assert.equal(result[field].attributes['aria-invalid'], 'true', label);

  check(true, `${label} is rejected and marked invalid`);
}

for (const apy of ['0', '100']) {
  const result = execute({ savingsApy: apy });
  assert.notEqual(result.savingsResult.textContent, 'Invalid inputs');
  assert.equal(result.savingsApy.attributes['aria-invalid'], undefined);
}
check(true, 'APY boundaries of 0% and 100% are accepted');

for (const years of ['1', '3', '5', '10', '15']) {
  const result = execute({ savingsYears: years });
  assert.notEqual(result.savingsResult.textContent, 'Invalid inputs');
  assert.equal(result.savingsYears.attributes['aria-invalid'], undefined);
}
check(true, 'Every savings period offered by the interface is accepted');

const overflow = execute({
  savingsStart: '1e308',
  savingsMonthly: '1e308',
  savingsApy: '100',
  savingsYears: '15'
});
assert.equal(overflow.savingsResult.textContent, 'Calculation unavailable');
check(true, 'Overflowing savings projections fail safely instead of displaying Infinity');

console.log('\nALL SAVINGS YIELD CALCULATOR AUDIT TESTS PASSED');