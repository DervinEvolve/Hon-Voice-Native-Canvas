import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { consumePaidJobBudget } from '../api/_lib/api-access.js';
import { PAID_GENERATION_ROUTES } from '../api/_lib/paid-routes.js';

const res = () => ({ code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const configure = () => {
  process.env.SUPABASE_URL = 'https://project.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-server-key';
  delete process.env.HON_API_PAID_JOBS_PER_HOUR;
};
const factory = (result, calls) => () => ({ rpc: async (name, args) => { calls.push({ name, args }); return result; } });

test('every listed paid route exists as an API function', () => {
  assert.ok(PAID_GENERATION_ROUTES.size > 50);
  for (const route of PAID_GENERATION_ROUTES) assert.ok(existsSync(new URL(`..${route}.js`, import.meta.url)), route);
});

test('only POSTs to paid generation routes claim a paid job slot', async () => {
  configure();
  const calls = [];
  for (const [method, path] of [['GET', '/api/veo31/text-to-video'], ['POST', '/api/veo31/status'], ['POST', '/api/notion/save'], ['OPTIONS', '/api/sharp/submit']]) {
    assert.equal(await consumePaidJobBudget({ method }, res(), 'user-1', path, factory({ data: true }, calls)), true);
  }
  assert.equal(calls.length, 0);
  assert.equal(await consumePaidJobBudget({ method: 'POST' }, res(), 'user-1', '/api/veo31/text-to-video', factory({ data: true }, calls)), true);
  assert.deepEqual(calls, [{ name: 'claim_hon_api_request', args: { p_actor_id: 'paid:user-1', p_limit: 20 } }]);
});

test('an exhausted paid job budget returns 429 with a clear message', async () => {
  configure();
  process.env.HON_API_PAID_JOBS_PER_HOUR = '5';
  const calls = [];
  const response = res();
  assert.equal(await consumePaidJobBudget({ method: 'POST' }, response, 'user-1', '/api/sharp/submit', factory({ data: false }, calls)), false);
  assert.equal(response.code, 429);
  assert.equal(response.body.code, 'paid_job_limit');
  assert.match(response.body.error, /Hourly limit of 5 paid generation jobs reached/);
  assert.ok(Number(response.headers['Retry-After']) > 0 && Number(response.headers['Retry-After']) <= 3600);
  assert.equal(calls[0].args.p_limit, 5);
});

test('missing configuration or ledger errors deny paid work', async () => {
  for (const setup of [
    () => { delete process.env.SUPABASE_SECRET_KEY; delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.SUPABASE_SERVICE_KEY; },
    () => { process.env.HON_API_PAID_JOBS_PER_HOUR = '0'; },
    () => { process.env.HON_API_PAID_JOBS_PER_HOUR = 'many'; },
  ]) {
    configure(); setup();
    const response = res();
    assert.equal(await consumePaidJobBudget({ method: 'POST' }, response, 'user-1', '/api/flux/generate', factory({ data: true }, [])), false);
    assert.equal(response.code, 503);
  }
  configure();
  const response = res();
  assert.equal(await consumePaidJobBudget({ method: 'POST' }, response, 'user-1', '/api/flux/generate', factory({ error: { message: 'down' } }, [])), false);
  assert.equal(response.code, 503);
});
