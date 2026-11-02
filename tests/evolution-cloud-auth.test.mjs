import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

process.env.VERCEL = '1';
process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_ANON_KEY = 'synthetic-test-key';
const { app } = await import('../src/server.js');
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
test.after(() => new Promise((resolve) => server.close(resolve)));

test('Evolution API cloud bridge is behind API authentication', async () => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/evolution-cloud/status`);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).authRequired, true);
});
