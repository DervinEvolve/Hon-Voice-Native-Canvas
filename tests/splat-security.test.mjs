import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Import the real handlers with only their external SDK replaced. No provider,
// database, GPU, migration, or real conversion command is contacted.
const root = resolve(import.meta.dirname, '..');
const build = mkdtempSync(join(tmpdir(), 'hon-splat-test-'));
cpSync(join(root, 'api'), join(build, 'api'), { recursive: true });
writeFileSync(join(build, 'package.json'), '{"type":"module"}');
const sdk = join(build, 'node_modules/@supabase/supabase-js');
mkdirSync(sdk, { recursive: true });
writeFileSync(join(sdk, 'package.json'), '{"type":"module","exports":"./index.js"}');
writeFileSync(join(sdk, 'index.js'), 'export function createClient() { return globalThis.__splatClient; }');
const cli = join(build, 'node_modules/@playcanvas/splat-transform/bin');
mkdirSync(cli, { recursive: true });
writeFileSync(join(cli, 'cli.mjs'), '// Not executed by these authorization/input tests.');
symlinkSync(join(root, 'node_modules/jose'), join(build, 'node_modules/jose'));
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
after(() => { process.env = originalEnv; globalThis.fetch = originalFetch; delete globalThis.__splatClient; rmSync(build, { recursive: true, force: true }); });
const load = path => import(pathToFileURL(join(build, path)).href);
const security = await load('api/_lib/splat-security.js');
const owner = 'owner-test-id';
const id = 'sharp_00000000-0000-4000-8000-000000000000';
function res() { return { code: 200, body: null, headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(c) { this.code=c; return this; }, json(b) { this.body=b; return this; } }; }
function configure() {
  process.env.HON_API_READS_PER_HOUR = '600';
  process.env.SUPABASE_URL = 'https://storage.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-server-key';
  process.env.HON_SPLAT_ALLOWED_USER_IDS = owner;
  process.env.HON_API_ALLOWED_USER_IDS = owner;
  process.env.SUPABASE_PUBLISHABLE_KEY = 'fixture-public-key';
  process.env.HON_ALLOW_PUBLIC_LOD_OUTPUT = 'true';
  process.env.HON_SPLAT_IMAGE_HOSTS = 'images.example';
  globalThis.__splatClient = { rpc: async () => ({data:true,error:null}), auth: { getUser: async token => ({ data: token === 'test-session' ? { user: { id: owner } } : null, error: token !== 'test-session' }) } };
}
const request = (method, body={}, query={}) => ({ method, headers: { authorization: 'Bearer test-session' }, body, query });

test('all four real handlers reject anonymous callers before SDK or network work', async () => {
  globalThis.fetch = async () => { throw new Error('Unexpected network work'); };
  globalThis.__splatClient = undefined;
  for (const [path, method] of [['sharp/submit','POST'],['sharp/status','GET'],['sharp/result','GET'],['splat/process-lod','POST']]) {
    const handler = (await load(`api/${path}.js`)).default;
    const response = res();
    await handler({ method, headers: {}, body: {}, query: {} }, response);
    assert.equal(response.code,401,path);
    assert.equal(response.headers['Cache-Control'],'no-store');
  }
});

test('server verifies tokens, rejects unconfigured use, and enforces its user allowlist', async () => {
  configure();
  const verify = security.authorizeSplatRequest;
  const create = () => globalThis.__splatClient;
  assert.equal((await verify(request('POST'),res(),create)).userId,owner);
  let response = res();
  await verify({headers:{authorization:'Bearer forged'}},response,create);
  assert.equal(response.code,401);
  process.env.HON_SPLAT_ALLOWED_USER_IDS = 'somebody-else';
  response=res();await verify(request('POST'),response,create);assert.equal(response.code,403);
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_KEY;
  process.env.VITE_SUPABASE_ANON_KEY='test-public-key';
  response=res();await verify(request('POST'),response,create);assert.equal(response.code,503);
});

test('scene injection, traversal, and malformed request ids are rejected', async () => {
  configure();
  const handler=(await load('api/splat/process-lod.js')).default;
  for (const sceneId of ['x";id;#','../../other','x/y','x\\y','a'.repeat(65),null]) {
    const response=res();
    await handler(request('POST',{fileUrl:'https://storage.example/storage/v1/object/public/hon-assets/a.ply',sceneId}),response);
    assert.equal(response.code,400,String(sceneId));
  }
  assert.equal(security.validSceneId('scene_123-abc'),true);
  assert.equal(security.validJobId(id),true);
  assert.equal(security.validJobId(['legacy-job']),false);
  for (const url of [
    'https://attacker.example/storage/v1/object/public/hon-assets/a.ply',
    'https://storage.example/storage/v1/object/public/hon-assets/%252e%252e/private.ply',
    'https://storage.example/storage/v1/object/public/hon-assets/x%2fy.ply',
    'https://storage.example/storage/v1/object/public/hon-assets/a.ply?token=test',
  ]) assert.throws(() => security.allowedLodSource(url,'https://storage.example'));
  assert.equal(security.allowedLodSource('https://storage.example/storage/v1/object/public/hon-assets/owner/scene.ply','https://storage.example').hostname,'storage.example');
});

test('downloads reject redirects and bound declared and streamed response size', async () => {
  let options;
  assert.equal((await security.boundedDownload('https://storage.example/a',5,async (_,o)=>{options=o;return new Response('123');})).length,3);
  assert.equal(options.redirect,'error');
  await assert.rejects(security.boundedDownload('https://storage.example/a',2,async()=>new Response('123')),/too large/);
  await assert.rejects(security.boundedDownload('https://storage.example/a',2,async()=>new Response('1',{headers:{'Content-Length':'3'}})),/too large/);
  configure();
  for(const url of ['http://images.example/a','https://images.example.attacker.test/a','https://user:pass@images.example/a','https://127.0.0.1/a']) assert.throws(()=>security.allowedImageUrl(url,'https://storage.example'));
  assert.equal(security.allowedImageUrl('https://images.example/a','https://storage.example'),'https://images.example/a');
});

test('job reads constrain the verified owner and sign only that owner private path', async () => {
  configure();
  const filters=[];
  let signed;
  const client=globalThis.__splatClient;
  client.from=()=>({ select(){return this;},eq(k,v){filters.push([k,v]);return this;},async single(){return {data:{status:'completed',storage_path:`${owner}/${id}/output.ply`,filename:'output.ply',size_bytes:5,created_at:new Date().toISOString()}};} });
  client.storage={ async getBucket(){return {data:{public:false}};},from(bucket){assert.equal(bucket,'hon-private-splats');return {async createSignedUrl(path,ttl){signed={path,ttl};return {data:{signedUrl:'https://storage.example/signed-result'}};}};} };
  let response=res();
  await (await load('api/sharp/status.js')).default(request('GET',{}, {request_id:id}),response);
  assert.equal(response.code,200);
  assert.deepEqual(filters.slice(-2),[['id',id],['owner_id',owner]]);
  response=res();
  await (await load('api/sharp/result.js')).default(request('GET',{}, {request_id:id}),response);
  assert.equal(response.code,200);
  assert.deepEqual(signed,{path:`${owner}/${id}/output.ply`,ttl:300});
  assert.deepEqual(filters.slice(-2),[['id',id],['owner_id',owner]]);
  client.storage.getBucket=async()=>({data:{public:true}});
  response=res();await (await load('api/sharp/result.js')).default(request('GET',{}, {request_id:id}),response);
  assert.equal(response.code,500);
});

test('submission uses the verified owner, dedicated proxy credentials, and private storage', async () => {
  configure();
  process.env.MODAL_SHARP_ENDPOINT='https://test-worker.modal.run';
  process.env.MODAL_SHARP_PROXY_KEY='test-only-proxy-key';
  process.env.MODAL_SHARP_PROXY_SECRET='test-only-proxy-secret';
  const client=globalThis.__splatClient;
  let inserted,updated,upload;
  const filters=[];
  client.from=()=>({async insert(row){inserted=row;return {};},update(row){updated=row;return this;},eq(k,v){filters.push([k,v]);return this;} });
  client.storage={async getBucket(){return {data:{public:false}};},from(bucket){assert.equal(bucket,'hon-private-splats');return {async upload(path,buffer,options){upload={path,buffer,options};return {};}};} };
  globalThis.fetch=async(url,options)=>{
    assert.equal(String(url),'https://test-worker.modal.run/');
    assert.equal(options.redirect,'error');
    assert.equal(options.headers['Modal-Key'],'test-only-proxy-key');
    assert.equal(options.headers['Modal-Secret'],'test-only-proxy-secret');
    assert.equal(options.headers.Authorization,undefined);
    return new Response(JSON.stringify({ply_data:Buffer.from('ply\nformat ascii 1.0\nend_header\n').toString('base64')}));
  };
  const response=res();
  await (await load('api/sharp/submit.js')).default(request('POST',{imageUrl:'https://images.example/image.png',owner_id:'attacker-supplied-id'}),response);
  assert.equal(response.code,200);
  assert.equal(inserted.owner_id,owner);
  assert.equal(security.validJobId(inserted.id),true);
  assert.equal(updated.status,'completed');
  assert.equal(updated.ply_url,undefined);
  assert.equal(upload.path,`${owner}/${inserted.id}/output.ply`);
  assert.equal(upload.options.upsert,false);
  assert.deepEqual(filters.slice(-2),[['id',inserted.id],['owner_id',owner]]);
});

test('Privy users keep their sign-in, with signature, audience, issuer, and expiry verification', async () => {
  const { generateKeyPair, exportSPKI, SignJWT } = await import('jose');
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  process.env.PRIVY_APP_ID='test-privy-app';
  process.env.PRIVY_VERIFICATION_KEY=await exportSPKI(publicKey);
  configure();
  const actor='did:privy:test_actor';
  process.env.HON_SPLAT_ALLOWED_USER_IDS=actor;
  let supabaseCalls=0;
  globalThis.__splatClient.auth.getUser=async()=>{supabaseCalls++;throw new Error('Not a Supabase session');};
  const sign = async overrides => new SignJWT({ sub:actor, iss:'privy.io', aud:'test-privy-app', iat:Math.floor(Date.now()/1000), exp:Math.floor(Date.now()/1000)+300, ...overrides })
    .setProtectedHeader({alg:'ES256'}).sign(privateKey);
  const verify=async token=>{
    const response=res();
    const context=await security.authorizeSplatRequest({headers:{authorization:`Bearer ${token}`}},response,()=>globalThis.__splatClient);
    return {response,context};
  };
  let result=await verify(await sign({}));
  assert.match(result.context.userId,/^privy_[0-9a-f]{64}$/);
  for(const claims of [{aud:'other-app'},{exp:Math.floor(Date.now()/1000)-60},{sub:'../../other-owner'}]) {
    result=await verify(await sign(claims));assert.equal(result.response.code,401);assert.equal(result.context,null);
  }
  const token=await sign({});
  result=await verify(token.slice(0,-8)+'AAAAAAAA');assert.equal(result.response.code,401);
  assert.equal(supabaseCalls,0);
});

test('media downloads require verified, separately allowlisted users before network access', async () => {
  configure();
  const handler=(await load('api/download-image.js')).default;
  let fetched=0;
  globalThis.fetch=async()=>{fetched++;throw new Error('Unexpected network work');};
  let response=res();
  await handler({method:'GET',headers:{},query:{url:'https://images.example/file.mp4'}},response);
  assert.equal(response.code,401);
  delete process.env.HON_MEDIA_ALLOWED_USER_IDS;
  response=res();await handler(request('GET',{}, {url:'https://images.example/file.mp4'}),response);
  assert.equal(response.code,503);
  process.env.HON_MEDIA_ALLOWED_USER_IDS='another-owner';
  response=res();await handler(request('GET',{}, {url:'https://images.example/file.mp4'}),response);
  assert.equal(response.code,403);
  assert.equal(fetched,0);
});

test('media proxy validates exact HTTPS hosts and rejects private, malformed, and active-content targets', async () => {
  configure();
  process.env.HON_MEDIA_DOWNLOAD_HOSTS='images.example,127.0.0.1';
  const media=await load('api/_lib/media-download.js');
  for (const url of [undefined, ['https://images.example/a'], 'http://images.example/a', 'https://images.example.evil.test/a', 'https://user:pass@images.example/a', 'https://images.example:8443/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://storage.example/auth/v1/admin', 'https://images.example/a#fragment']) {
    assert.throws(()=>media.allowedMediaUrl(url),String(url));
  }
  assert.equal(media.allowedMediaUrl('https://storage.example/storage/v1/object/public/media/a.png'),'https://storage.example/storage/v1/object/public/media/a.png');
  for (const type of ['text/html','image/svg+xml','application/javascript']) {
    await assert.rejects(media.downloadMedia('https://images.example/a',async()=>new Response('content',{headers:{'content-type':type}})),/Unsupported/);
  }
  await assert.rejects(media.downloadMedia('https://images.example/a',async()=>new Response('x',{headers:{'content-type':'image/png','content-length':String(media.MAX_MEDIA_BYTES+1)}})),/too large/);
});

test('verified media downloads preserve MP4 output without following redirects or exposing URLs in errors', async () => {
  configure();
  process.env.HON_MEDIA_ALLOWED_USER_IDS=owner;
  process.env.HON_MEDIA_DOWNLOAD_HOSTS='images.example';
  const handler=(await load('api/download-image.js')).default;
  globalThis.fetch=async(url,options)=>{
    assert.equal(url,'https://images.example/video.mp4');assert.equal(options.redirect,'error');
    return new Response('mp4-fixture',{headers:{'content-type':'video/mp4'}});
  };
  const response=res();response.send=function(body){this.body=body;return this;};
  await handler(request('GET',{}, {url:'https://images.example/video.mp4'}),response);
  assert.equal(response.code,200);assert.equal(response.headers['Content-Type'],'video/mp4');
  assert.equal(response.headers['Content-Disposition'],'attachment');assert.equal(response.headers['X-Content-Type-Options'],'nosniff');
  assert.equal(response.body.toString(),'mp4-fixture');
  assert.equal(response.headers['Access-Control-Allow-Origin'],undefined);
});
