import assert from 'node:assert/strict';
import { runRetentionCleanup } from '../workers/inquiry-retention/index.js';

function mockDb(changesPerBatch) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      assert.match(sql, /DELETE FROM business_inquiries/);
      assert.match(sql, /legal_hold = 0/);
      assert.match(sql, /-12 months/);
      return {
        bind(limit) {
          assert.equal(limit, 500);
          return {
            async run() {
              const changes = changesPerBatch.shift() ?? 0;
              calls.push(changes);
              return { meta: { changes } };
            }
          };
        }
      };
    }
  };
}

{
  const db = mockDb([12, 0]);
  const result = await runRetentionCleanup(db);
  assert.deepEqual(result, {
    ok: true,
    deleted: 12,
    batches: 1,
    moreEligibleRecordsMayRemain: false
  });
  assert.equal(db.calls.length, 1);
}

{
  const db = mockDb([500, 500, 500, 500, 500, 500, 500, 500, 500, 500]);
  const result = await runRetentionCleanup(db);
  assert.equal(result.deleted, 5000);
  assert.equal(result.batches, 10);
  assert.equal(result.moreEligibleRecordsMayRemain, true);
  assert.equal(db.calls.length, 10);
}

{
  await assert.rejects(
    () => runRetentionCleanup(null),
    /D1 database binding is required/
  );
}

console.log('PASS retention cleanup requires a D1 binding');
console.log('PASS cleanup targets only unheld inquiries older than 12 months');
console.log('PASS cleanup processes records in batches of 500');
console.log('PASS cleanup stops after ten batches and reports possible remaining records');
console.log('PASS retention tests use mock D1 only; no production records accessed');