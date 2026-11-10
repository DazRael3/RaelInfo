import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/auth/verify-recovery.js';

const origin = 'https://www.raelinfo.com';

function request(body) {
  return new Request(`${origin}/api/auth/verify-recovery`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

const mockDb = {
  prepare() {
    return {
      bind() { return this; },
      async run() { return {}; },
      async first() { return { hits: 1 }; }
    };
  }
};

const env = {
  DB: mockDb,
  SUPABASE_URL: 'https://project.example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key'
};

const originalFetch = globalThis.fetch;
let providerCalls = 0;

try {
  globalThis.fetch = async (url, options) => {
    providerCalls++;

    if (String(url).endsWith('/auth/v1/verify')) {
      const body = JSON.parse(options.body);

      assert.deepEqual(body, {
        email: 'person@example.com',
        token: '123456',
        type: 'recovery'
      });

      return new Response(JSON.stringify({
        access_token: 'access-token-for-test-123456789',
        refresh_token: 'refresh-token-for-test-123456789',
        expires_in: 3600
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (String(url).endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({
        id: 'user-test-1',
        email: 'person@example.com'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    throw new Error(`Unexpected provider request: ${url}`);
  };

  const invalidFormat = await onRequestPost({
    request: request({
      email: 'person@example.com',
      token: '12345'
    }),
    env
  });

  assert.equal(invalidFormat.status, 400);
  assert.equal(providerCalls, 0);
  console.log('PASS: Invalid recovery-code formats are rejected before provider access.');

  const verified = await onRequestPost({
    request: request({
      email: 'person@example.com',
      token: '123456'
    }),
    env
  });

  assert.equal(verified.status, 200);
  const result = await verified.json();
  assert.equal(result.ok, true);
  assert.equal(result.user.email, 'person@example.com');
  assert.ok(verified.headers.get('set-cookie'));
  assert.equal(providerCalls, 2);
  console.log('PASS: Valid recovery codes establish a verified session.');

  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/auth/v1/verify')) {
      return new Response(JSON.stringify({
        msg: 'Invalid token'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    throw new Error(`Unexpected provider request: ${url}`);
  };

  const rejected = await onRequestPost({
    request: request({
      email: 'person@example.com',
      token: '654321'
    }),
    env
  });

  assert.equal(rejected.status, 400);
  const rejectedBody = await rejected.json();
  assert.match(rejectedBody.error, /invalid or expired/i);
  console.log('PASS: Rejected recovery codes return a generic error.');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('All recovery OTP verification tests passed.');
