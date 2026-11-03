import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/utils/apiRequest.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {authenticatedApiFetch,isOAuthPopupMessage,allowedOAuthDestination}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));

test('proof is attached only to the app API, never external auth/media requests, non-API paths, or URL credentials',async()=>{
 const calls=[];let tokens=0;
 const fetch=authenticatedApiFetch(async(...args)=>{calls.push(args);return new Response('fixture');},async()=>{tokens++;return {Authorization:'Bearer fixture-user-proof'};},'https://canvas.example/project/one');
 for(const url of ['https://api.hume.ai/token','https://auth.privy.io/api/session','https://media.example/video.mp4','https://canvas.example.attacker.test/api/tool','/assets/model.glb','/apiary/tool','api/tool','https://user:pass@canvas.example/api/tool']) await fetch(url);
 assert.equal(tokens,0);for(const [,init] of calls)assert.equal(init,undefined);
 await fetch('/api/hume/generate-token',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 assert.equal(tokens,1);const [,init]=calls.at(-1);assert.equal(init.headers.get('Authorization'),'Bearer fixture-user-proof');assert.equal(init.headers.get('content-type'),'application/json');assert.equal(init.method,'POST');assert.equal(init.body,'{}');assert.equal(init.redirect,'error');
});

test('request bodies, headers, abort signals and SSE responses pass through without buffering or duplicate requests',async()=>{
 let count=0;const controller=new AbortController();const response=new Response('data: fixture\n\n',{headers:{'content-type':'text/event-stream'}});
 const input=new Request('https://canvas.example/api/game/generate-stream',{method:'POST',body:'fixture-body',headers:{'x-fixture':'yes'},signal:controller.signal});
 const fetch=authenticatedApiFetch(async(req,init)=>{count++;assert.equal(req,input);assert.equal(init.headers.get('x-fixture'),'yes');assert.equal(init.signal,controller.signal);return response;},async()=>({Authorization:'Bearer fixture'}),'https://canvas.example');
 const actual=await fetch(input,{signal:controller.signal});assert.equal(actual,response);assert.equal(count,1);assert.equal(await input.text(),'fixture-body');assert.equal(await actual.text(),'data: fixture\n\n');
});

test('explicit authorization is preserved and missing proof fails before an API request is sent',async()=>{
 let sent=0;const fetch=authenticatedApiFetch(async(_,init)=>{sent++;assert.equal(init.headers.get('Authorization'),'Bearer explicit');return new Response();},async()=>{throw Error('No sign-in');},'https://canvas.example');
 await fetch('/api/tool',{headers:{Authorization:'Bearer explicit'}});assert.equal(sent,1);
 await assert.rejects(fetch('/api/tool'),/No sign-in/);assert.equal(sent,1);
});

test('OAuth messages require the expected popup and origin, and navigation accepts only the expected provider auth endpoint',()=>{
 const popup={};assert(isOAuthPopupMessage({source:popup,origin:'https://canvas.example'},popup,'https://canvas.example'));
 assert(!isOAuthPopupMessage({source:{},origin:'https://canvas.example'},popup,'https://canvas.example'));
 assert(!isOAuthPopupMessage({source:popup,origin:'null'},popup,'https://canvas.example'));
 assert(!isOAuthPopupMessage({source:null,origin:'https://canvas.example'},null,'https://canvas.example'));
 assert.equal(allowedOAuthDestination('https://accounts.google.com/o/oauth2/v2/auth?state=fixture','/api/google/auth').hostname,'accounts.google.com');
 for(const raw of [undefined,'http://accounts.google.com/o/oauth2/v2/auth','https://accounts.google.com.attacker.test/o/oauth2/v2/auth','https://user:pass@accounts.google.com/o/oauth2/v2/auth','https://accounts.google.com:8443/o/oauth2/v2/auth','https://accounts.google.com/other','https://api.notion.com/v1/oauth/authorize']) assert.throws(()=>allowedOAuthDestination(raw,'/api/google/auth'));
});
