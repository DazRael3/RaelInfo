import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const file = resolve(process.argv[2] || 'public/index.html');
const html = readFileSync(file, 'utf8');

const start = html.indexOf('function runDebtSimulation() {');
const end = html.indexOf('function calculateSavings()', start);

assert.notEqual(start, -1, 'runDebtSimulation() not found');
assert.notEqual(end, -1, 'Could not locate end of debt calculator function');

const source = html.slice(start, end);

function execute(overrides = {}) {
  const values = {
    debtMethod: 'avalanche',
    debt1: '500',
    apr1: '5',
    debtMin1: '25',
    debt2: '1000',
    apr2: '20',
    debtMin2: '50',
    debt3: '0',
    apr3: '0',
    debtMin3: '0',
    debtBudget: '100',
    ...overrides
  };

  const nodes = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      { value: String(value), textContent: '' }
    ])
  );

  nodes.debtResult = { textContent: '' };
  nodes.debtBreakdown = { textContent: '' };

  const context = {
    $: id => nodes[id] ?? null,
    number: id => Number(nodes[id]?.value ?? 0),
    clampNonNegative: value => Math.max(0, Number.isFinite(value) ? value : 0),
    money: value => `$${Number(value).toFixed(2)}`
  };

  runInNewContext(`${source}\nrunDebtSimulation();`, context);

  return {
    result: nodes.debtResult.textContent,
    breakdown: nodes.debtBreakdown.textContent
  };
}

function verifyStrategy(method, expectedInterest, expectedTotal, expectedOrder) {
  const output = execute({ debtMethod: method });

  assert.equal(output.result, '1y 5m', `${method}: payoff duration`);
  assert.ok(
    output.breakdown.includes(`Estimated interest: $${expectedInterest}`),
    `${method}: incorrect interest: ${output.breakdown}`
  );
  assert.ok(
    output.breakdown.includes(`Total paid: $${expectedTotal}`),
    `${method}: incorrect repayment total: ${output.breakdown}`
  );
  assert.ok(
    output.breakdown.includes(`Payoff order: ${expectedOrder}`),
    `${method}: incorrect payoff order: ${output.breakdown}`
  );

  console.log(`PASS ${method.toUpperCase()}`);
  console.log(`  Payoff: ${output.result}`);
  console.log(`  Interest: $${expectedInterest}`);
  console.log(`  Total repayment: $${expectedTotal}`);
  console.log(`  Order: ${expectedOrder}`);
}

verifyStrategy(
  'avalanche',
  '162.32',
  '1662.32',
  'Debt 2 → Debt 1'
);

verifyStrategy(
  'snowball',
  '196.13',
  '1696.13',
  'Debt 1 → Debt 2'
);

const missingMinimum = execute({ debtMin1: '' });
assert.equal(missingMinimum.result, 'Minimum payment required');
console.log('PASS missing minimum-payment validation');

const insufficientBudget = execute({ debtBudget: '74.99' });
assert.equal(insufficientBudget.result, 'Budget too low');
console.log('PASS budget-too-low rejection');

console.log(`\nALL 4 AUDIT GROUPS PASSED: ${file}`);
