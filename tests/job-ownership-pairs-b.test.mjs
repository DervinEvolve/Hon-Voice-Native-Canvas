import assert from 'node:assert/strict';
import { test, after, mock } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Import the real group B handlers with only their SDKs replaced. Every
// provider call, fal or HTTP, goes through provider() below, which answers
// only the exact calls a test expects. No provider, database or network is
// contacted, so nothing here can start a paid job.
const root = resolve(import.meta.dirname, '..');
const build = mkdtempSync(join(tmpdir(), 'hon-job-pairs-b-'));
cpSync(join(root, 'api'), join(build, 'api'), { recursive: true });
writeFileSync(join(build, 'package.json'), '{"type":"module"}');
function stubPackage(name, source) {
  const dir = join(build, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"type":"module","exports":"./index.js"}');
  writeFileSync(join(dir, 'index.js'), source);
}
stubPackage('@supabase/supabase-js', 'export function createClient() { return globalThis.__apiClient; }');
stubPackage('@fal-ai/client', `export const fal = {
  config() {},
  queue: {
    submit: (...a) => globalThis.__fal.submit(...a),
    status: (...a) => globalThis.__fal.status(...a),
    result: (...a) => globalThis.__fal.result(...a),
  },
  subscribe: (...a) => globalThis.__fal.subscribe(...a),
  run: (...a) => globalThis.__fal.run(...a),
};`);
symlinkSync(join(root, 'node_modules/jose'), join(build, 'node_modules/jose'));

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const originalConsole = { log: console.log, error: console.error, warn: console.warn };
// The routes log every provider reply; keep the test report readable.
console.log = console.error = console.warn = () => {};
after(() => {
  process.env = originalEnv;
  globalThis.fetch = originalFetch;
  Object.assign(console, originalConsole);
  delete globalThis.__apiClient;
  delete globalThis.__fal;
  rmSync(build, { recursive: true, force: true });
});

const load = path => import(pathToFileURL(join(build, path)).href);
const jobs = await load('api/_lib/job-ownership.js');
function res() { return { code: 200, body: null, headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(c) { this.code=c; return this; }, json(b) { this.body=b; return this; } }; }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let calls = [];
let answer = () => undefined;
function provider(kind, target, args) {
  calls.push({ kind, target, args });
  const reply = answer(kind, target, args);
  if (reply === undefined) throw new Error(`Unexpected provider call: ${kind} ${target}`);
  return reply;
}
globalThis.__fal = Object.fromEntries(['submit', 'status', 'result', 'subscribe', 'run']
  .map(name => [name, async (endpoint, options) => provider(`fal.${name}`, endpoint, options)]));

function configure(reply = () => undefined) {
  Object.assign(process.env, {
    HON_API_ALLOWED_USER_IDS: 'user-a,user-b',
    HON_OAUTH_STATE_SECRET: 'fixture-only-job-signing-' + 'x'.repeat(32),
    HON_API_READS_PER_HOUR: '600',
    HON_API_MUTATIONS_PER_HOUR: '600',
    HON_API_PAID_JOBS_PER_HOUR: '100',
    SUPABASE_URL: 'https://project.example',
    SUPABASE_PUBLISHABLE_KEY: 'fixture-public-key',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-server-key',
    FAL_API_KEY: 'fixture-fal-key',
    HIGGSFIELD_API_KEY: 'fixture-higgsfield-key',
    HIGGSFIELD_SECRET: 'fixture-higgsfield-secret',
    REPLICATE_API_TOKEN: 'fixture-replicate-key',
    LUMAAI_API_KEY: 'fixture-luma-key',
    RUNWAY_API_KEY: 'fixture-runway-key',
  });
  delete process.env.HON_JOB_ID_SECRET;
  const users = { 'test-session-a': 'user-a', 'test-session-b': 'user-b' };
  globalThis.__apiClient = {
    rpc: async () => ({ data: true, error: null }),
    auth: { getUser: async token => users[token] ? { data: { user: { id: users[token] } }, error: null } : { data: null, error: { status: 401 } } },
  };
  globalThis.fetch = async (url, init) => provider('fetch', String(url), init);
  calls = [];
  answer = reply;
}

async function call(route, { method = 'GET', body = {}, query = {}, session = 'test-session-a' } = {}) {
  const handler = (await load(`api/${route}.js`)).default;
  const response = res();
  await handler({ method, headers: { authorization: `Bearer ${session}` }, body, query }, response);
  return response;
}

// Runs a route that sleeps between provider polls, advancing its timers.
async function callWithTimers(route, options) {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let done = false;
    const pending = call(route, options).finally(() => { done = true; });
    while (!done) {
      await new Promise(resolve => setImmediate(resolve));
      mock.timers.tick(5000);
    }
    return await pending;
  } finally {
    mock.timers.reset();
  }
}

const RAW = '0b7f6c1e-1d2a-4c55-9a51-3f3f0c9d1a22';
const TOKEN = /^([A-Za-z0-9_-]{1,128})\.([A-Za-z0-9_-]{32})$/;
const tokenFor = (actor, family, id = RAW) => jobs.jobTokenIssuer(actor, family)(id);
const VIDEO_URL = 'https://cdn.example/out.mp4';
const RESULT_URL = `https://queue.fal.run/fixture/requests/${RAW}`;

// A pair is one family: its submit routes and the route that reads the job
// back. Each reply() answers only the exact provider call the route should
// make and returns undefined for anything else.
const pairs = [];

// fal queue pairs share one shape: submit returns request_id, status checks
// the queue with the raw ID and fetches response_url once the job completes.
function falSubmit(route, body, endpoint) {
  return {
    route, body, field: 'request_id', status: 202,
    reply: (kind, target) => kind === 'fal.submit' && target === endpoint ? { request_id: RAW } : undefined,
  };
}
function falRead(route, endpoint) {
  return {
    route, query: token => ({ requestId: token }),
    reply: (kind, target, args) => {
      if (kind === 'fal.status' && target === endpoint && args.requestId === RAW) return { status: 'COMPLETED', response_url: RESULT_URL };
      if (kind === 'fetch' && target === RESULT_URL) return json({ video: { url: VIDEO_URL } });
    },
    check: body => { assert.equal(body.status, 'COMPLETED'); assert.equal(body.result.video.url, VIDEO_URL); },
  };
}

// ---- higgsfield: four submit routes feed one status route.
const higgsfieldSubmit = (route, path, body) => ({
  route: `higgsfield/${route}`, body, field: 'request_id', status: 202,
  reply: (kind, target) => kind === 'fetch' && target === `https://platform.higgsfield.ai/v1/${path}` ? json({ id: RAW }) : undefined,
});
pairs.push({
  family: 'higgsfield',
  submits: [
    higgsfieldSubmit('text-to-image', 'text2image/soul', { prompt: 'a lighthouse at dusk' }),
    higgsfieldSubmit('image-to-video', 'image2video/dop', { image_url: 'https://cdn.example/in.png', motion_id: 'motion-1' }),
    higgsfieldSubmit('create-soul-id', 'characters', { prompt: 'a sailor' }),
    higgsfieldSubmit('speak', 'speak/higgsfield', { params: { input_image: { image_url: 'https://cdn.example/in.png' }, input_audio: { audio_url: 'https://cdn.example/in.mp3' } } }),
  ],
  read: {
    route: 'higgsfield/status', query: token => ({ requestId: token }),
    reply: (kind, target) => kind === 'fetch' && target === `https://platform.higgsfield.ai/v1/job-sets/${RAW}`
      ? json({ jobs: [{ status: 'completed', results: { raw: { url: VIDEO_URL } } }] }) : undefined,
    check: body => { assert.equal(body.status, 'COMPLETED'); assert.equal(body.result.url, VIDEO_URL); },
  },
});

// ---- hunyuan3d: a Replicate prediction. generate.js waits for its result
// and returns no job ID, so it has no read-back pair.
pairs.push({
  family: 'hunyuan3d',
  submits: [{
    route: 'hunyuan3d/submit', body: { inputImageUrl: 'https://cdn.example/in.png' }, field: 'request_id', status: 200,
    reply: (kind, target) => kind === 'fetch' && target === 'https://api.replicate.com/v1/predictions' ? json({ id: RAW }) : undefined,
  }],
  read: {
    route: 'hunyuan3d/status', query: token => ({ request_id: token }),
    reply: (kind, target) => kind === 'fetch' && target === `https://api.replicate.com/v1/predictions/${RAW}`
      ? json({ status: 'succeeded', output: { model_glb: { url: 'https://cdn.example/model.glb' } } }) : undefined,
    check: body => { assert.equal(body.status, 'COMPLETED'); assert.equal(body.modelGlbUrl, 'https://cdn.example/model.glb'); },
  },
});

// ---- kling: three separate pairs on fal queues. image-status reads the
// v2.1 master queue although image-to-video submits to v2.5 turbo pro; the
// test follows the routes as they are.
pairs.push({
  family: 'kling/video',
  submits: [falSubmit('kling/text-to-video', { prompt: 'waves' }, 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video')],
  read: falRead('kling/status', 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video'),
});
pairs.push({
  family: 'kling/image',
  submits: [falSubmit('kling/image-to-video', { prompt: 'waves', image_url: 'https://cdn.example/in.png' }, 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video')],
  read: falRead('kling/image-status', 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video'),
});
pairs.push({
  family: 'kling/pro-image',
  submits: [falSubmit('kling/pro-image-to-video', { image_url: 'https://cdn.example/in.png' }, 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video')],
  read: { ...falRead('kling/pro-image-status', 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video'),
    check: body => { assert.equal(body.status, 'COMPLETED'); assert.equal(body.videoUrl, VIDEO_URL); } },
});

// ---- luma: Dream Machine generations. generate, video-generation and the
// synchronous modify route all hand out IDs that luma/status reads back.
// photon, photon-flash and text-to-video wait for their result through fal
// and expose no ID that a route reads back; generate-scene is not available.
const LUMA = 'https://api.lumalabs.ai/dream-machine/v1/generations';
const lumaGeneration = route => ({
  route, body: { prompt: 'a lantern', operation_type: 'text_to_video' }, field: 'id', status: 200,
  reply: (kind, target, init) => kind === 'fetch' && target === LUMA && init.method === 'POST' ? json({ id: RAW, state: 'queued' }) : undefined,
});
pairs.push({
  family: 'luma/generation',
  submits: [
    lumaGeneration('luma/generate'),
    lumaGeneration('luma/video-generation'),
    {
      route: 'luma/modify', body: { videoUrl: 'https://cdn.example/in.mp4', imageUrl: 'https://cdn.example/in.png' },
      field: 'generationId', status: 200, timers: true,
      reply: (kind, target) => {
        if (kind !== 'fetch') return;
        if (target === `${LUMA}/video/modify`) return json({ id: RAW });
        if (target === `${LUMA}/${RAW}`) return json({ id: RAW, state: 'completed', assets: { video: VIDEO_URL } });
      },
    },
  ],
  read: {
    route: 'luma/status', query: token => ({ id: token }),
    reply: (kind, target) => kind === 'fetch' && target === `${LUMA}/${RAW}` ? json({ id: RAW, state: 'completed', assets: { video: VIDEO_URL } }) : undefined,
    check: (body, token) => { assert.equal(body.id, token, 'the reply echoes the token, not the raw ID'); assert.equal(body.state, 'completed'); assert.equal(body.assets.video, VIDEO_URL); },
  },
});
// No route in this build starts a Luma capture, so capture-status has no
// submit pair and only a token issued here can read one.
pairs.push({
  family: 'luma/capture',
  submits: [],
  read: {
    route: 'luma/capture-status', query: token => ({ slug: token }),
    reply: (kind, target) => kind === 'fetch' && target === `https://api.lumalabs.ai/capture/v1/captures/${RAW}`
      ? json({ capture: { latestRun: { status: 'finished', progress: 100, artifacts: [{ type: 'gaussian-splat', url: 'https://cdn.example/a.splat' }] } } }) : undefined,
    check: body => { assert.equal(body.status, 'finished'); assert.equal(body.splatUrl, 'https://cdn.example/a.splat'); },
  },
});

for (const route of ['luma/generate', 'luma/video-generation']) {
  test(`${route} extends only the user's own earlier generation`, async () => {
    const extend = reference => call(route, { method: 'POST', body: { operation_type: 'extend_video', reference_video_id: reference } });
    configure();
    const refused = [[RAW, 'raw ID'], [tokenFor('user-b', 'luma/generation'), "user-b's token"], [tokenFor('user-a', 'luma/capture'), 'other family']];
    for (const [reference, label] of refused) {
      configure();
      const response = await extend(reference);
      assert.equal(response.code, 404, label);
      assert.equal(calls.length, 0, `${label}: the provider must not be called`);
    }
    configure((kind, target, init) => kind === 'fetch' && target === LUMA ? json({ id: 'b2c3d4e5-0000-4000-8000-000000000001', state: 'queued' }) : undefined);
    const response = await extend(tokenFor('user-a', 'luma/generation'));
    assert.equal(response.code, 200, JSON.stringify(response.body));
    assert.equal(JSON.parse(calls[0].args.body).keyframes.frame0.id, RAW);
  });
}

// ---- marey: text-to-video is queued; image-to-video waits for its result
// and returns no job ID.
pairs.push({
  family: 'marey',
  submits: [falSubmit('marey/text-to-video', { prompt: 'a valley at dawn' }, 'moonvalley/marey/t2v')],
  read: falRead('marey/status', 'moonvalley/marey/t2v'),
});

// ---- minimax: three separate pairs on fal queues.
pairs.push({
  family: 'minimax/video',
  submits: [falSubmit('minimax/text-to-video', { prompt: 'rain on a window' }, 'fal-ai/minimax/hailuo-02/pro/text-to-video')],
  read: falRead('minimax/status', 'fal-ai/minimax/hailuo-02/pro/text-to-video'),
});
pairs.push({
  family: 'minimax/image',
  submits: [falSubmit('minimax/image', { prompt: 'rain on a window', image_url: 'https://cdn.example/in.png' }, 'fal-ai/minimax/hailuo-02/pro/image-to-video')],
  read: falRead('minimax/image-status', 'fal-ai/minimax/hailuo-02/pro/image-to-video'),
});
const MINIMAX_CHARACTER = 'fal-ai/minimax/video-01-subject-reference';
pairs.push({
  family: 'minimax/character',
  submits: [falSubmit('minimax/character-reference', { prompt: 'a walk', referenceImageUrl: 'https://cdn.example/face.png' }, MINIMAX_CHARACTER)],
  read: {
    route: 'minimax/character-status', query: token => ({ requestId: token }),
    reply: (kind, target, args) => {
      if (target !== MINIMAX_CHARACTER || args.requestId !== RAW) return;
      if (kind === 'fal.status') return { status: 'COMPLETED' };
      if (kind === 'fal.result') return { data: { video: { url: VIDEO_URL } } };
    },
    check: body => { assert.equal(body.status, 'COMPLETED'); assert.equal(body.videoUrl, VIDEO_URL); },
  },
});

// ---- runway: three submit routes feed one task status route.
const runwaySubmit = (route, path, body, status) => ({
  route: `runway/${route}`, body, field: 'id', status,
  reply: (kind, target) => kind === 'fetch' && target === `https://api.dev.runwayml.com/v1/${path}` ? json({ id: RAW }) : undefined,
});
pairs.push({
  family: 'runway',
  submits: [
    runwaySubmit('generate-image', 'text_to_image', { promptText: 'a harbor at night' }, 202),
    runwaySubmit('image-to-video', 'image_to_video', { promptImage: 'https://cdn.example/in.png' }, 200),
    runwaySubmit('video-to-video', 'video_to_video', { inputVideoUrl: 'https://cdn.example/in.mp4' }, 200),
  ],
  read: {
    route: 'runway/status', query: token => ({ taskId: token }),
    reply: (kind, target) => kind === 'fetch' && target === `https://api.dev.runwayml.com/v1/tasks/${RAW}`
      ? json({ status: 'SUCCEEDED', output: [VIDEO_URL] }) : undefined,
    check: (body, token) => { assert.equal(body.id, token); assert.equal(body.status, 'completed'); assert.deepEqual(body.output, [VIDEO_URL]); },
  },
});

// ---- tests
for (const pair of pairs) {
  for (const submit of pair.submits) {
    const run = options => (submit.timers ? callWithTimers : call)(submit.route, options);

    test(`${submit.route} returns an owner token for the ${pair.family} family`, async () => {
      configure(submit.reply);
      const response = await run({ method: 'POST', body: submit.body });
      assert.equal(response.code, submit.status, JSON.stringify(response.body));
      const match = TOKEN.exec(response.body[submit.field]);
      assert.ok(match, `${submit.field} must be a job token`);
      assert.equal(match[1], RAW);
      assert.equal(jobs.readJobToken('user-a', pair.family, response.body[submit.field]), RAW);
      assert.equal(calls.filter(c => c.kind !== 'fetch' || c.args?.method === 'POST').length, 1, 'one provider submit');
    });

    test(`${submit.route} refuses to start a job without a signing secret`, async () => {
      configure(submit.reply);
      delete process.env.HON_OAUTH_STATE_SECRET;
      const response = await run({ method: 'POST', body: submit.body });
      assert.equal(response.code, 503);
      assert.equal(calls.length, 0);
    });
  }

  const { read } = pair;
  const expectNotFound = async (token, label) => {
    configure(read.reply);
    const response = await call(read.route, { query: read.query(token) });
    assert.equal(response.code, 404, label);
    assert.deepEqual(response.body, { error: 'Job not found' });
    assert.equal(calls.length, 0, `${label}: the provider must not be called`);
  };

  test(`${read.route} answers 404 for a raw provider ID`, async () => {
    await expectNotFound(RAW, 'raw provider ID');
  });

  test(`${read.route} answers 404 for another user's token`, async () => {
    configure();
    await expectNotFound(tokenFor('user-b', pair.family), "user-b's token");
  });

  test(`${read.route} answers 404 for a token of another family`, async () => {
    configure();
    await expectNotFound(tokenFor('user-a', 'other'), 'other family');
  });

  test(`${read.route} reads the owner's job with the raw provider ID`, async () => {
    configure(read.reply);
    const token = tokenFor('user-a', pair.family);
    const response = await call(read.route, { query: read.query(token) });
    assert.equal(response.code, 200, JSON.stringify(response.body));
    assert.ok(calls.length > 0);
    read.check(response.body, token);
  });
}

// Submit routes must check signing, and read-back routes must check the
// owner, before their first provider call.
const PROVIDER_CALL = /\bfetch\(|\bfal\.(queue|subscribe|run)\b/;
const readSource = path => readFileSync(join(root, path), 'utf8');
function assertBefore(path, marker) {
  const source = readSource(path);
  const check = source.indexOf(marker);
  const firstCall = source.search(PROVIDER_CALL);
  assert.ok(check > 0, `${path} must call ${marker}`);
  assert.ok(firstCall > 0, `${path} must call a provider`);
  assert.ok(check < firstCall, `${path}: ${marker} must come before the first provider call`);
}

test('group B routes check job ownership before any provider call', () => {
  for (const pair of pairs) {
    for (const submit of pair.submits) assertBefore(`api/${submit.route}.js`, 'jobTokenIssuer(');
    assertBefore(`api/${pair.read.route}.js`, 'ownedProviderId(');
  }
});

test('the local server checks Luma job ownership before calling Luma', () => {
  const source = readSource('src/server/api.ts');
  const handler = name => source.slice(source.indexOf(`const ${name} = async`), source.indexOf('\n};\n', source.indexOf(`const ${name} = async`)));
  for (const [name, marker] of [['lumaGenerateHandler', 'jobTokenIssuer('], ['lumaStatusHandler', 'ownedProviderId(']]) {
    const body = handler(name);
    assert.ok(body.indexOf(marker) > 0, `${name} must call ${marker}`);
    assert.ok(body.indexOf(marker) < body.search(PROVIDER_CALL), `${name}: ${marker} must come before the first provider call`);
  }
  assert.match(source, /res\.locals\.actor = context\.actor;/);
});
