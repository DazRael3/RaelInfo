import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const htmlPath = fileURLToPath(new URL('../public/index.html', import.meta.url));
const html = fs.readFileSync(htmlPath, 'utf8');

const startMarker = 'function runDebtSimulation() {';
const endMarker = 'function calculateSavings() {';

const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker, start + startMarker.length);

assert.notEqual(start, -1, 'Debt calculator function was not found.');
assert.notEqual(end, -1, 'Debt calculator end boundary was not found.');

const source = html.slice(start, end).trim();

function execute(inputs = {}) {
  const elements = new Map();

  const defaults = {
    debtResult: '',
    debtBreakdown: '',
    debtMethod: 'avalanche',
    debtBudget: '',
    debt1: '',
    debt2: '',
    debt3: '',
    apr1: '',
    apr2: '',
    apr3: '',
    debtMin1: '',
    debtMin2: '',
    debtMin3: ''
  };

  for (const [id, value] of Object.entries({ ...defaults, ...inputs })) {
    elements.set(id, {
      value: String(value),
      textContent: ''
    });
  }

  const sandbox = {
    $: id => elements.get(id) ?? null,

    number: id => {
      const element = elements.get(id);
      if (!element) return 0;
      const value = Number(element.value);
      return Number.isFinite(value) ? value : 0;
    },

    clampNonNegative: value =>
      Math.max(0, Number.isFinite(value) ? value : 0),

    money: value =>
      Number.isFinite(value) ? `$${value.toFixed(2)}` : '—'
  };

  vm.runInNewContext(
    `${source}\nthis.__runDebtSimulation = runDebtSimulation;`,
    sandbox,
    { timeout: 1000 }
  );

  sandbox.__runDebtSimulation();

  return {
    result: elements.get('debtResult').textContent,
    breakdown: elements.get('debtBreakdown').textContent
  };
}

function test(name, callback) {
  try {
    callback();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    console.error(error.stack || error);
    process.exitCode = 1;
  }
}

// 1. Exact one-debt numerical result.
test('One debt: payoff duration, interest and total paid are correct', () => {
  const output = execute({
    debt1: 1000,
    apr1: 12,
    debtMin1: 100,
    debtBudget: 100
  });

  assert.equal(output.result, '11m');
  assert.match(output.breakdown, /Estimated interest: \$58\.98/);
  assert.match(output.breakdown, /Total paid: \$1058\.98/);
  assert.match(output.breakdown, /Payoff order: Debt 1/);
});

// 2. Avalanche prioritizes the highest APR.
test('Avalanche prioritizes the highest-interest debt', () => {
  const output = execute({
    debt1: 100,
    apr1: 5,
    debtMin1: 10,
    debt2: 500,
    apr2: 24,
    debtMin2: 10,
    debtBudget: 100,
    debtMethod: 'avalanche'
  });

  assert.equal(output.result, '7m');
  assert.match(output.breakdown, /Payoff order: Debt 2 → Debt 1/);
  assert.match(output.breakdown, /Estimated interest: \$37\.40/);
});

// 3. Snowball prioritizes the smallest balance.
test('Snowball prioritizes the smallest outstanding balance', () => {
  const output = execute({
    debt1: 100,
    apr1: 5,
    debtMin1: 10,
    debt2: 500,
    apr2: 24,
    debtMin2: 10,
    debtBudget: 100,
    debtMethod: 'snowball'
  });

  assert.equal(output.result, '7m');
  assert.match(output.breakdown, /Payoff order: Debt 1 → Debt 2/);
  assert.match(output.breakdown, /Estimated interest: \$43\.82/);
});

// 4. Zero-interest debt.
test('Zero-interest debt produces no interest charges', () => {
  const output = execute({
    debt1: 1000,
    apr1: 0,
    debtMin1: 100,
    debtBudget: 100
  });

  assert.equal(output.result, '10m');
  assert.match(output.breakdown, /Estimated interest: \$0\.00/);
  assert.match(output.breakdown, /Total paid: \$1000\.00/);
});

// 5. Empty balances.
test('No debt balances produce a zero result', () => {
  const output = execute();
  assert.equal(output.result, '$0.00');
  assert.equal(output.breakdown, 'No debt balances entered.');
});

// 6. Missing minimum payment.
test('Active debt without an entered minimum payment is rejected', () => {
  const output = execute({
    debt1: 1000,
    apr1: 12,
    debtBudget: 100
  });

  assert.equal(output.result, 'Minimum payment required');
});

// 7. Invalid APR.
test('APR above the permitted maximum is rejected', () => {
  const output = execute({
    debt1: 1000,
    apr1: 1001,
    debtMin1: 50,
    debtBudget: 100
  });

  assert.equal(output.result, 'Check debt APR');
});

// 8. Minimum payments exceed budget.
test('Budget below the entered minimum-payment total is rejected', () => {
  const output = execute({
    debt1: 1000,
    apr1: 12,
    debtMin1: 75,
    debt2: 500,
    apr2: 18,
    debtMin2: 50,
    debtBudget: 100
  });

  assert.equal(output.result, 'Budget too low');
});

// 9. Payment does not cover accumulating interest.
test('Non-amortizing debt is rejected instead of reporting a false payoff', () => {
  const output = execute({
    debt1: 1000,
    apr1: 1000,
    debtMin1: 1,
    debtBudget: 1
  });

  assert.equal(output.result, 'Budget cannot reduce debt');
});

// 10. Calculation limit.
test('Unpaid debt beyond 1,200 months is reported as not paid off', () => {
  const output = execute({
    debt1: 2000,
    apr1: 0,
    debtMin1: 1,
    debtBudget: 1
  });

  assert.equal(output.result, 'Not paid off');
});

// 11. Negative balances.
test('Negative debt balances are rejected instead of silently becoming zero', () => {
  const output = execute({
    debt1: -100,
    apr1: 12,
    debtMin1: 25,
    debtBudget: 100
  });

  assert.equal(output.result, 'Check debt balance');
  assert.match(output.breakdown, /non-negative balance/);
});

// 12. Minimum payment greater than the remaining balance.
test('Minimum payments are capped at the outstanding balance', () => {
  const output = execute({
    debt1: 100,
    apr1: 12,
    debtMin1: 150,
    debtBudget: 150
  });

  assert.equal(output.result, '1m');
  assert.match(output.breakdown, /Estimated interest: \$1\.00/);
  assert.match(output.breakdown, /Total paid: \$101\.00/);
  assert.match(output.breakdown, /Payoff order: Debt 1/);
});

// 13. Minimum payment exceeding the balance must not inflate the budget requirement.
test('Budget check caps an oversized minimum at the first-month payoff amount', () => {
  const output = execute({
    debt1: 100,
    apr1: 12,
    debtMin1: 150,
    debtBudget: 101
  });

  assert.equal(output.result, '1m');
  assert.match(output.breakdown, /Estimated interest: \$1\.00/);
  assert.match(output.breakdown, /Total paid: \$101\.00/);
});

// 14. Small but genuine principal reduction.
test('Small positive amortization is not misclassified as zero progress', () => {
  const output = execute({
    debt1: 1000,
    apr1: 12,
    debtMin1: 10.004,
    debtBudget: 10.004
  });

  assert.notEqual(output.result, 'Budget cannot reduce debt');
  assert.match(output.breakdown, /Payoff order: Debt 1/);
});

// 15. Invalid strategy.
test('Invalid payoff strategy is rejected', () => {
  const output = execute({
    debtMethod: 'invalid',
    debt1: 1000,
    apr1: 12,
    debtMin1: 50,
    debtBudget: 100
  });

  assert.equal(output.result, 'Invalid strategy');
});

if (process.exitCode) {
  console.error('\nDebt calculator tests failed.');
} else {
  console.log('\nAll debt calculator tests passed.');
}