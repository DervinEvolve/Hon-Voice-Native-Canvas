import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { Connection } from '@solana/web3.js';

// @solana/web3.js 1.x builds its JSON-RPC client on jayson/lib/client/browser.
// package.json overrides jayson to 5.x (drops stream-json and uuid); this keeps
// the request/response contract web3.js relies on under test. No network.
const require = createRequire(import.meta.url);
const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('web3.js resolves the overridden jayson without stream-json or uuid', () => {
  const web3 = require.resolve('@solana/web3.js');
  const jayson = createRequire(web3)('jayson/package.json');
  assert.equal(jayson.version.split('.')[0], '5');
  assert.equal(jayson.dependencies['stream-json'], undefined);
  assert.equal(jayson.dependencies.uuid, undefined);
});

test('single and batch RPC calls round-trip through the jayson browser client', async () => {
  const seen = [];
  const fetch = async (url, init) => {
    assert.equal(url, 'https://rpc.example.com/');
    assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body);
    seen.push(body);
    const reply = (req) => ({ jsonrpc: '2.0', id: req.id, result: req.method === 'getVersion'
      ? { 'solana-core': '2.0.0', 'feature-set': 1 }
      : { context: { slot: 7 }, value: 42 } });
    return new Response(JSON.stringify(Array.isArray(body) ? body.map(reply) : reply(body)), { headers: { 'content-type': 'application/json' } });
  };
  const connection = new Connection('https://rpc.example.com/', { fetch, commitment: 'confirmed' });
  assert.deepEqual(await connection.getVersion(), { 'solana-core': '2.0.0', 'feature-set': 1 });
  assert.equal(seen[0].jsonrpc, '2.0');
  assert.match(seen[0].id, uuidLike);
  const batch = await connection._rpcBatchRequest([
    { methodName: 'getBalance', args: ['11111111111111111111111111111111'] },
    { methodName: 'getBalance', args: ['11111111111111111111111111111111'] },
  ]);
  assert.equal(batch.length, 2);
  assert.equal(batch[1].result.value, 42);
  assert.equal(seen[1].length, 2);
  assert.notEqual(seen[1][0].id, seen[1][1].id);
  for (const req of seen[1]) assert.match(req.id, uuidLike);
});
