import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { runRetentionCleanup } from '../workers/inquiry-retention/index.js';

const db = new DatabaseSync(':memory:');

function migration(path) {
  db.exec(readFileSync(path, 'utf8'));
}

function insertInquiry(id, createdAt, legalHold = 0, reason = '') {
  db.prepare(`
    INSERT INTO business_inquiries (
      id, contact_name, contact_email, organization,
      inquiry_type, website, message, consent, status, created_at,
      legal_hold, legal_hold_reason
    )
    VALUES (?, 'Test Contact', ?, 'Test Organization',
      'other', '', 'This is a local integration test inquiry.', 1,
      'new', ?, ?, ?)
  `).run(id, `${id}@example.test`, createdAt, legalHold, reason);
}

try {
  migration('migrations/0001_initial.sql');
  migration('migrations/0002_revenue.sql');

  const originalTimestamp = new Date().toISOString();

  db.prepare(`
    INSERT INTO business_inquiries (
      id, contact_name, contact_email, organization,
      inquiry_type, website, message, consent, status, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'new', ?)
  `).run(
    'pre-migration-record',
    'Existing Contact',
    'existing@example.test',
    'Existing Organization',
    'other',
    '',
    'Existing inquiry preserved by migration.',
    originalTimestamp
  );

  migration('migrations/0004_inquiry_retention.sql');

  const preserved = db.prepare(`
    SELECT id, legal_hold, legal_hold_reason
    FROM business_inquiries
    WHERE id = ?
  `).get('pre-migration-record');

  assert.ok(preserved, 'Migration must preserve existing inquiry');
  assert.equal(Number(preserved.legal_hold), 0);
  assert.equal(preserved.legal_hold_reason, '');
  console.log('PASS migration preserves existing inquiries and applies safe defaults');

  const index = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'index'
      AND name = 'idx_business_inquiries_retention'
  `).get();

  assert.ok(index, 'Retention index must exist');
  console.log('PASS retention index is created');

  const oldTimestamp = '2000-01-01T00:00:00.000Z';
  const recentTimestamp = new Date().toISOString();

  const insertOld = db.prepare(`
    INSERT INTO business_inquiries (
      id, contact_name, contact_email, organization,
      inquiry_type, website, message, consent, status, created_at,
      legal_hold, legal_hold_reason
    )
    VALUES (?, 'Test Contact', ?, 'Test Organization',
      'other', '', 'Local retention test record.', 1,
      'new', ?, 0, '')
  `);

  for (let i = 0; i < 501; i += 1) {
    insertOld.run(
      `eligible-${i}`,
      `eligible-${i}@example.test`,
      oldTimestamp
    );
  }

  insertInquiry(
    'held-old-record',
    oldTimestamp,
    1,
    'Documented local legal hold test'
  );

  insertInquiry('recent-record', recentTimestamp);

  const adapter = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            run() {
              const result = db.prepare(sql).run(...values);
              return { meta: { changes: Number(result.changes) } };
            }
          };
        }
      };
    }
  };

  const result = await runRetentionCleanup(adapter);

  assert.equal(result.ok, true);
  assert.equal(result.deleted, 501);
  assert.equal(result.batches, 2);
  assert.equal(result.moreEligibleRecordsMayRemain, false);
  console.log('PASS actual SQLite cleanup deletes 501 eligible old inquiries in two batches');

  const remainingEligible = Number(
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM business_inquiries
      WHERE id LIKE 'eligible-%'
    `).get().count
  );

  assert.equal(remainingEligible, 0);
  console.log('PASS no eligible old test inquiries remain');

  const held = db.prepare(`
    SELECT legal_hold, legal_hold_reason
    FROM business_inquiries WHERE id = ?
  `).get('held-old-record');

  assert.ok(held, 'Held inquiry must remain');
  assert.equal(Number(held.legal_hold), 1);
  assert.equal(held.legal_hold_reason, 'Documented local legal hold test');
  console.log('PASS old inquiry under legal hold is preserved');

  assert.ok(
    db.prepare('SELECT id FROM business_inquiries WHERE id = ?')
      .get('recent-record'),
    'Recent inquiry must remain'
  );
  console.log('PASS recent inquiry is preserved');

  assert.ok(
    db.prepare('SELECT id FROM business_inquiries WHERE id = ?')
      .get('pre-migration-record'),
    'Pre-migration inquiry must remain'
  );
  console.log('PASS pre-migration inquiry remains intact after cleanup');

  console.log('\nALL SQLITE RETENTION INTEGRATION TESTS PASSED');
} finally {
  db.close();
}