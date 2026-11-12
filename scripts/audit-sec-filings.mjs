import assert from 'node:assert/strict';
import { buildSecFilingUrl } from '../functions/api/filings.js';

const base = 'https://www.sec.gov/Archives/edgar/data/320193';

assert.equal(
  buildSecFilingUrl(
    '0000320193',
    '0001354457-26-001062',
    'xslF25X02/primary_doc.xml'
  ),
  `${base}/000135445726001062/xslF25X02/primary_doc.xml`
);
console.log('PASS nested SEC document paths preserve directory separators');

assert.equal(
  buildSecFilingUrl(
    '320193',
    '0001140361-26-042798',
    'ef20085077_8k.htm'
  ),
  `${base}/000114036126042798/ef20085077_8k.htm`
);
console.log('PASS ordinary SEC HTML document URLs');

assert.equal(
  buildSecFilingUrl(
    '320193',
    '0001140361-26-042798',
    'folder name/report #1.xml'
  ),
  `${base}/000114036126042798/folder%20name/report%20%231.xml`
);
console.log('PASS individual path segments are safely encoded');

for (const document of [
  '',
  '/primary_doc.xml',
  '../secret.xml',
  'folder/../secret.xml',
  'folder//secret.xml',
  'folder\\secret.xml',
  'folder/file.xml?redirect=evil',
  'folder/file.xml#fragment',
  'folder/\u0000file.xml'
]) {
  assert.equal(
    buildSecFilingUrl('320193', '0001140361-26-042798', document),
    '',
    `Unsafe SEC document path rejected: ${JSON.stringify(document)}`
  );
}
console.log('PASS unsafe SEC document paths are rejected');

assert.equal(
  buildSecFilingUrl('not-a-cik', '0001140361-26-042798', 'filing.htm'),
  ''
);
assert.equal(
  buildSecFilingUrl('320193', 'invalid-accession', 'filing.htm'),
  ''
);
assert.equal(
  buildSecFilingUrl('320193', '0001140361-26-042798', ''),
  ''
);
console.log('PASS malformed CIKs, accession numbers and empty documents are rejected');

console.log('\nALL SEC FILINGS URL AUDIT TESTS PASSED');
