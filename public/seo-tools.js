import { trackSiteEvent } from './revenue.js';

const $ = id => document.getElementById(id);
const number = id => Number($(id)?.value || 0);
const money = (value, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value) || 0);
const output = (id, text, note = '') => { if ($(id)) $(id).textContent = text; const noteEl = $(`${id}Note`); if (noteEl && note) noteEl.textContent = note; };
const selectedMarket = () => { try { const market = localStorage.getItem('raelinfo_market_v1'); return market === 'CA' ? 'CA' : 'US'; } catch { return 'US'; } };

function initMortgage() {
  const form = $('mortgageSeoForm'); if (!form) return;
  form.addEventListener('submit', event => {
    event.preventDefault();
    const principal = Math.max(0, number('seoLoan'));
    const annualRate = Math.max(0, number('seoMortgageRate')) / 100;
    const years = Math.min(50, Math.max(1, number('seoMortgageYears')));
    const taxes = Math.max(0, number('seoPropertyTax')) / 12;
    const insurance = Math.max(0, number('seoInsurance')) / 12;
    const months = Math.round(years * 12); const monthlyRate = annualRate / 12;
    const pi = principal === 0 ? 0 : monthlyRate === 0 ? principal / months : principal * monthlyRate / (1 - Math.pow(1 + monthlyRate, -months));
    output('seoMortgageResult', money(pi + taxes + insurance), `Principal and interest: ${money(pi)} · Estimated taxes and insurance: ${money(taxes + insurance)} per month. Excludes HOA, PMI, closing costs and lender-specific fees.`);
    if (event.isTrusted) trackSiteEvent('calculator_use', 'housing', selectedMarket());
  });
  form.requestSubmit();
}

function initCompound() {
  const form = $('compoundSeoForm'); if (!form) return;
  form.addEventListener('submit', event => {
    event.preventDefault();
    const principal = Math.max(0, number('seoPrincipal'));
    const contribution = Math.max(0, number('seoContribution'));
    const annualRate = Math.max(-99, number('seoReturn')) / 100;
    const years = Math.min(80, Math.max(0, number('seoYears')));
    const months = Math.round(years * 12); const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;
    if (annualRate <= -1 || !Number.isFinite(monthlyRate)) { output('seoCompoundResult', 'Check the return assumption.'); return; }
    const growth = Math.pow(1 + monthlyRate, months);
    const initialFuture = principal * growth;
    const contributionFuture = monthlyRate === 0 ? contribution * months : contribution * ((growth - 1) / monthlyRate);
    const future = initialFuture + contributionFuture;
    const deposits = principal + contribution * months;
    output('seoCompoundResult', money(future), `Estimated deposits: ${money(deposits)} · Estimated growth: ${money(future - deposits)}. Assumes monthly contributions at month-end and a constant return; actual returns vary.`);
    if (event.isTrusted) trackSiteEvent('calculator_use', 'saving', selectedMarket());
  });
  form.requestSubmit();
}

function initDebt() {
  const form = $('debtSeoForm'); if (!form) return;
  form.addEventListener('submit', event => {
    event.preventDefault();
    let balance = Math.max(0, number('seoDebtBalance'));
    const apr = Math.max(0, number('seoDebtApr')) / 100;
    const payment = Math.max(0, number('seoDebtPayment'));
    const monthlyRate = apr / 12;
    if (balance <= 0) { output('seoDebtResult', 'Debt balance is zero.', ''); return; }
    if (payment <= balance * monthlyRate) { output('seoDebtResult', 'Payment does not cover interest.', 'Increase the monthly payment or review the APR. At this payment level, the balance will not decline under this simplified model.'); return; }
    let months = 0; let interestTotal = 0;
    while (balance > 0.005 && months < 1200) {
      const interest = balance * monthlyRate;
      interestTotal += interest;
      balance = Math.max(0, balance + interest - payment);
      months += 1;
    }
    if (months >= 1200 && balance > 0.005) { output('seoDebtResult', 'Payoff exceeds 100 years.', 'Try a higher monthly payment.'); return; }
    const years = Math.floor(months / 12); const remainder = months % 12;
    output('seoDebtResult', `${years ? `${years} yr ` : ''}${remainder ? `${remainder} mo` : ''}`.trim(), `Estimated interest: ${money(interestTotal)} · Total payments: ${money(Math.min(payment * months, Number.MAX_SAFE_INTEGER))}. Assumes no new charges, fees, rate changes or missed payments.`);
    if (event.isTrusted) trackSiteEvent('calculator_use', 'debt', selectedMarket());
  });
  form.requestSubmit();
}

function initFx() {
  const form = $('fxSeoForm'); if (!form) return;
  let rate = null; let rateDate = '';
  const run = () => {
    if (!(rate > 0)) { output('seoFxResult', 'Reference rate unavailable.', 'Retry while online.'); return; }
    const amount = Math.max(0, number('seoFxAmount'));
    const direction = $('seoFxDirection').value;
    const value = direction === 'USD-CAD' ? amount * rate : amount / rate;
    const from = direction === 'USD-CAD' ? 'USD' : 'CAD'; const to = direction === 'USD-CAD' ? 'CAD' : 'USD';
    output('seoFxResult', `${money(amount, from)} = ${money(value, to)}`, `Frankfurter daily reference rate dated ${rateDate || 'not supplied'}. This is not a cash-transfer quote; provider fees, spreads and execution rates may differ.`);
  };
  form.addEventListener('submit', event => { event.preventDefault(); run(); if (event.isTrusted) trackSiteEvent('calculator_use', 'crossborder', selectedMarket()); });
  $('seoFxAmount').addEventListener('input', run); $('seoFxDirection').addEventListener('change', run);
  fetch('/api/fx?from=USD&to=CAD', { cache: 'no-store', headers: { Accept: 'application/json' } })
    .then(response => { if (!response.ok) throw new Error('Rate unavailable'); return response.json(); })
    .then(data => { rate = Number(data.rate); rateDate = data.date || ''; run(); })
    .catch(() => output('seoFxResult', 'Reference rate unavailable.', 'Open the main RaelInfo converter or retry while online.'));
}

document.addEventListener('DOMContentLoaded', () => {
  initMortgage(); initCompound(); initDebt(); initFx();
});
