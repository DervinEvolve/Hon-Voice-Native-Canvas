import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { generateKeyPair, exportSPKI, SignJWT } from 'jose';

// The real proxy and handlers run with SDK/network responses replaced. Nothing
// is sent to a provider, database, OAuth account, or paid model.
const root=resolve(import.meta.dirname,'..');
const build=mkdtempSync(join(tmpdir(),'hon-api-test-'));
cpSync(join(root,'api'),join(build,'api'),{recursive:true});
cpSync(join(root,'proxy.js'),join(build,'proxy.js'));
writeFileSync(join(build,'package.json'),'{"type":"module"}');
for(const [name,source] of [
 ['@supabase/supabase-js','export function createClient(...args){return globalThis.__apiClient(...args);}'],
 ['@vercel/functions','export function next(){return new Response(null,{headers:{"x-middleware-next":"1"}});}'],
]){
 const path=join(build,'node_modules',name);mkdirSync(path,{recursive:true});
 writeFileSync(join(path,'package.json'),'{"type":"module","exports":"./index.js"}');writeFileSync(join(path,'index.js'),source);
}
symlinkSync(join(root,'node_modules/jose'),join(build,'node_modules/jose'));
const load=path=>import(pathToFileURL(join(build,path)).href);
const proxy=(await load('proxy.js')).default;
const security=await load('api/_lib/oauth-state.js');
const access=await load('api/_lib/api-access.js');
const env={...process.env};const savedFetch=globalThis.fetch;
after(()=>{process.env=env;globalThis.fetch=savedFetch;delete globalThis.__apiClient;rmSync(build,{recursive:true,force:true});});
const owner='fixture-owner';
const token=['eyJhbGciOiJub25lIn0',Buffer.from(JSON.stringify({sub:owner})).toString('base64url'),'fixture'].join('.');
function configure(){
 process.env.NODE_ENV='test';delete process.env.VERCEL_ENV;
 process.env.SUPABASE_URL='https://storage.example';process.env.SUPABASE_PUBLISHABLE_KEY='fixture-public-key';
 process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-server-key';process.env.HON_API_MUTATIONS_PER_HOUR='60';
 process.env.HON_API_ALLOWED_USER_IDS=owner;process.env.HON_APP_ORIGIN='https://canvas.example';
 process.env.HON_OAUTH_STATE_SECRET='fixture-only-'+ 'x'.repeat(48);
 process.env.GOOGLE_CLIENT_ID='fixture-client';process.env.GOOGLE_CLIENT_SECRET='fixture-secret';
 process.env.GOOGLE_REDIRECT_URI='https://canvas.example/api/google/callback';
 process.env.NOTION_CLIENT_ID='fixture-client';process.env.NOTION_CLIENT_SECRET='fixture-secret';
 process.env.NOTION_MCP_REDIRECT_URI='https://canvas.example/api/notion/mcp-callback';
 globalThis.__apiClient=(url,key,options)=>{
  assert.equal(url,'https://storage.example');assert(['fixture-public-key','fixture-server-key'].includes(key));assert.equal(options.auth.persistSession,false);
  return {async rpc(name,args){assert.equal(key,'fixture-server-key');assert.equal(name,'claim_hon_api_request');assert(['read:'+owner,'write:'+owner,'paid:'+owner].includes(args.p_actor_id));return {data:true,error:null};},auth:{async getUser(value){return {data:value===token?{user:{id:owner}}:null,error:value!==token};}}};
 };
 globalThis.fetch=async()=>{throw Error('Unexpected provider/network call');};
}
const res=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;},end(body){this.body=body;return this;}});
const request=(path,headers={},method='GET')=>new Request('https://canvas.example'+path,{method,headers});
const nodeRequest=(method='POST',headers={authorization:`Bearer ${token}`,origin:'https://canvas.example'},query={})=>({method,headers,query});
const cookiePair=value=>value.split(';')[0];
function endpoints(dir,prefix=''){
 return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?endpoints(join(dir,e.name),prefix+e.name+'/'):e.name.endsWith('.js')?['/api/'+prefix+e.name.slice(0,-3)]:[]);
}

test('every API source path, including token minting and webhooks, rejects anonymous requests before SDK or network work',async()=>{
 configure();let called=0;globalThis.__apiClient=()=>{called++;throw Error('Must not create an anonymous client');};
 const paths=endpoints(join(root,'api')).filter(p=>!p.startsWith('/api/_lib/'));
 assert(paths.length>100);
 for(const path of paths){const response=await proxy(request(path));assert.equal(response.status,path.endsWith('/callback') || path.endsWith('/mcp-callback') ? 400 : 401,path);assert.equal(response.headers.get('x-middleware-next'),null);assert.equal(response.headers.get('cache-control'),'no-store');}
 assert.equal(called,0);
 const config=JSON.parse(readFileSync(join(root,'vercel.json'),'utf8'));
 assert.deepEqual(config.proxy,{entrypoint:'proxy.js',matcher:['/api/:path*']});
 assert.equal((await load('proxy.js')).config.matcher,undefined,'Vercel permits the matcher in only one configuration location');
 assert.equal(config.routes,undefined,'Legacy routes must not bypass the shared routing layer');
 assert.deepEqual(config.rewrites,[{source:'/((?!api(?:/|$)).*)',destination:'/index.html'}]);
});

test('the gateway checks provider proof, allowlist, configuration and browser origin without service-role authority',async()=>{
 configure();delete process.env.SUPABASE_SECRET_KEY;delete process.env.SUPABASE_SERVICE_ROLE_KEY;delete process.env.SUPABASE_SERVICE_KEY;
 let response=await proxy(request('/api/hume/generate-token',{authorization:`Bearer ${token}`,origin:'https://canvas.example'},'POST'));
 assert.equal(response.headers.get('x-middleware-next'),'1');
 response=await proxy(request('/api/flux/generate',{authorization:'Bearer forged','x-user-id':owner},'POST'));assert.equal(response.status,401);
 response=await proxy(request('/api/flux/generate',{authorization:`Bearer ${token}`,origin:'null'},'POST'));assert.equal(response.status,403);
 process.env.HON_API_ALLOWED_USER_IDS='another-user';response=await proxy(request('/api/flux/generate',{authorization:`Bearer ${token}`}));assert.equal(response.status,403);
 delete process.env.HON_API_ALLOWED_USER_IDS;response=await proxy(request('/api/flux/generate',{authorization:`Bearer ${token}`}));assert.equal(response.status,503);
 configure();delete process.env.SUPABASE_PUBLISHABLE_KEY;delete process.env.SUPABASE_ANON_KEY;delete process.env.VITE_SUPABASE_ANON_KEY;
 response=await proxy(request('/api/flux/generate',{authorization:`Bearer ${token}`}));assert.equal(response.status,503);
 configure();globalThis.__apiClient=()=>{throw Error('Auth lookup unavailable');};
 response=await proxy(request('/api/flux/generate',{authorization:`Bearer ${token}`}));assert.equal(response.status,503);
});

test('Privy access is verified cryptographically with issuer, audience, subject, and expiry checks',async()=>{
 configure();const {publicKey,privateKey}=await generateKeyPair('ES256');
 process.env.PRIVY_APP_ID='fixture-privy-app';process.env.PRIVY_VERIFICATION_KEY=await exportSPKI(publicKey);
 const actor='did:privy:fixture_actor';process.env.HON_API_ALLOWED_USER_IDS=actor;
 globalThis.__apiClient=()=>{throw Error('Privy proof must not fall back to Supabase');};
 const sign=claims=>new SignJWT({iss:'privy.io',aud:'fixture-privy-app',sub:actor,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,...claims}).setProtectedHeader({alg:'ES256'}).sign(privateKey);
 let response=await proxy(request('/api/hume/generate-token',{authorization:`Bearer ${await sign({})}`},'POST'));assert.equal(response.headers.get('x-middleware-next'),'1');
 for(const claims of [{aud:'wrong-app'},{exp:Math.floor(Date.now()/1000)-60},{sub:'not-a-privy-subject'}]){
  response=await proxy(request('/api/hume/generate-token',{authorization:`Bearer ${await sign(claims)}`},'POST'));assert.equal(response.status,401);
 }
 const good=await sign({});response=await proxy(request('/api/hume/generate-token',{authorization:`Bearer ${good.slice(0,-8)}AAAAAAAA`},'POST'));assert.equal(response.status,401);
});

test('OAuth starts need verified POST requests and create signed, short-lived state with fixed callback URLs',async()=>{
 configure();
 for(const [path,provider] of [['google/auth','google'],['notion/mcp-auth','notion']]){
  const handler=(await load('api/'+path+'.js')).default;
  let response=res();await handler(nodeRequest('GET'),response);assert.equal(response.code,405);
  response=res();await handler(nodeRequest('POST',{}),response);assert.equal(response.code,401);
  response=res();await handler(nodeRequest(),response);assert.equal(response.code,200);
  const url=new URL(response.body.url);assert.equal(url.searchParams.get('redirect_uri'),provider==='google'?process.env.GOOGLE_REDIRECT_URI:process.env.NOTION_MCP_REDIRECT_URI);
  assert(!response.body.url.includes(token));assert.match(response.headers['Set-Cookie'],/HttpOnly; SameSite=Lax/);assert.match(response.headers['Set-Cookie'],/Max-Age=600/);
  const proof=security.readOAuthState({headers:{cookie:cookiePair(response.headers['Set-Cookie'])},query:{state:url.searchParams.get('state')}},provider);
  assert.equal(proof.actor,owner);
 }
 process.env.NODE_ENV='production';const response=res();security.beginOAuthState(response,'google',owner);
 assert.match(response.headers['Set-Cookie'],/^__Host-/);assert.match(response.headers['Set-Cookie'],/; Secure/);assert(!response.headers['Set-Cookie'].includes('Domain='));
 delete process.env.GOOGLE_REDIRECT_URI;assert.throws(()=>security.beginOAuthState(res(),'google',owner),/explicit OAuth/);
});

test('OAuth callbacks reject forged, missing, expired, duplicate and cross-provider state before token exchange',async()=>{
 configure();let fetched=0;globalThis.fetch=async()=>{fetched++;throw Error('Must not exchange invalid proof');};
 const output=res();const proof=security.beginOAuthState(output,'google',owner);const cookie=cookiePair(output.headers['Set-Cookie']);
 const callback=(await load('api/google/callback.js')).default;
 for(const req of [
  nodeRequest('GET',{}, {code:'fixture-code',state:proof.nonce}),
  nodeRequest('GET',{cookie}, {code:'fixture-code',state:'x'.repeat(43)}),
  nodeRequest('GET',{cookie:cookie.slice(0,-1)+'!'}, {code:'fixture-code',state:proof.nonce}),
  nodeRequest('GET',{cookie:cookie+'; '+cookie}, {code:'fixture-code',state:proof.nonce}),
  nodeRequest('GET',{cookie}, {code:'fixture-code',state:[proof.nonce,proof.nonce]}),
 ]){const response=res();await callback(req,response);assert.equal(response.code,400);}
 assert.throws(()=>security.readOAuthState({headers:{cookie},query:{state:proof.nonce}},'google',Date.now()+601000));
 assert.throws(()=>security.readOAuthState({headers:{cookie},query:{state:proof.nonce}},'notion'));
 process.env.HON_API_ALLOWED_USER_IDS='revoked-owner';assert.throws(()=>security.readOAuthState({headers:{cookie},query:{state:proof.nonce}},'google'));
 assert.equal(fetched,0);
 configure();const response=await proxy(request('/api/google/callback?state='+proof.nonce+'&state='+proof.nonce,{cookie}));assert.equal(response.status,400);
});

test('verified callbacks clear state and sign actor-bound provider cookies',async()=>{
 configure();
 for(const [provider,path,kind] of [['google','google/callback','google-connected'],['notion','notion/mcp-callback','notion-mcp-connected']]){
  const output=res();const proof=security.beginOAuthState(output,provider,owner);const cookie=cookiePair(output.headers['Set-Cookie']);
  let calls=0;globalThis.fetch=async(url,options)=>{
   calls++;assert.equal(options.redirect,'error');assert(options.signal);assert.equal(new URL(url).hostname,provider==='google'?'oauth2.googleapis.com':'api.notion.com');
   return Response.json({access_token:'fixture-provider-access',refresh_token:'fixture-refresh',expires_in:3600,workspace_name:'</script><script>untrusted()</script>'});
  };
  const response=res();await (await load('api/'+path+'.js')).default(nodeRequest('GET',{cookie},{state:proof.nonce,code:'fixture-code'}),response);
  assert.equal(response.code,200);assert.equal(calls,1);assert(response.body.includes(kind));assert(!response.body.includes('</script><script>untrusted'));
  assert(response.body.includes('"https://canvas.example"'));assert(!response.body.includes(',"*"'));
  let delivered;const script=response.body.match(/<script>([\s\S]*?)<\/script>/)[1];runInNewContext(script,{window:{opener:{postMessage(payload,origin){delivered={payload,origin};}},close(){}}});assert.equal(delivered.origin,'https://canvas.example');if(provider==='notion')assert.equal(delivered.payload.workspace,'</script><script>untrusted()</script>');
  assert(Array.isArray(response.headers['Set-Cookie']));assert.match(response.headers['Set-Cookie'][0],/Max-Age=0/);
  if(provider==='notion') {
   const session=res();await (await load('api/notion/session.js')).default(nodeRequest('GET',{cookie:cookiePair(response.headers['Set-Cookie'][1]),authorization:`Bearer ${token}`}),session);
   assert.equal(session.code,200);assert.equal(session.body.mcp,true);assert.equal(session.body.access_token,undefined);
  }
  const providerCookie=cookiePair(response.headers['Set-Cookie'][1]);
  const value=security.readProviderTokens({headers:{cookie:providerCookie,authorization:`Bearer ${token}`}},provider==='google'?'gd_tokens':'notion_mcp_tokens');
  assert.equal(value.access_token,'fixture-provider-access');
  const cleared=cookiePair(response.headers['Set-Cookie'][0]);assert.throws(()=>security.readOAuthState({headers:{cookie:cleared},query:{state:proof.nonce}},provider));
 }
});

test('provider cookies require a valid signature, correct user context, expiry, and independently verified API proof',async()=>{
 configure();const cookie=cookiePair(security.providerTokenCookie('gd_tokens',{access_token:'fixture-provider-access'},owner));
 assert.equal(security.readProviderTokens({headers:{cookie,authorization:`Bearer ${token}`}},'gd_tokens').access_token,'fixture-provider-access');
 const other=['eyJhbGciOiJub25lIn0',Buffer.from(JSON.stringify({sub:'other-owner'})).toString('base64url'),'fixture'].join('.');
 for(const headers of [{cookie},{cookie:cookie.slice(0,-1)+'!',authorization:`Bearer ${token}`},{cookie:cookie+'; '+cookie,authorization:`Bearer ${token}`},{cookie,authorization:`Bearer ${other}`}]) assert.equal(security.readProviderTokens({headers},'gd_tokens'),null);
 assert.equal(security.readProviderTokens({headers:{cookie,authorization:`Bearer ${token}`}},'notion_tokens'),null);
 assert.equal(security.readProviderTokens({headers:{cookie,authorization:`Bearer ${token}`}},'gd_tokens',Date.now()+604801000),null);
 assert.equal(security.readProviderTokens({headers:{cookie:'gd_tokens='+Buffer.from('{"access_token":"legacy"}').toString('base64'),authorization:`Bearer ${token}`}},'gd_tokens'),null);
 let response=await proxy(request('/api/google/upload',{cookie,authorization:'Bearer forged'},'POST'));assert.equal(response.status,401);
 const session=(await load('api/google/session.js')).default;
 const output=res();await session(nodeRequest('GET',{cookie,authorization:`Bearer ${token}`}),output);assert.equal(output.code,200);
});

test('internal forwarding ignores caller-controlled hosts and forwards only bearer proof to the configured API origin',()=>{
 configure();process.env.HON_INTERNAL_API_ORIGIN='https://canvas.example';
 const call=access.ownedApiCall({headers:{authorization:`Bearer ${token}`,host:'attacker.example',origin:'https://attacker.example',cookie:'private-provider-cookie'}},'/api/game/repair');
 assert.equal(call.url,'https://canvas.example/api/game/repair');assert.equal(call.options.headers.Authorization,`Bearer ${token}`);assert.equal(call.options.redirect,'error');assert.equal(call.options.headers.Cookie,undefined);
 for(const path of ['https://attacker.example/api/x','//attacker.example/api/x','/api/../private','/api/a?target=x']) assert.throws(()=>access.ownedApiCall({headers:{authorization:`Bearer ${token}`}},path));
 process.env.HON_INTERNAL_API_ORIGIN='http://remote.example';assert.throws(()=>access.ownedApiCall({headers:{authorization:`Bearer ${token}`}},'/api/game/repair'));
});


test('every function entrypoint has its own guard, and a direct token handler rejects anonymous calls without routing middleware',async()=>{
 configure();let count=0;
 for(const route of endpoints(join(root,'api')).filter(p=>!p.startsWith('/api/_lib/'))){
  const file=join(root,route.slice(1)+'.js');const source=readFileSync(file,'utf8');
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const assignment=ast.statements.find(n=>ts.isExportAssignment(n));
  if(!assignment){assert(!ast.statements.some(n=>ts.isFunctionDeclaration(n)&&n.modifiers?.some(m=>m.kind===ts.SyntaxKind.DefaultKeyword)),file);continue;}
  assert(ts.isCallExpression(assignment.expression),file);
  assert.equal(assignment.expression.expression.getText(ast),'withApiAccess',file);
  assert.equal(assignment.expression.arguments[1].text,route,file);count++;
 }
 assert(count>100);
 const handler=(await load('api/hume/generate-token.js')).default;
 const response=res();await handler(nodeRequest('GET',{}),response);assert.equal(response.code,401);
});


test('the shared budget is service-only, bounded, and denies exhaustion or ledger failures before dispatch', async()=>{
 configure(); let calls=0;
 const factory=(url,key,options)=>{calls++;assert.equal(url,'https://storage.example');assert.equal(key,'fixture-server-key');return {rpc:async(name,args)=>{assert.equal(name,'claim_hon_api_request');assert.deepEqual(args,{p_actor_id:'write:'+owner,p_limit:60});return {data:false,error:null};}};};
 let response=res();assert.equal(await access.consumeApiBudget(nodeRequest(),response,owner,factory),false);assert.equal(response.code,429);assert.equal(response.headers['Retry-After'],'3600');assert.equal(calls,1);
 response=res();assert.equal(await access.consumeApiBudget(nodeRequest('OPTIONS'),response,owner,()=>{throw Error('Preflight must not consume budget');}),true);
 for(const value of ['0','-1','1.5','10001','unbounded']){process.env.HON_API_MUTATIONS_PER_HOUR=value;response=res();assert.equal(await access.consumeApiBudget(nodeRequest(),response,owner,factory),false);assert.equal(response.code,503);}
 configure();response=res();assert.equal(await access.consumeApiBudget(nodeRequest(),response,owner,()=>({rpc:async()=>({data:null,error:{message:'fixture-private-error'}})})),false);assert.equal(response.code,503);assert(!JSON.stringify(response.body).includes('fixture-private-error'));
 delete process.env.SUPABASE_SERVICE_ROLE_KEY;response=res();assert.equal(await access.consumeApiBudget(nodeRequest(),response,owner,factory),false);assert.equal(response.code,503);
});

test('speech uses a server-only key, bounds input and returns audio without disclosing provider errors',async()=>{
 configure();process.env.ELEVENLABS_API_KEY='fixture-only-voice-key';let calls=0;
 const handler=(await load('api/elevenlabs/tts.js')).default;
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'https://api.elevenlabs.io/v1/text-to-speech/fixture_voice');assert.equal(options.headers['xi-api-key'],'fixture-only-voice-key');assert.equal(options.redirect,'error');return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'audio/mpeg'}});};
 let response=res();await handler({...nodeRequest(),body:{text:'hello',voiceId:'../wrong'}},response);assert.equal(response.code,400);assert.equal(calls,0);
 response=res();await handler({...nodeRequest(),body:{text:'x'.repeat(5001),voiceId:'fixture_voice'}},response);assert.equal(response.code,400);assert.equal(calls,0);
 response=res();await handler({...nodeRequest(),body:{text:'hello',voiceId:'fixture_voice'}},response);assert.equal(response.code,200);assert.deepEqual([...response.body],[1,2,3]);assert.equal(response.headers['Content-Type'],'audio/mpeg');
 globalThis.fetch=async()=>new Response('fixture-private-provider-error',{status:401});response=res();await handler({...nodeRequest(),body:{text:'hello',voiceId:'fixture_voice'}},response);assert.equal(response.code,502);assert(!JSON.stringify(response.body).includes('fixture-private'));
});
