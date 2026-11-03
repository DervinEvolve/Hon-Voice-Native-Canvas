import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fetchApprovedAsset, approvedAssetList, uploadedMediaData, MAX_ASSET_BYTES } from '../api/_lib/asset-source.js';
const old={...process.env};after(()=>{process.env=old;});
test('server asset paths reject local files, private URLs, unapproved hosts, redirects and active content before upload/export',async()=>{
 process.env.HON_MEDIA_DOWNLOAD_HOSTS='cdn.example';delete process.env.SUPABASE_URL;delete process.env.VITE_SUPABASE_URL;
 let calls=0;const fake=async(url,options)=>{calls++;assert.equal(url,'https://cdn.example/a.mp4');assert.equal(options.redirect,'error');assert(options.signal);return new Response('fixture',{headers:{'Content-Type':'video/mp4'}});};
 for(const value of ['/etc/passwd','file:///etc/passwd','http://cdn.example/a','https://127.0.0.1/a','https://cdn.example.attacker.test/a','https://user:pass@cdn.example/a']) await assert.rejects(fetchApprovedAsset(value,fake));
 assert.equal(calls,0);
 const response=await fetchApprovedAsset('https://cdn.example/a.mp4',fake);assert.equal(await response.text(),'fixture');assert.equal(calls,1);
 await assert.rejects(fetchApprovedAsset('https://cdn.example/a.mp4',async()=>new Response('<script/>',{headers:{'Content-Type':'text/html'}})),/Unsupported/);
 await assert.rejects(fetchApprovedAsset('https://cdn.example/a.mp4',async()=>new Response('x',{headers:{'Content-Type':'video/mp4','Content-Length':String(MAX_ASSET_BYTES+1)}})),/too large/);
 await assert.rejects(fetchApprovedAsset('https://cdn.example/a.mp4',async()=>{throw Error('redirect rejected');}),/redirect rejected/);
});
test('uploads accept bounded media data only and export names cannot escape a ZIP directory',()=>{
 for(const value of ['/etc/passwd','https://cdn.example/a','data:text/html;base64,PHNjcmlwdD4=','data:image/png;base64,%%%']) assert.throws(()=>uploadedMediaData(value));
 assert.equal(uploadedMediaData('data:image/png;base64,ZmFrZQ=='),'data:image/png;base64,ZmFrZQ==');
 assert.throws(()=>uploadedMediaData('data:image/png;base64,'+'A'.repeat(28*1024*1024)));
 const result=approvedAssetList([{url:'https://cdn.example/a.mp4',name:'../../private\\x'}]);assert(!result[0].name.includes('/'));assert(!result[0].name.includes('\\'));assert(!result[0].name.startsWith('.'));
 assert.throws(()=>approvedAssetList(Array(9).fill('https://cdn.example/a')));
});
