import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { sceneCodeGenerationEnabled } from '../api/_lib/scene-code.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const res = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('the browser runs model-written scene code only when the build enables it', () => {
  const flag = read('src/config/sceneCodeExecution.ts');
  assert.match(flag, /import\.meta\.env\.VITE_ENABLE_SCENE_CODE_EXECUTION === 'true'/);
  const voice = read('src/services/humeEviService.ts');
  const start = voice.indexOf('private async handlePlayCanvasExecute(');
  const end = voice.indexOf('private async handlePlayCanvasLook(');
  const method = voice.slice(start, end);
  const guard = method.indexOf('if (!SCENE_CODE_EXECUTION_ENABLED)');
  assert.ok(guard > 0);
  assert.ok(guard < method.indexOf('eval('), 'the flag check must come before the first eval');
  assert.equal(voice.slice(0, start).includes('eval('), false);
  assert.equal(voice.slice(end).includes('eval('), false, 'no eval outside handlePlayCanvasExecute');
  const tools = read('src/services/playcanvasMCP/tools/components.ts');
  assert.equal(/new Function\(|\beval\(/.test(tools), false, 'scene script tools compile through compileSceneCode');
  assert.ok(tools.includes('compileSceneCode('));
});

test('the server generates scene code only when the operator enables it', () => {
  delete process.env.HON_ENABLE_SCENE_CODE_EXECUTION;
  let response = res();
  assert.equal(sceneCodeGenerationEnabled(response), false);
  assert.equal(response.code, 403);
  assert.equal(response.body.code, 'scene_code_disabled');
  process.env.HON_ENABLE_SCENE_CODE_EXECUTION = 'yes';
  assert.equal(sceneCodeGenerationEnabled(res()), false, 'only the exact value true enables it');
  process.env.HON_ENABLE_SCENE_CODE_EXECUTION = 'true';
  assert.equal(sceneCodeGenerationEnabled(res()), true);
  delete process.env.HON_ENABLE_SCENE_CODE_EXECUTION;
  for (const route of ['execute', 'execute-subtask', 'parallel-execute']) {
    const source = read(`api/playcanvas/${route}.js`);
    assert.match(source, /async function handler\(req, res\) \{\n  if \(req\.method !== 'OPTIONS' && !sceneCodeGenerationEnabled\(res\)\) return;/, route);
  }
});
