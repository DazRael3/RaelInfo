import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = fs.readFileSync('public/index.html', 'utf8');
const match = html.match(/  function calculateRentBuy\(\) \{[\s\S]*?\n  \}/);

assert(match, 'Rent vs Buy calculator function must exist.');

const source = match[0];

const ids = [
  'rentMonthly',
  'buyMortgage',
  'buyTax',
  'buyInsurance',
  'buyMaintenance',
  'buyFees'
];

let passed = 0;
let failed = 0;

function check(condition, description) {
  try {
    assert.ok(condition);
    passed++;
    console.log('PASS ' + description);
  } catch (error) {
    failed++;
    console.error('FAIL ' + description);
  }
}

function run(overrides = {}) {
  const elements = {};

  for (const id of ids) {
    elements[id] = {
      value: Object.hasOwn(overrides, id) ? overrides[id] : '0',
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      removeAttribute(name) {
        delete this.attributes[name];
      }
    };
  }

  elements.rentBuyResult = { textContent: '' };
  elements.rentBuyBreakdown = { textContent: '' };

  const context = {
    $: id => elements[id],
    money: value => '$' + value.toFixed(2)
  };

  vm.runInNewContext(source + '\ncalculateRentBuy();', context);
  return elements;
}

// Standard comparison.
const standard = run({
  rentMonthly: '2200',
  buyMortgage: '2400',
  buyTax: '300',
  buyInsurance: '125',
  buyMaintenance: '150',
  buyFees: '0'
});

check(
  standard.rentBuyResult.textContent === '$2975.00' &&
  standard.rentBuyBreakdown.textContent.includes('$775.00 higher than rent'),
  'Standard ownership cost and rent comparison are correct'
);

// Ownership is cheaper.
const cheaper = run({
  rentMonthly: '200',
  buyMortgage: '100'
});

check(
  cheaper.rentBuyResult.textContent === '$100.00' &&
  cheaper.rentBuyBreakdown.textContent.includes('$100.00 lower than rent'),
  'Ownership cost lower than rent is reported correctly'
);

// Equal costs.
const equal = run({
  rentMonthly: '100',
  buyMortgage: '100'
});

check(
  equal.rentBuyResult.textContent === '$100.00' &&
  equal.rentBuyBreakdown.textContent.includes('the same as rent'),
  'Equal rent and ownership costs are reported correctly'
);

// All-zero inputs.
const zero = run();

check(
  zero.rentBuyResult.textContent === '$0.00' &&
  zero.rentBuyBreakdown.textContent.includes('the same as rent'),
  'All-zero inputs produce a zero comparison'
);

// Every input must reject negative values.
for (const id of ids) {
  const values = Object.fromEntries(ids.map(field => [field, '100']));
  values[id] = '-1';
  const result = run(values);

  check(
    result.rentBuyResult.textContent === 'Invalid inputs' &&
    result[id].attributes['aria-invalid'] === 'true',
    'Negative value in ' + id + ' is rejected and marked invalid'
  );
}

// Every input must reject blanks.
for (const id of ids) {
  const values = Object.fromEntries(ids.map(field => [field, '100']));
  values[id] = '';
  const result = run(values);

  check(
    result.rentBuyResult.textContent === 'Invalid inputs' &&
    result[id].attributes['aria-invalid'] === 'true',
    'Blank value in ' + id + ' is rejected and marked invalid'
  );
}

// Every input must reject non-finite numbers.
for (const id of ids) {
  const values = Object.fromEntries(ids.map(field => [field, '100']));
  values[id] = 'Infinity';
  const result = run(values);

  check(
    result.rentBuyResult.textContent === 'Invalid inputs' &&
    result[id].attributes['aria-invalid'] === 'true',
    'Non-finite value in ' + id + ' is rejected and marked invalid'
  );
}

// Ownership sum must not overflow.
const overflow = run({
  buyMortgage: '1e308',
  buyTax: '1e308'
});

check(
  overflow.rentBuyResult.textContent === 'Calculation unavailable',
  'Ownership cost overflow fails safely'
);

console.log('\nRent vs Buy audit: ' + passed + ' passed, ' + failed + ' failed.');

if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log('ALL RENT VS BUY CALCULATOR AUDIT TESTS PASSED');
}