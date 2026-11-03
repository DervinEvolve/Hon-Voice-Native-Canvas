import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Writable } from 'node:stream';
import JSZip from 'jszip';

// Runs the real /api/export/zip handler with the auth wrapper replaced by a
// pass-through and fetch replaced by fixtures. Nothing leaves the process.
const root = resolve(import.meta.dirname, '..');
const build = mkdtempSync(join(tmpdir(), 'hon-export-zip-'));
cpSync(join(root, 'api'), join(build, 'api'), { recursive: true });
writeFileSync(join(build, 'package.json'), '{"type":"module"}');
writeFileSync(join(build, 'api/_lib/api-access.js'), 'export const withApiAccess = (handler) => handler;\n');
symlinkSync(join(root, 'node_modules'), join(build, 'node_modules'));
const env = { ...process.env };
const savedFetch = globalThis.fetch;
after(() => { process.env = env; globalThis.fetch = savedFetch; rmSync(build, { recursive: true, force: true }); });
process.env.HON_MEDIA_DOWNLOAD_HOSTS = 'media.example.com';
const handler = (await import(pathToFileURL(join(build, 'api/export/zip.js')).href)).default;

function response() {
  const chunks = [];
  const res = new Writable({ write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb(); } });
  Object.assign(res, {
    code: 200, headers: {}, headersSent: false, body: undefined,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; this.headersSent = true; this.end(); return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    bytes: () => Buffer.concat(chunks),
  });
  res.once('pipe', () => { res.headersSent = true; });
  return res;
}
const finished = (res) => res.writableFinished ? Promise.resolve() : new Promise((done) => res.once('finish', done));

test('export zip packs approved assets in order with sanitised names', async () => {
  const fixtures = {
    'https://media.example.com/a/cover.png': ['image/png', Buffer.from('png-bytes-'.repeat(50))],
    'https://media.example.com/a/clip.mp4': ['video/mp4', Buffer.from([0, 1, 2, 3, 255])],
  };
  globalThis.fetch = async (url, init) => {
    assert.equal(init.redirect, 'error');
    const [type, body] = fixtures[url];
    return new Response(body, { headers: { 'content-type': type } });
  };
  const res = response();
  await handler({ method: 'POST', body: { zipName: 'my export!', items: [
    { url: 'https://media.example.com/a/cover.png', name: 'cover' },
    { url: 'https://media.example.com/a/clip.mp4', name: '../clip' },
  ] } }, res);
  await finished(res);
  assert.equal(res.code, 200);
  assert.equal(res.headers['content-type'], 'application/zip');
  assert.equal(res.headers['content-disposition'], 'attachment; filename="my-export-.zip"');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  const zip = await JSZip.loadAsync(res.bytes());
  assert.deepEqual(Object.keys(zip.files), ['1-cover.png', '2--clip.mp4']);
  assert.deepEqual(await zip.file('1-cover.png').async('nodebuffer'), fixtures['https://media.example.com/a/cover.png'][1]);
  assert.deepEqual(await zip.file('2--clip.mp4').async('nodebuffer'), fixtures['https://media.example.com/a/clip.mp4'][1]);
});

test('export zip rejects bad input and failed downloads before streaming', async () => {
  globalThis.fetch = async () => { throw Error('fetch must not run'); };
  let res = response();
  await handler({ method: 'GET', body: {} }, res);
  assert.equal(res.code, 405);
  res = response();
  await handler({ method: 'POST', body: { items: ['https://elsewhere.example.org/x.png'] } }, res);
  assert.equal(res.code, 400);
  globalThis.fetch = async () => new Response('<html>', { headers: { 'content-type': 'text/html' } });
  res = response();
  await handler({ method: 'POST', body: { items: ['https://media.example.com/a/page.png'] } }, res);
  assert.equal(res.code, 400);
  assert.equal(res.body.error, 'An export source could not be downloaded safely');
  assert.equal(res.headers['content-type'], undefined);
});
