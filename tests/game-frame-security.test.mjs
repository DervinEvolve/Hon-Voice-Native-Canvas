import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source=readFileSync(new URL('../src/utils/gameFrameSecurity.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const { readGameFrameMessage, GAME_FRAME_SANDBOX }=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));

test('only the matching opaque game frame can send recognized lifecycle events',()=>{
  const frame={};
  const good={source:frame,origin:'null',data:{type:'hon-game-started',panelId:'panel-a'}};
  assert.equal(readGameFrameMessage(good,frame,'panel-a').type,'hon-game-started');
  for(const event of [
    {...good,source:{}}, {...good,origin:'https://app.example'},
    {...good,data:{type:'hon-game-started',panelId:'panel-b'}},
    {...good,data:{type:'notion-mcp-connected'}}, {...good,data:[]}, {...good,data:null},
  ]) assert.equal(readGameFrameMessage(event,frame,'panel-a'),null);
  assert.equal(readGameFrameMessage(good,null,'panel-a'),null);
  assert(!GAME_FRAME_SANDBOX.split(' ').includes('allow-same-origin'));
  assert(GAME_FRAME_SANDBOX.split(' ').includes('allow-scripts'));
  assert(GAME_FRAME_SANDBOX.split(' ').includes('allow-pointer-lock'));
});

test('generated messages cannot forward arbitrary objects or unbounded log content',()=>{
  const frame={};
  const message=data=>readGameFrameMessage({source:frame,origin:'null',data:{type:'hon-game-error',message:data}},frame);
  assert.equal(message('x'.repeat(10000)).message.length,2000);
  assert.equal(message({toString(){throw Error('Must not execute model object');}}).message,'');
});
