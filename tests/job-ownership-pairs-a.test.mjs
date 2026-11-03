import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

// Import the real submit and read-back handlers with only their SDKs replaced.
// No provider, database or network is contacted.
const root = resolve(import.meta.dirname, '..');
const build = mkdtempSync(join(tmpdir(), 'hon-job-pairs-a-'));
cpSync(join(root, 'api'), join(build, 'api'), { recursive: true });
writeFileSync(join(build, 'package.json'), '{"type":"module"}');
function stubPackage(name, source) {
  const dir = join(build, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"type":"module","exports":"./index.js"}');
  writeFileSync(join(dir, 'index.js'), source);
}
stubPackage('@supabase/supabase-js', 'export function createClient() { return globalThis.__apiClient; }');
stubPackage('@fal-ai/client', `const call = name => (...args) => globalThis.__fal[name](...args);
export const fal = {
  config() {},
  queue: { submit: call('submit'), status: call('status'), result: call('result'), subscribeToStatus: call('subscribe') },
  subscribe: call('subscribe'),
  run: call('run'),
  storage: { upload: call('upload') },
};`);
symlinkSync(join(root, 'node_modules/jose'), join(build, 'node_modules/jose'));

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const originalConsole = { log: console.log, warn: console.warn, error: console.error };
// The routes log every provider step; keep the test report readable.
for (const level of Object.keys(originalConsole)) console[level] = () => {};
after(() => {
  process.env = originalEnv;
  globalThis.fetch = originalFetch;
  Object.assign(console, originalConsole);
  delete globalThis.__apiClient;
  delete globalThis.__fal;
  rmSync(build, { recursive: true, force: true });
});
const load = path => import(pathToFileURL(join(build, path)).href);
const { jobTokenIssuer } = await load('api/_lib/job-ownership.js');

const RAW = '0b7f6c1e-1d2a-4c55-9a51-3f3f0c9d1a22';
const RESULT_URL = `https://queue.fal.run/fal-ai/test/requests/${RAW}`;
const VIDEO = 'https://cdn.example/out.mp4';
const IMAGE = 'https://cdn.example/out.png';
const AUDIO = 'https://cdn.example/out.wav';
const OUTPUT = { video: { url: VIDEO }, images: [{ url: IMAGE }], audio: [{ url: AUDIO }], text: 'transcript text', model_urls: { glb: { url: 'https://cdn.example/out.glb' } } };
const SECRET = 'fixture-only-job-secret-' + 'x'.repeat(24);
const USERS = { 'test-session-a': 'user-a', 'test-session-b': 'user-b' };

function configure({ secret = SECRET } = {}) {
  process.env.HON_API_ALLOWED_USER_IDS = 'user-a,user-b';
  delete process.env.HON_JOB_ID_SECRET;
  if (secret) process.env.HON_OAUTH_STATE_SECRET = secret;
  else delete process.env.HON_OAUTH_STATE_SECRET;
  process.env.FAL_KEY = 'fixture-fal-key';
  process.env.FAL_API_KEY = 'fixture-fal-key';
  delete process.env.OPENAI_API_KEY;
  delete process.env.SORA_USE_OPENAI;
  process.env.SUPABASE_URL = 'https://project.example';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'fixture-public-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-server-key';
  process.env.HON_API_READS_PER_HOUR = '600';
  process.env.HON_API_MUTATIONS_PER_HOUR = '60';
  process.env.HON_API_PAID_JOBS_PER_HOUR = '50';
  globalThis.__apiClient = {
    rpc: async () => ({ data: true, error: null }),
    auth: { getUser: async token => USERS[token] ? { data: { user: { id: USERS[token] } }, error: null } : { data: null, error: { status: 401 } } },
  };
}

// Every provider SDK call and fetch is recorded; only the result URL the
// mocked status hands back may be fetched.
let calls;
function mockProvider() {
  calls = [];
  const record = (kind, reply) => async (...args) => { calls.push({ kind, args }); return reply(...args); };
  globalThis.__fal = {
    submit: record('submit', () => ({ request_id: RAW })),
    status: record('status', () => ({ status: 'COMPLETED', request_id: RAW, response_url: RESULT_URL, logs: [] })),
    result: record('result', () => ({ data: OUTPUT, requestId: RAW })),
    subscribe: record('subscribe', () => { throw new Error('Unexpected synchronous provider call'); }),
    run: record('run', () => { throw new Error('Unexpected synchronous provider call'); }),
    upload: record('upload', () => 'https://storage.example/audio.webm'),
  };
  globalThis.fetch = async (url, options) => {
    calls.push({ kind: 'fetch', args: [String(url), options] });
    if (String(url) === RESULT_URL) return new Response(JSON.stringify(OUTPUT), { headers: { 'Content-Type': 'application/json' } });
    throw new Error('Unexpected network call');
  };
}

function res() {
  return {
    code: 200, body: null, headers: {}, chunks: [], ended: false,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; this.ended = true; return this; },
    write(chunk) { this.chunks.push(chunk); return true; },
    end() { this.ended = true; return this; },
  };
}
function request(method, session, { body = {}, query = {}, upload } = {}) {
  const req = upload ? Readable.from([Buffer.from(upload)]) : { on() {} };
  return Object.assign(req, { method, headers: { authorization: `Bearer ${session}` }, body, query });
}
async function call(route, req) {
  const handler = (await load(`api/${route}.js`)).default;
  const response = res();
  await handler(req, response);
  // Event-stream routes finish after the handler returns.
  for (let i = 0; i < 100 && !response.ended; i++) await new Promise(r => setImmediate(r));
  return response;
}
const issue = (actor, family) => jobTokenIssuer(actor, family)(RAW);
const events = response => response.chunks.map(chunk => JSON.parse(String(chunk).replace(/^data: /, '')));

// Each family: the submit routes that start a job, the field their token is
// returned in, and the routes that read the job back.
const pairs = [
  {
    family: 'fal/lucy-edit',
    submits: [{ route: 'fal/lucy-edit', field: 'id', code: 200, body: { video_url: 'https://cdn.example/in.mp4', prompt: 'make it rain' } }],
    readBacks: [{ route: 'fal/lucy-edit-status', param: 'requestId', check: r => assert.deepEqual(r.body.output, [VIDEO]) }],
  },
  {
    family: 'fal/meshy',
    submits: [{ route: 'fal/meshy-text-to-3d', field: 'requestId', code: 200, body: { prompt: 'a brass microscope' } }],
    readBacks: [
      { route: 'fal/meshy-status', param: 'requestId', check: r => assert.equal(r.body.status.status, 'COMPLETED') },
      { route: 'fal/meshy-result', param: 'requestId', check: r => assert.deepEqual(r.body.result.data, OUTPUT) },
    ],
  },
  {
    family: 'fal/seedream',
    submits: [{ route: 'fal/seedream-generate', field: 'request_id', code: 202, body: { prompt: 'a reading lamp' } }],
    readBacks: [{ route: 'fal/seedream-status', param: 'requestId', check: r => assert.deepEqual(r.body, { status: 'COMPLETED', result: OUTPUT }) }],
  },
  {
    family: 'seedance',
    submits: [
      { route: 'seedance/text-to-video', field: 'request_id', code: 202, body: { prompt: 'a slow pan' } },
      { route: 'seedance/image-to-video', field: 'request_id', code: 202, body: { prompt: 'a slow pan', image_url: 'https://cdn.example/in.png' } },
    ],
    readBacks: ['text-to-video', 'image-to-video'].map(model_type => ({
      route: 'seedance/status', param: 'request_id', query: { model_type }, endpoint: `fal-ai/bytedance/seedance/v1/lite/${model_type}`,
      check: r => assert.deepEqual(r.body, { status: 'COMPLETED', video_url: VIDEO, seed: undefined, request_id: issue('user-a', 'seedance') }),
    })),
  },
  {
    family: 'sora2',
    submits: [
      { route: 'sora2/text-to-video', field: 'request_id', code: 202, body: { prompt: 'a slow pan' } },
      { route: 'sora2/image-to-video', field: 'request_id', code: 202, body: { prompt: 'a slow pan', image_url: 'https://cdn.example/in.png' } },
    ],
    readBacks: ['text-to-video', 'image-to-video'].map(model_type => ({
      route: 'sora2/status', param: 'request_id', query: { model_type }, endpoint: `fal-ai/sora-2/${model_type}/pro`,
      check: r => assert.deepEqual(r.body, { status: 'COMPLETED', result: { data: OUTPUT, requestId: RAW }, request_id: issue('user-a', 'sora2') }),
    })),
  },
  {
    family: 'veo3/video',
    submits: [{ route: 'veo3/text-to-video', field: 'request_id', code: 202, body: { prompt: 'a slow pan' } }],
    readBacks: [{ route: 'veo3/status', param: 'requestId', endpoint: 'fal-ai/veo3/fast', check: r => assert.deepEqual(r.body, { status: 'COMPLETED', result: OUTPUT }) }],
  },
  {
    family: 'veo3/image',
    submits: [{ route: 'veo3/image-to-video', field: 'request_id', code: 202, body: { prompt: 'a slow pan', image_url: 'https://cdn.example/in.png' } }],
    readBacks: [{ route: 'veo3/image-status', param: 'requestId', endpoint: 'fal-ai/veo3/image-to-video', check: r => assert.deepEqual(r.body, { status: 'COMPLETED', result: OUTPUT }) }],
  },
  {
    family: 'wan/video',
    submits: [{ route: 'wan/text-to-video', field: 'request_id', code: 202, body: { prompt: 'a slow pan' } }],
    readBacks: [{ route: 'wan/status', param: 'requestId', endpoint: 'fal-ai/wan-25-preview/text-to-video', check: r => assert.deepEqual(r.body, { status: 'COMPLETED', result: OUTPUT }) }],
  },
  {
    family: 'wan/image',
    submits: [{ route: 'wan/text-to-image', field: 'request_id', code: 202, body: { prompt: 'a reading lamp' } }],
    readBacks: [{ route: 'wan/image-status', param: 'requestId', endpoint: 'fal-ai/wan-25-preview/text-to-image', check: r => assert.deepEqual(r.body, { status: 'COMPLETED', result: OUTPUT }) }],
  },
  {
    family: 'vidu/video',
    submits: [{ route: 'vidu/text-to-video', field: 'request_id', code: 202, body: { prompt: 'a slow pan' } }],
    readBacks: [{ route: 'vidu/status', param: 'requestId', endpoint: 'fal-ai/vidu/q1/text-to-video', check: r => assert.deepEqual(r.body, { status: 'COMPLETED', result: OUTPUT }) }],
  },
  {
    family: 'vidu/image',
    submits: [{ route: 'vidu/image-to-video', field: 'request_id', code: 202, body: { prompt: 'a slow pan', image_url: 'https://cdn.example/in.png' } }],
    readBacks: [{ route: 'vidu/image-status', param: 'requestId', endpoint: 'fal-ai/vidu/q1/image-to-video', check: r => assert.deepEqual(r.body, { status: 'COMPLETED', video_url: VIDEO, result: OUTPUT }) }],
  },
  {
    family: 'sfx',
    submits: [{ route: 'sfx/submit', field: 'request_id', code: 202, body: { video_url: 'https://cdn.example/in.mp4' } }],
    readBacks: [{ route: 'sfx/status', param: 'requestId', endpoint: 'mirelo-ai/sfx-v1/video-to-video', check: r => assert.deepEqual(r.body, { status: 'COMPLETED', result: OUTPUT }) }],
  },
  {
    family: 'stt',
    submits: [{ route: 'stt/submit', field: 'request_id', code: 202, upload: 'fixture audio bytes' }],
    readBacks: [
      { route: 'stt/status', param: 'request_id', endpoint: 'fal-ai/speech-to-text/turbo/stream', check: r => assert.deepEqual(r.body, { status: 'COMPLETED', transcript: OUTPUT.text, request_id: issue('user-a', 'stt') }) },
      { route: 'stt/sse', param: 'request_id', endpoint: 'fal-ai/speech-to-text/turbo/stream', check: r => {
        assert.equal(r.headers['Content-Type'], 'text/event-stream; charset=utf-8');
        assert.deepEqual(events(r), [{ status: 'COMPLETED', transcript: OUTPUT.text }]);
      } },
    ],
  },
];

for (const pair of pairs) {
  test(`${pair.family}: submit returns an owner token and stops before the provider without a signing secret`, async () => {
    for (const submit of pair.submits) {
      configure();
      mockProvider();
      let response = await call(submit.route, request('POST', 'test-session-a', submit));
      assert.equal(response.code, submit.code, submit.route);
      assert.match(response.body[submit.field], new RegExp(`^${RAW}\\.[A-Za-z0-9_-]{32}$`), submit.route);
      assert.equal(response.body[submit.field], issue('user-a', pair.family), submit.route);
      assert.equal(calls.filter(c => c.kind === 'submit').length, 1, submit.route);

      configure({ secret: null });
      mockProvider();
      response = await call(submit.route, request('POST', 'test-session-a', submit));
      assert.equal(response.code, 503, submit.route);
      assert.deepEqual(calls, [], `${submit.route} must not reach the provider`);
    }
  });

  test(`${pair.family}: read-back refuses bare, other-user and other-family IDs before the provider`, async () => {
    configure();
    const refused = { bare: RAW, 'other user': issue('user-b', pair.family), 'other family': issue('user-a', 'other') };
    for (const readBack of pair.readBacks) {
      for (const [kind, id] of Object.entries(refused)) {
        mockProvider();
        const response = await call(readBack.route, request('GET', 'test-session-a', { query: { ...readBack.query, [readBack.param]: id } }));
        assert.equal(response.code, 404, `${readBack.route} ${kind}`);
        assert.deepEqual(response.body, { error: 'Job not found' }, `${readBack.route} ${kind}`);
        assert.deepEqual(calls, [], `${readBack.route} ${kind} must not reach the provider`);
      }
    }
  });

  test(`${pair.family}: read-back looks up the owner's job by its raw provider ID`, async () => {
    configure();
    for (const readBack of pair.readBacks) {
      mockProvider();
      const response = await call(readBack.route, request('GET', 'test-session-a', { query: { ...readBack.query, [readBack.param]: issue('user-a', pair.family) } }));
      assert.equal(response.code, 200, readBack.route);
      const lookups = calls.filter(c => c.kind !== 'fetch');
      assert.ok(lookups.length > 0, readBack.route);
      for (const lookup of lookups) {
        assert.ok(['status', 'result'].includes(lookup.kind), readBack.route);
        assert.equal(lookup.args[1].requestId, RAW, readBack.route);
        if (readBack.endpoint) assert.equal(lookup.args[0], readBack.endpoint, readBack.route);
      }
      for (const fetched of calls.filter(c => c.kind === 'fetch')) assert.equal(fetched.args[0], RESULT_URL, readBack.route);
      readBack.check(response);
    }
  });
}

const firstProviderCall = source => Math.min(...['fal.', 'fetch('].map(s => source.indexOf(s)).filter(i => i >= 0));

test('group A routes check job ownership before their first provider call', () => {
  for (const pair of pairs) {
    for (const { route } of pair.submits) {
      const source = readFileSync(join(root, `api/${route}.js`), 'utf8');
      const check = source.indexOf('jobTokenIssuer(');
      assert.ok(check > 0 && check < firstProviderCall(source), route);
    }
    for (const { route } of pair.readBacks) {
      const source = readFileSync(join(root, `api/${route}.js`), 'utf8');
      const check = source.indexOf('ownedProviderId(');
      assert.ok(check > 0 && check < firstProviderCall(source), route);
      assert.doesNotMatch(source, /readJobToken\(/, `${route} must not fall back to a raw ID`);
    }
  }
  // The mux route works on result URLs the client already holds; it reads
  // no job back, so it has nothing to scope.
  assert.doesNotMatch(readFileSync(join(root, 'api/sfx/mux.js'), 'utf8'), /request_?id/i);
});
