import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// The poller is TypeScript next to the services that use it; transpile it the
// same way api-request.test.mjs does, so no extra tooling is needed.
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const js = ts.transpileModule(read('src/services/jobPolling.ts'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { pollJob, falQueueVideoUrl } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
// Answers each poll with the next reply and records the URLs it was asked for.
function fakeFetch(replies) {
  const urls = [];
  const fetchImpl = async url => {
    urls.push(url);
    const reply = replies[Math.min(urls.length, replies.length) - 1];
    if (reply instanceof Error) throw reply;
    return typeof reply === 'function' ? reply() : reply;
  };
  return { urls, fetchImpl };
}
const TOKEN = 'abc-123.tag_value-0123456789abcdefghijklmnopqrs';
const fal = { url: '/api/marey/status?requestId=', token: TOKEN, isDone: falQueueVideoUrl, intervalMs: 1, timeoutMs: 2000 };

test('returns the result after the job finishes', async () => {
  const { urls, fetchImpl } = fakeFetch([
    () => json({ status: 'IN_QUEUE' }),
    () => json({ status: 'IN_PROGRESS' }),
    () => json({ status: 'IN_PROGRESS' }),
    () => json({ status: 'COMPLETED', result: { video: { url: 'https://cdn.example/out.mp4' } } }),
  ]);
  assert.equal(await pollJob({ ...fal, fetchImpl }), 'https://cdn.example/out.mp4');
  assert.equal(urls.length, 4);
});

test('a terminal job failure stops at once with the route error text', async () => {
  const { urls, fetchImpl } = fakeFetch([() => json({ status: 'FAILED', error: 'Content was rejected' })]);
  await assert.rejects(pollJob({ ...fal, fetchImpl }), { message: 'Content was rejected' });
  assert.equal(urls.length, 1);

  const completedWithoutVideo = fakeFetch([() => json({ status: 'COMPLETED', result: { detail: 'Prompt too long' } })]);
  await assert.rejects(pollJob({ ...fal, fetchImpl: completedWithoutVideo.fetchImpl }), { message: 'Prompt too long' });
  assert.equal(completedWithoutVideo.urls.length, 1);
});

test('a 404 is never retried and reads as job not found', async () => {
  const { urls, fetchImpl } = fakeFetch([() => json({ error: 'Job not found' }, 404), () => json({ status: 'COMPLETED' })]);
  await assert.rejects(pollJob({ ...fal, fetchImpl }), { message: 'Job not found' });
  assert.equal(urls.length, 1);
});

test('other client errors stop with the route error text', async () => {
  const { urls, fetchImpl } = fakeFetch([() => json({ error: 'Hourly tool request limit reached' }, 429)]);
  await assert.rejects(pollJob({ ...fal, fetchImpl }), { message: 'Hourly tool request limit reached' });
  assert.equal(urls.length, 1);
});

test('a server error or network failure is polled again', async () => {
  const { urls, fetchImpl } = fakeFetch([
    () => json({ error: 'Failed to fetch Marey status' }, 500),
    new Error('network down'),
    () => json({ status: 'COMPLETED', result: { video: { url: 'https://cdn.example/out.mp4' } } }),
  ]);
  assert.equal(await pollJob({ ...fal, fetchImpl }), 'https://cdn.example/out.mp4');
  assert.equal(urls.length, 3);
});

test('times out with a clear error', async () => {
  const { urls, fetchImpl } = fakeFetch([() => json({ status: 'IN_PROGRESS' })]);
  await assert.rejects(pollJob({ ...fal, fetchImpl, intervalMs: 5, timeoutMs: 30 }), { message: /^Job timed out after 0 seconds$/ });
  assert.ok(urls.length >= 1 && urls.length <= 7, `${urls.length} polls`);

  const failing = fakeFetch([() => json({ error: 'Failed to fetch Marey status' }, 500)]);
  await assert.rejects(pollJob({ ...fal, fetchImpl: failing.fetchImpl, intervalMs: 5, timeoutMs: 30 }), { message: /last error: Failed to fetch Marey status/ });
});

test('the token is URL-encoded and otherwise sent unchanged', async () => {
  const { urls, fetchImpl } = fakeFetch([() => json({ status: 'COMPLETED', result: { video: { url: 'https://cdn.example/out.mp4' } } })]);
  await pollJob({ ...fal, token: 'a b&c=d/e?f#g.tag', fetchImpl });
  assert.equal(urls[0], '/api/marey/status?requestId=a%20b%26c%3Dd%2Fe%3Ff%23g.tag');
  const plain = fakeFetch([() => json({ status: 'COMPLETED', result: { video: { url: 'https://cdn.example/out.mp4' } } })]);
  await pollJob({ ...fal, fetchImpl: plain.fetchImpl });
  assert.equal(plain.urls[0], `/api/marey/status?requestId=${TOKEN}`);
});

test('a missing token fails before any request', async () => {
  const { urls, fetchImpl } = fakeFetch([() => json({})]);
  await assert.rejects(pollJob({ ...fal, token: undefined, fetchImpl }), { message: 'The job did not return a token' });
  assert.equal(urls.length, 0);
});

// There is no client test runner, so the three flows are checked at the source:
// each one polls its own status route with the token its submit route returns.
const source = path => read(`src/services/${path}`);
const between = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));

test('Marey polls marey/status with the submit token', () => {
  const video = between(source('videoService.ts'), 'async generateMareyVideo', 'async generateMinimaxVideo');
  assert.match(video, /fetch\('\/api\/marey\/text-to-video'/);
  assert.match(video, /pollJob\(\{ url: '\/api\/marey\/status\?requestId=', token: data\.request_id, isDone: falQueueVideoUrl \}\)/);
  assert.match(video, /return \{ videoUrl \};/);
  const t2v = between(source('textToVideoService.ts'), 'Using secure Marey text-to-video endpoint', 'This should not be reached');
  assert.match(t2v, /pollJob\(\{ url: '\/api\/marey\/status\?requestId=', token: result\.request_id, isDone: falQueueVideoUrl \}\)/);
  assert.doesNotMatch(t2v, /result\.videoUrl/);
});

test('Minimax image-to-video polls minimax/image-status with the submit token', () => {
  const minimax = between(source('videoService.ts'), 'async generateMinimaxVideo', 'async generateFalVeo2Video');
  assert.match(minimax, /fetch\('\/api\/minimax\/image'/);
  assert.match(minimax, /pollJob\(\{ url: '\/api\/minimax\/image-status\?requestId=', token: result\.request_id, isDone: falQueueVideoUrl \}\)/);
  assert.doesNotMatch(minimax, /'submitted'|video_url/);
});

test('Luma image-to-video polls luma/status with the generation token', () => {
  const luma = source('lumaVideoService.ts');
  assert.match(luma, /fetch\('\/api\/luma\/video-generation'/);
  assert.match(luma, /pollJob\(\{ url: '\/api\/luma\/status\?id=', token: result\.id, isDone: lumaVideoUrl \}\)/);
  assert.match(luma, /reply\.state !== 'completed'/);
  assert.match(luma, /reply\.assets\?\.video/);
  assert.doesNotMatch(luma, /result\.videoUrl/);
});

test('the poller encodes the token and the services do not build status URLs by hand', () => {
  assert.match(read('src/services/jobPolling.ts'), /url \+ encodeURIComponent\(token\)/);
  for (const path of ['videoService.ts', 'lumaVideoService.ts']) {
    assert.doesNotMatch(source(path), /\/api\/(marey|luma)\/status\?(requestId|id)=\$\{/, path);
  }
  assert.doesNotMatch(source('videoService.ts'), /minimax\/image-status\?requestId=\$\{/);
});
