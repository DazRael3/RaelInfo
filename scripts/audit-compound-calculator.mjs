import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const html = readFileSync(resolve('public/index.html'), 'utf8');
const start = html.indexOf('function calculateCompound() {');
const end = html.indexOf('function runDebtSimulation()', start);

assert.notEqual(start, -1, 'calculateCompound() not found');
assert.notEqual(end, -1, 'Could not locate end of compound calculator');

const source = html.slice(start, end);

function execute(overrides = {}) {
  const values = {
    compoundStart: '5000',
    compoundMonthly: '200',
    compoundRate: '6',
    compoundYears: '10',
    ...overrides
  };

  const nodes = Object.fromEntries(
    Object.entries(values).map(([id, value]) => [
      id,
      {
        value: String(value),
        textContent: '',
        innerHTML: '',
        attributes: {},
        setAttribute(name, val) { this.attributes[name] = val; },
        removeAttribute(name) { delete this.attributes[name]; }
      }
    ])
  );

  for (const id of ['compoundResult', 'compoundBreakdown']) {
    nodes[id] = {
      textContent: '',
      innerHTML: '',
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

  runInNewContext(`${source}\ncalculateCompound();`, context);
  return nodes;
}

function check(condition, message) {
  assert.ok(condition, message);
  console.log(`PASS ${message}`);
}

function expectedBalance(start, monthly, annualPercent, months) {
  const r = Math.pow(1 + annualPercent / 100, 1 / 12) - 1;
  const factor = Math.pow(1 + r, months);

  return r === 0
    ? start + monthly * months
    : start * factor + monthly * ((factor - 1) / r);
}

const standard = execute();
const expected = expectedBalance(5000, 200, 6, 120);
const invested = 5000 + 200 * 120;

assert.equal(standard.compoundResult.textContent, `$${expected.toFixed(2)}`);
check(true, 'Standard 10-year compound growth matches independent future-value formula');

assert.ok(standard.compoundBreakdown.textContent.includes(`$${invested.toFixed(2)}`));
assert.ok(standard.compoundBreakdown.textContent.includes(`$${(expected - invested).toFixed(2)}`));
check(true, 'Total contributions and estimated growth are correctly reported');

const zeroRate = execute({ compoundRate: '0' });
assert.equal(zeroRate.compoundResult.textContent, '$29000.00');
check(true, 'Zero-return calculation correctly totals starting balance and contributions');

const negativeReturn = execute({
  compoundStart: '10000',
  compoundMonthly: '100',
  compoundRate: '-10',
  compoundYears: '5'
});
const negativeExpected = expectedBalance(10000, 100, -10, 60);
assert.equal(negativeReturn.compoundResult.textContent, `$${negativeExpected.toFixed(2)}`);
check(true, 'Negative annual return produces correct declining-growth projection');

const noContributions = execute({
  compoundStart: '10000',
  compoundMonthly: '0',
  compoundRate: '6',
  compoundYears: '10'
});
assert.equal(
  noContributions.compoundResult.textContent,
  `$${expectedBalance(10000, 0, 6, 120).toFixed(2)}`
);
check(true, 'Starting balance compounds correctly without recurring contributions');

const noInvestment = execute({
  compoundStart: '0',
  compoundMonthly: '0',
  compoundRate: '6'
});
assert.equal(noInvestment.compoundResult.textContent, '$0.00');
check(true, 'Zero starting balance and zero contributions produce zero');

for (const [label, overrides, invalidField] of [
  ['Negative starting balance', { compoundStart: '-1' }, 'compoundStart'],
  ['Negative monthly contribution', { compoundMonthly: '-1' }, 'compoundMonthly'],
  ['Blank starting balance', { compoundStart: '' }, 'compoundStart'],
  ['Blank monthly contribution', { compoundMonthly: '' }, 'compoundMonthly'],
  ['Return below -99%', { compoundRate: '-99.01' }, 'compoundRate'],
  ['Return above 100%', { compoundRate: '100.01' }, 'compoundRate'],
  ['Blank annual return', { compoundRate: '' }, 'compoundRate'],
  ['Unsupported investment period', { compoundYears: '7' }, 'compoundYears'],
  ['Blank investment period', { compoundYears: '' }, 'compoundYears']
]) {
  const result = execute(overrides);

  assert.equal(result.compoundResult.textContent, 'Invalid inputs', label);
  assert.equal(result[invalidField].attributes['aria-invalid'], 'true', label);

  check(true, `${label} is rejected and marked invalid`);
}

const lowerBoundary = execute({ compoundRate: '-99' });
assert.notEqual(lowerBoundary.compoundResult.textContent, 'Invalid inputs');
check(true, 'Minimum supported annual return of -99% is accepted');

const upperBoundary = execute({ compoundRate: '100' });
assert.notEqual(upperBoundary.compoundResult.textContent, 'Invalid inputs');
check(true, 'Maximum supported annual return of 100% is accepted');

const overflow = execute({
  compoundStart: '1e308',
  compoundMonthly: '1e308',
  compoundRate: '100',
  compoundYears: '40'
});
assert.equal(overflow.compoundResult.textContent, 'Calculation unavailable');
check(true, 'Overflowing calculations fail safely instead of displaying Infinity');

console.log('\nALL COMPOUND GROWTH CALCULATOR AUDIT TESTS PASSED');