import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  onRequestPatch,
  onRequestDelete
} from '../functions/api/admin/revenue/inquiries/[id].js';

const db = new DatabaseSync(':memory:');
const ADMIN_TOKEN = 'local-test-token-that-is-longer-than-32-characters';

for (const path of [
  'migrations/0001_initial.sql',
  'migrations/0002_revenue.sql',
  'migrations/0004_inquiry_retention.sql'
]) {
  db.exec(readFileSync(path, 'utf8'));
}

const original = db.prepare(`
  INSERT INTO business_inquiries (
    id, contact_name, contact_email, organization,
    inquiry_type, website, message, consent, status, created_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'new', ?)
`);

original.run(
  'endpoint-test',
  'Local Test',
  'local@example.test',
  'Local Test Organization',
  'other',
  '',
  'This record exists only in an in-memory SQLite database.',
  new Date().toISOString()
);

const adapter = {
  prepare(sql) {
    return {
      bind(...values) {
        return {
          run() {
            // Simulate D1 returning zero changes for unchanged UPDATEs.
            if (sql.includes('UPDATE business_inquiries SET status = ?')) {
              const current = db.prepare(
                'SELECT status FROM business_inquiries WHERE id = ?'
              ).get(values[1]);

              if (current && current.status === values[0]) {
                return { meta: { changes: 0 } };
              }
            }

            if (sql.includes('UPDATE business_inquiries SET legal_hold = ?')) {
              const current = db.prepare(
                'SELECT legal_hold, legal_hold_reason FROM business_inquiries WHERE id = ?'
              ).get(values[2]);

              if (
                current &&
                Number(current.legal_hold) === Number(values[0]) &&
                current.legal_hold_reason === values[1]
              ) {
                return { meta: { changes: 0 } };
              }
            }

            const result = db.prepare(sql).run(...values);
            return { meta: { changes: Number(result.changes) } };
          },

          first() {
            return db.prepare(sql).get(...values) ?? null;
          }
        };
      }
    };
  }
};

const env = {
  DB: adapter,
  RAELINFO_ADMIN_TOKEN: ADMIN_TOKEN
};

function makeRequest(method, body, options = {}) {
  const headers = new Headers({
    Authorization: options.authorization ?? `Bearer ${ADMIN_TOKEN}`,
    Origin: options.origin ?? 'https://www.raelinfo.com',
    'Sec-Fetch-Site': options.fetchSite ?? 'same-origin'
  });

  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  return new Request(
    'https://www.raelinfo.com/api/admin/revenue/inquiries/endpoint-test',
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    }
  );
}

async function callPatch(body, options = {}, id = 'endpoint-test') {
  return onRequestPatch({
    request: makeRequest('PATCH', body, options),
    env,
    params: { id }
  });
}

async function callDelete(options = {}, id = 'endpoint-test') {
  return onRequestDelete({
    request: makeRequest('DELETE', undefined, options),
    env,
    params: { id }
  });
}

async function expectStatus(response, expected, label) {
  assert.equal(response.status, expected, label);
  console.log(`PASS ${label}`);
}

try {
  await expectStatus(
    await callPatch(
      { status: 'reviewing' },
      { authorization: 'Bearer invalid-token' }
    ),
    401,
    'unauthorized admin update is rejected'
  );

  await expectStatus(
    await callPatch(
      { status: 'reviewing' },
      { origin: 'https://attacker.example' }
    ),
    403,
    'cross-origin admin update is rejected'
  );

  await expectStatus(
    await callPatch({ status: 'reviewing' }),
    200,
    'status update succeeds'
  );

  await expectStatus(
    await callPatch({ status: 'reviewing' }),
    200,
    'unchanged status succeeds when D1 reports zero changes'
  );

  await expectStatus(
    await callPatch({ legalHold: false }),
    200,
    'unchanged legal-hold setting succeeds when D1 reports zero changes'
  );

  await expectStatus(
    await callPatch({ legalHold: true }),
    400,
    'placing a legal hold without a documented reason is rejected'
  );

  await expectStatus(
    await callPatch({
      legalHold: true,
      reason: 'Documented local legal review requirement'
    }),
    200,
    'legal hold with a documented reason succeeds'
  );

  await expectStatus(
    await callPatch({
      legalHold: true,
      reason: 'Documented local legal review requirement'
    }),
    200,
    'unchanged legal hold succeeds when D1 reports zero changes'
  );

  await expectStatus(
    await callDelete(),
    409,
    'held inquiry cannot be deleted'
  );

  await expectStatus(
    await callPatch({ legalHold: false }),
    200,
    'legal hold can be cleared'
  );

  await expectStatus(
    await callDelete(),
    200,
    'unheld inquiry can be individually deleted'
  );

  await expectStatus(
    await callDelete(),
    404,
    'deleting a nonexistent inquiry returns not found'
  );

  await expectStatus(
    await callPatch({ status: 'reviewing' }, {}, 'missing-record'),
    404,
    'updating a nonexistent inquiry returns not found'
  );

  const remaining = db.prepare(
    'SELECT COUNT(*) AS count FROM business_inquiries'
  ).get();

  assert.equal(Number(remaining.count), 0);
  console.log('PASS endpoint test leaves no test inquiries behind');

  console.log('\nALL ADMIN ENDPOINT INTEGRATION TESTS PASSED');
} finally {
  db.close();
}