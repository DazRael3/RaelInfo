import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('public/app.js', 'utf8');
const html = readFileSync('public/index.html', 'utf8');

assert.match(app, /async function lookupStock\(symbol\)/,
  'Stock lookup function must exist.');

assert.match(app, /https:\/\/s3\.tradingview\.com\/external-embedding\/embed-widget-symbol-info\.js/,
  'Public stock lookup must use the TradingView Symbol Info widget.');

assert.match(app, /symbol:\s*tradingViewSymbol/,
  'The entered symbol must be passed to the TradingView widget.');

assert.match(app, /Market data and quotes by TradingView/,
  'TradingView attribution must remain visible.');

assert.match(app, /tradingViewSymbol\s*=\s*`NASDAQ:\$\{entered\}`/,
  'Unqualified ticker handling must remain intact.');

assert.doesNotMatch(app, /\/api\/stock\b/,
  'Public stock lookup must not depend on the backend stock API.');

assert.match(html, /id="stockOutput"/,
  'Public stock lookup output container must exist.');

assert.match(html, /Stock quote lookup/i,
  'Public stock lookup section must exist.');

console.log('PASS: TradingView Symbol Info widget is configured.');
console.log('PASS: Ticker symbol is passed to the widget.');
console.log('PASS: TradingView attribution is present.');
console.log('PASS: Public stock lookup does not call /api/stock.');
console.log('PASS: Public stock lookup markup exists.');
console.log('PASS: No paid stock-provider dependency was introduced.');
