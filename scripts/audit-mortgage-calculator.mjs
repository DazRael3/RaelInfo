import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const file = resolve('public/index.html');
const html = readFileSync(file, 'utf8');

const start = html.indexOf('function calculateMortgage() {');
const end = html.indexOf('function calculateCompound()', start);

assert.notEqual(start, -1, 'calculateMortgage() not found');
assert.notEqual(end, -1, 'Could not locate end of mortgage calculator');

const source = html.slice(start, end);

function execute(overrides = {}) {
  const values = {
    mortgageAmount: '350000',
    mortgageRate: '6.5',
    mortgageYears: '30',
    mortgageTax: '3600',
    mortgageInsurance: '1500',
    mortgageHoa: '0',
    ...overrides
  };

  const nodes = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
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

  for (const id of ['mortgageResult', 'mortgageBreakdown', 'mortgageSchedule']) {
    nodes[id] = {
      value: '',
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

  runInNewContext(`${source}\ncalculateMortgage();`, context);

  return nodes;
}

function check(condition, message) {
  assert.ok(condition, message);
  console.log(`PASS ${message}`);
}

const standard = execute();
const rate = 0.065 / 12;
const expectedPI = 350000 * rate / (1 - Math.pow(1 + rate, -360));
const expectedTotal = expectedPI + 300 + 125;

assert.equal(
  standard.mortgageResult.textContent,
  `$${expectedTotal.toFixed(2)}`
);
check(true, 'Standard 30-year mortgage payment and housing extras');

check(
  standard.mortgageBreakdown.textContent.includes(`$${expectedPI.toFixed(2)}`),
  'Principal and interest breakdown'
);

check(
  ((standard.mortgageSchedule.innerHTML.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1].match(/<tr>/g)) || []).length === 5,
  'Five-year amortization schedule contains five annual rows'
);

const zeroRate = execute({ mortgageRate: '0' });
const zeroRateTotal = 350000 / 360 + 425;

assert.equal(
  zeroRate.mortgageResult.textContent,
  `$${zeroRateTotal.toFixed(2)}`
);
check(true, 'Zero-interest mortgage calculation');

const zeroPrincipal = execute({
  mortgageAmount: '0',
  mortgageTax: '1200',
  mortgageInsurance: '600',
  mortgageHoa: '100'
});

assert.equal(zeroPrincipal.mortgageResult.textContent, '$250.00');
check(true, 'Zero principal with additional housing costs');

for (const [label, overrides, invalidField] of [
  ['Negative loan amount', { mortgageAmount: '-1' }, 'mortgageAmount'],
  ['Negative interest rate', { mortgageRate: '-1' }, 'mortgageRate'],
  ['Interest rate above 100%', { mortgageRate: '100.01' }, 'mortgageRate'],
  ['Negative property tax', { mortgageTax: '-1' }, 'mortgageTax'],
  ['Negative insurance', { mortgageInsurance: '-1' }, 'mortgageInsurance'],
  ['Negative HOA', { mortgageHoa: '-1' }, 'mortgageHoa'],
  ['Blank loan amount', { mortgageAmount: '' }, 'mortgageAmount'],
  ['Unsupported loan term', { mortgageYears: '7' }, 'mortgageYears']
]) {
  const result = execute(overrides);

  assert.equal(result.mortgageResult.textContent, 'Invalid inputs', label);
  assert.equal(result[invalidField].attributes['aria-invalid'], 'true', label);
  assert.equal(result.mortgageSchedule.innerHTML, '', label);

  check(true, `${label} is rejected and marked invalid`);
}

console.log('\nALL MORTGAGE CALCULATOR AUDIT TESTS PASSED');