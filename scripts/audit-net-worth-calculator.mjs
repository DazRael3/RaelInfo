import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('public/index.html', 'utf8');
const start = html.indexOf('  function calculateNetWorth() {');
const end = html.indexOf('  function calculateRentBuy()', start);

if (start < 0 || end < 0) throw new Error('Net worth function not found.');

const source = html.slice(start, end);
const ids = ['nwCash', 'nwInvestments', 'nwProperty', 'nwOtherAssets', 'nwMortgage', 'nwOtherDebt'];
let passed = 0;
let failed = 0;

function assert(condition, description) {
  if (condition) {
    console.log('PASS ' + description);
    passed++;
  } else {
    console.error('FAIL ' + description);
    failed++;
  }
}

function run(values) {
  const elements = {};

  ids.forEach(id => {
    elements[id] = {
      value: String(values[id] ?? ''),
      attributes: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      removeAttribute(key) { delete this.attributes[key]; }
    };
  });

  elements.netWorthResult = { textContent: '' };
  elements.netWorthBreakdown = { textContent: '' };

  const context = {
    $: id => elements[id],
    money: value => '$' + value.toFixed(2)
  };

  vm.runInNewContext(source + '\ncalculateNetWorth();', context);
  return elements;
}

const standard = run({
  nwCash: '100',
  nwInvestments: '200',
  nwProperty: '300',
  nwOtherAssets: '400',
  nwMortgage: '500',
  nwOtherDebt: '100'
});

assert(
  standard.netWorthResult.textContent === '$400.00' &&
  standard.netWorthBreakdown.textContent === 'Assets: $1000.00 · Liabilities: $600.00',
  'Asset totals, liability totals, net worth and breakdown are correct'
);

const zero = run(Object.fromEntries(ids.map(id => [id, '0'])));
assert(
  zero.netWorthResult.textContent === '$0.00' &&
  zero.netWorthBreakdown.textContent === 'Assets: $0.00 · Liabilities: $0.00',
  'All-zero balances produce zero net worth'
);

const negative = run({
  nwCash: '100',
  nwInvestments: '0',
  nwProperty: '0',
  nwOtherAssets: '0',
  nwMortgage: '500',
  nwOtherDebt: '100'
});

assert(
  Number(negative.netWorthResult.textContent.replace(/[$,]/g, '')) === -500,
  'Liabilities exceeding assets correctly produce negative net worth'
);

for (const id of ids) {
  const values = Object.fromEntries(ids.map(field => [field, '100']));
  values[id] = '-1';
  const result = run(values);

  assert(
    result.netWorthResult.textContent === 'Invalid inputs' &&
    result[id].attributes['aria-invalid'] === 'true',
    'Negative value in ' + id + ' is rejected and marked invalid'
  );
}

for (const id of ids) {
  const values = Object.fromEntries(ids.map(field => [field, '100']));
  values[id] = '';
  const result = run(values);

  assert(
    result.netWorthResult.textContent === 'Invalid inputs' &&
    result[id].attributes['aria-invalid'] === 'true',
    'Blank value in ' + id + ' is rejected and marked invalid'
  );
}

for (const id of ids) {
  const values = Object.fromEntries(ids.map(field => [field, '100']));
  values[id] = 'Infinity';
  const result = run(values);

  assert(
    result.netWorthResult.textContent === 'Invalid inputs' &&
    result[id].attributes['aria-invalid'] === 'true',
    'Non-finite value in ' + id + ' is rejected and marked invalid'
  );
}

const assetOverflow = run({
  nwCash: '1e308',
  nwInvestments: '1e308',
  nwProperty: '0',
  nwOtherAssets: '0',
  nwMortgage: '0',
  nwOtherDebt: '0'
});

assert(
  assetOverflow.netWorthResult.textContent === 'Calculation unavailable',
  'Asset total overflow fails safely'
);

const liabilityOverflow = run({
  nwCash: '0',
  nwInvestments: '0',
  nwProperty: '0',
  nwOtherAssets: '0',
  nwMortgage: '1e308',
  nwOtherDebt: '1e308'
});

assert(
  liabilityOverflow.netWorthResult.textContent === 'Calculation unavailable',
  'Liability total overflow fails safely'
);

const resultOverflow = run({
  nwCash: '1e308',
  nwInvestments: '0',
  nwProperty: '0',
  nwOtherAssets: '0',
  nwMortgage: '1e308',
  nwOtherDebt: '0'
});

assert(
  resultOverflow.netWorthResult.textContent === '$0.00',
  'Large but finite equal assets and liabilities calculate safely'
);

console.log('\nNet worth audit: ' + passed + ' passed, ' + failed + ' failed.');
if (failed > 0) process.exitCode = 1;
else console.log('ALL NET WORTH CALCULATOR AUDIT TESTS PASSED');
