import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Import the real Higgsfield text-to-image handler with only the Supabase SDK
// replaced. The provider is a fake fetch that records calls and the characters
// table is a fake query builder that records its filters, so no provider,
// database or network is contacted.
const root = resolve(import.meta.dirname, '..');
const build = mkdtempSync(join(tmpdir(), 'hon-character-ownership-'));
cpSync(join(root, 'api'), join(build, 'api'), { recursive: true });
writeFileSync(join(build, 'package.json'), '{"type":"module"}');
const sdk = join(build, 'node_modules/@supabase/supabase-js');
mkdirSync(sdk, { recursive: true });
writeFileSync(join(sdk, 'package.json'), '{"type":"module","exports":"./index.js"}');
writeFileSync(join(sdk, 'index.js'), 'export function createClient(...args) { globalThis.__clientArgs.push(args); return globalThis.__apiClient; }');
symlinkSync(join(root, 'node_modules/jose'), join(build, 'node_modules/jose'));

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const originalError = console.error;
console.error = () => {};
after(() => {
  process.env = originalEnv;
  globalThis.fetch = originalFetch;
  console.error = originalError;
  delete globalThis.__apiClient;
  delete globalThis.__clientArgs;
  rmSync(build, { recursive: true, force: true });
});

const load = path => import(pathToFileURL(join(build, path)).href);
const { assertOwnedSoulId } = await load('api/_lib/character-ownership.js');
const handler = (await load('api/higgsfield/text-to-image.js')).default;
function res() { return { code: 200, body: null, headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(c) { this.code=c; return this; }, json(b) { this.body=b; return this; } }; }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const RAW = '0b7f6c1e-1d2a-4c55-9a51-3f3f0c9d1a22';
const SOUL = 'soul-owned-by-a';
// user-a saved SOUL; user-b saved nothing.
const characters = [{ id: 'row-1', user_id: 'user-a', soul_id: SOUL }];

let providerCalls = [];
let queries = [];
function configure({ queryError = null } = {}) {
  Object.assign(process.env, {
    HON_API_ALLOWED_USER_IDS: 'user-a,user-b',
    HON_OAUTH_STATE_SECRET: 'fixture-only-job-signing-' + 'x'.repeat(32),
    HON_API_MUTATIONS_PER_HOUR: '600',
    HON_API_PAID_JOBS_PER_HOUR: '100',
    SUPABASE_URL: 'https://project.example',
    SUPABASE_PUBLISHABLE_KEY: 'fixture-public-key',
    SUPABASE_SECRET_KEY: 'fixture-secret-key',
    // The request budget in api-access.js still reads only the legacy names.
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-legacy-key',
    HIGGSFIELD_API_KEY: 'fixture-higgsfield-key',
    HIGGSFIELD_SECRET: 'fixture-higgsfield-secret',
  });
  delete process.env.HON_JOB_ID_SECRET;
  delete process.env.SUPABASE_SERVICE_KEY;
  providerCalls = [];
  queries = [];
  globalThis.__clientArgs = [];
  const users = { 'test-session-a': 'user-a', 'test-session-b': 'user-b' };
  globalThis.__apiClient = {
    rpc: async () => ({ data: true, error: null }),
    auth: { getUser: async token => users[token] ? { data: { user: { id: users[token] } }, error: null } : { data: null, error: { status: 401 } } },
    from(table) {
      const query = { table, select: null, filters: [], limit: null };
      queries.push(query);
      const builder = {
        select(columns) { query.select = columns; return builder; },
        eq(column, value) { query.filters.push([column, value]); return builder; },
        async limit(n) {
          query.limit = n;
          if (queryError) return { data: null, error: queryError };
          const rows = characters.filter(row => table === 'user_characters' && query.filters.every(([c, v]) => row[c] === v));
          return { data: rows.slice(0, n).map(row => ({ id: row.id })), error: null };
        },
      };
      return builder;
    },
  };
  globalThis.fetch = async (url, init) => {
    providerCalls.push({ url: String(url), body: JSON.parse(init.body) });
    if (String(url) === 'https://platform.higgsfield.ai/v1/text2image/soul') return json({ id: RAW });
    throw new Error(`Unexpected network call: ${url}`);
  };
}

async function submit(body, session = 'test-session-a') {
  const response = res();
  await handler({ method: 'POST', headers: { authorization: `Bearer ${session}` }, body, query: {} }, response);
  return response;
}

test('an owned soul_id reaches the provider as custom_reference_id', async () => {
  configure();
  const response = await submit({ prompt: 'a lighthouse', soul_id: SOUL });
  assert.equal(response.code, 202, JSON.stringify(response.body));
  assert.deepEqual(queries, [{ table: 'user_characters', select: 'id', filters: [['soul_id', SOUL], ['user_id', 'user-a']], limit: 1 }]);
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].body.params.custom_reference_id, SOUL);
});

test("another user's soul_id answers 404 without a provider call", async () => {
  configure();
  const response = await submit({ prompt: 'a lighthouse', soul_id: SOUL }, 'test-session-b');
  assert.equal(response.code, 404);
  assert.deepEqual(response.body, { error: 'Character not found' });
  assert.deepEqual(queries[0].filters, [['soul_id', SOUL], ['user_id', 'user-b']]);
  assert.equal(providerCalls.length, 0);
});

test('an unknown soul_id and a failed lookup answer the same 404', async () => {
  configure();
  let response = await submit({ prompt: 'a lighthouse', soul_id: 'never-saved' });
  assert.equal(response.code, 404);
  assert.deepEqual(response.body, { error: 'Character not found' });
  configure({ queryError: { message: 'relation does not exist' } });
  response = await submit({ prompt: 'a lighthouse', soul_id: SOUL });
  assert.equal(response.code, 404);
  assert.deepEqual(response.body, { error: 'Character not found' });
  assert.equal(providerCalls.length, 0);
});

test('missing service-role configuration answers 503 and never falls back to the public key', async () => {
  for (const change of [
    () => { delete process.env.SUPABASE_SECRET_KEY; delete process.env.SUPABASE_SERVICE_ROLE_KEY; },
    () => { process.env.SUPABASE_URL = 'http://project.example'; },
    () => { delete process.env.SUPABASE_URL; delete process.env.VITE_SUPABASE_URL; },
  ]) {
    configure();
    change();
    await assert.rejects(assertOwnedSoulId('user-a', SOUL), { status: 503, message: 'Character ownership is not configured' });
    assert.equal(globalThis.__clientArgs.length, 0, 'no client is built');
    assert.equal(queries.length, 0);
  }
  // Through the route the request budget reads the same configuration and
  // refuses first; either way the provider is not called.
  configure();
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await submit({ prompt: 'a lighthouse', soul_id: SOUL });
  assert.equal(response.code, 503);
  assert.equal(queries.length, 0);
  assert.equal(providerCalls.length, 0);
});

test('the check prefers SUPABASE_SECRET_KEY and falls back to the legacy names', async () => {
  configure();
  assert.equal(await assertOwnedSoulId('user-a', SOUL), 'row-1');
  assert.deepEqual(globalThis.__clientArgs[0].slice(0, 2), ['https://project.example', 'fixture-secret-key']);
  configure();
  delete process.env.SUPABASE_SECRET_KEY;
  assert.equal(await assertOwnedSoulId('user-a', SOUL), 'row-1');
  assert.equal(globalThis.__clientArgs[0][1], 'fixture-legacy-key');
  configure();
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_KEY = 'fixture-older-key';
  assert.equal(await assertOwnedSoulId('user-a', SOUL), 'row-1');
  assert.equal(globalThis.__clientArgs[0][1], 'fixture-older-key');
});

test('a malformed soul_id answers 400 without a lookup or provider call', async () => {
  for (const soul_id of ['../other', 'a'.repeat(129), 'soul id', { id: SOUL }, ['x']]) {
    configure();
    const response = await submit({ prompt: 'a lighthouse', soul_id });
    assert.equal(response.code, 400, JSON.stringify(soul_id));
    assert.equal(queries.length, 0);
    assert.equal(providerCalls.length, 0);
  }
});

test('a request without soul_id is unchanged', async () => {
  for (const soul_id of [undefined, '', null]) {
    configure();
    const response = await submit({ prompt: 'a lighthouse', soul_id });
    assert.equal(response.code, 202, JSON.stringify(response.body));
    assert.equal(queries.length, 0);
    assert.equal(providerCalls.length, 1);
    assert.equal('custom_reference_id' in providerCalls[0].body.params, false);
  }
});

test('text-to-image checks the soul before calling the provider', () => {
  const source = readFileSync(join(root, 'api/higgsfield/text-to-image.js'), 'utf8');
  const issuer = source.indexOf('jobTokenIssuer(');
  const check = source.indexOf('assertOwnedSoulId(');
  const firstFetch = source.indexOf('fetch(');
  assert.ok(issuer > 0 && check > issuer, 'the soul check follows the job token issuer check');
  assert.ok(firstFetch > check, 'assertOwnedSoulId( must come before the first fetch(');
});
