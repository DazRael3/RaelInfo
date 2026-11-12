const BATCH_SIZE = 500;
const MAX_BATCHES_PER_RUN = 10;

export async function runRetentionCleanup(db) {
  if (!db) throw new Error('D1 database binding is required.');

  let deleted = 0;
  let batches = 0;

  for (let index = 0; index < MAX_BATCHES_PER_RUN; index += 1) {
    const result = await db.prepare(`
      DELETE FROM business_inquiries
      WHERE id IN (
        SELECT id
        FROM business_inquiries
        WHERE legal_hold = 0
          AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 months')
        ORDER BY created_at ASC
        LIMIT ?
      )
    `).bind(BATCH_SIZE).run();

    const changes = Number(result.meta?.changes || 0);
    deleted += changes;
    batches += 1;

    if (changes < BATCH_SIZE) {
      return {
        ok: true,
        deleted,
        batches,
        moreEligibleRecordsMayRemain: false
      };
    }
  }

  return {
    ok: true,
    deleted,
    batches,
    moreEligibleRecordsMayRemain: true
  };
}

export default {
  async scheduled(controller, env) {
    const result = await runRetentionCleanup(env.DB);
    console.log(JSON.stringify({
      event: 'inquiry_retention_cleanup',
      scheduledTime: controller.scheduledTime,
      cron: controller.cron,
      ...result
    }));
  },

  async fetch() {
    return new Response('Not found.', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
};