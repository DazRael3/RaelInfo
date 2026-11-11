import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const html = readFileSync(resolve('public/index.html'), 'utf8');
const start = html.indexOf('function calculateInflation() {');
const end = html.indexOf('function calculateRetirement()', start);

assert.notEqual(start, -1, 'calculateInflation() not found');
assert.notEqual(end, -1, 'Could not locate end of inflation calculator');

const source = html.slice(start, end);

function execute(overrides = {}) {
  const values = {
    inflationAmount: '10000',
    inflationRate: '3',
    inflationYears: '10',
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

  nodes.inflationResult = {
    textContent: '',
    attributes: {},
    setAttribute(name, val) { this.attributes[name] = val; },
    removeAttribute(name) { delete this.attributes[name]; }
  };

  const context = {
    $: id => nodes[id] ?? null,
    money: value => '$' + value.toFixed(2),
    Number,
    Math,
    Object,
    String
  };

  runInNewContext(source + '\ncalculateInflation();', context);
  return nodes;
}

function check(condition, message) {
  assert.ok(condition, message);
  console.log('PASS ' + message);
}

const standard = execute();
const expected = 10000 / Math.pow(1.03, 10);
assert.equal(standard.inflationResult.textContent, '$' + expected.toFixed(2));
check(true, 'Standard purchasing-power projection matches independent calculation');

const zeroRate = execute({ inflationRate: '0' });
assert.equal(zeroRate.inflationResult.textContent, '$10000.00');
check(true, 'Zero inflation preserves purchasing power');

const zeroAmount = execute({ inflationAmount: '0' });
assert.equal(zeroAmount.inflationResult.textContent, '$0.00');
check(true, 'Zero current amount produces zero purchasing power');

for (const years of ['5', '10', '15', '20', '30']) {
  const result = execute({ inflationYears: years });
  assert.notEqual(result.inflationResult.textContent, 'Invalid inputs');
  assert.equal(result.inflationYears.attributes['aria-invalid'], undefined);
}
check(true, 'All periods offered by the interface are accepted');

for (const [label, overrides, field] of [
  ['Negative current amount', { inflationAmount: '-1' }, 'inflationAmount'],
  ['Blank current amount', { inflationAmount: '' }, 'inflationAmount'],
  ['Non-finite current amount', { inflationAmount: 'Infinity' }, 'inflationAmount'],
  ['Negative inflation rate', { inflationRate: '-0.1' }, 'inflationRate'],
  ['Inflation rate above 100%', { inflationRate: '100.1' }, 'inflationRate'],
  ['Blank inflation rate', { inflationRate: '' }, 'inflationRate'],
  ['Non-finite inflation rate', { inflationRate: 'Infinity' }, 'inflationRate'],
  ['Unsupported period', { inflationYears: '7' }, 'inflationYears'],
  ['Blank period', { inflationYears: '' }, 'inflationYears'],
  ['Fractional period', { inflationYears: '10.5' }, 'inflationYears']
]) {
  const result = execute(overrides);
  assert.equal(result.inflationResult.textContent, 'Invalid inputs', label);
  assert.equal(result[field].attributes['aria-invalid'], 'true', label);
  check(true, label + ' is rejected and marked invalid');
}

for (const [label, overrides] of [
  ['Zero inflation boundary', { inflationRate: '0' }],
  ['100% inflation boundary', { inflationRate: '100' }]
]) {
  const result = execute(overrides);
  assert.notEqual(result.inflationResult.textContent, 'Invalid inputs');
  assert.equal(result.inflationRate.attributes['aria-invalid'], undefined);
  check(true, label + ' is accepted');
}

const overflow = execute({ inflationAmount: '1e309' });
assert.equal(overflow.inflationResult.textContent, 'Invalid inputs');
check(true, 'Overflowing numeric input is rejected safely');

console.log('\nALL INFLATION IMPACT CALCULATOR AUDIT TESTS PASSED');
