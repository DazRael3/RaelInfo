import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('public/index.html', 'utf8');
const start = html.indexOf('  function calculateRetirement() {');
const end = html.indexOf('  function calculateNetWorth()', start);

if (start < 0 || end < 0) throw new Error('Retirement function not found.');

const source = html.slice(start, end);
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

function run(income, rate) {
  const elements = {
    retirementIncome: {
      value: income,
      attributes: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      removeAttribute(key) { delete this.attributes[key]; }
    },
    withdrawalRate: {
      value: rate,
      attributes: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      removeAttribute(key) { delete this.attributes[key]; }
    },
    retirementResult: { textContent: '' }
  };

  const context = {
    $: id => elements[id],
    money: value => value.toFixed(2)
  };

  vm.runInNewContext(source + '\ncalculateRetirement();', context);
  return elements;
}

function valid(income, rate, expected, description) {
  const result = run(income, rate);
  assert(
    Math.abs(Number(result.retirementResult.textContent) - expected) < 0.01 &&
    !result.retirementIncome.attributes['aria-invalid'] &&
    !result.withdrawalRate.attributes['aria-invalid'],
    description
  );
}

function invalid(income, rate, field, description) {
  const result = run(income, rate);
  assert(
    result.retirementResult.textContent === 'Invalid inputs' &&
    result[field].attributes['aria-invalid'] === 'true',
    description
  );
}

valid('60000', '4', 1500000, 'Standard $60,000 income at 4% produces a $1,500,000 target');
valid('40000', '4', 1000000, 'Annual income target is calculated correctly');
valid('60000', '0.1', 60000000, 'Minimum permitted withdrawal rate is accepted');
valid('60000', '20', 300000, 'Maximum permitted withdrawal rate is accepted');
valid('0', '4', 0, 'Zero annual income produces a zero portfolio target');

invalid('-1', '4', 'retirementIncome', 'Negative annual income is rejected and marked invalid');
invalid('', '4', 'retirementIncome', 'Blank annual income is rejected and marked invalid');
invalid('Infinity', '4', 'retirementIncome', 'Non-finite annual income is rejected');
invalid('60000', '-1', 'withdrawalRate', 'Negative withdrawal rate is rejected and marked invalid');
invalid('60000', '0', 'withdrawalRate', 'Zero withdrawal rate is rejected and marked invalid');
invalid('60000', '0.09', 'withdrawalRate', 'Withdrawal rate below 0.1% is rejected');
invalid('60000', '20.1', 'withdrawalRate', 'Withdrawal rate above 20% is rejected');
invalid('60000', '', 'withdrawalRate', 'Blank withdrawal rate is rejected and marked invalid');
invalid('60000', 'Infinity', 'withdrawalRate', 'Non-finite withdrawal rate is rejected');

const overflow = run('1e308', '0.1');
assert(
  overflow.retirementResult.textContent === 'Calculation unavailable',
  'Overflowing portfolio target fails safely instead of displaying Infinity'
);

console.log('\nRetirement audit: ' + passed + ' passed, ' + failed + ' failed.');
if (failed > 0) process.exitCode = 1;
else console.log('ALL RETIREMENT CALCULATOR AUDIT TESTS PASSED');
