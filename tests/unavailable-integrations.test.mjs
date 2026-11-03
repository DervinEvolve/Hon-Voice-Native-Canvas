import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { NOT_AVAILABLE_CODE, WORLD_SCENE_NOT_AVAILABLE, sendNotAvailable } from '../api/_lib/not-available.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function stringConstant(source, name) {
  const match = source.match(new RegExp(`export const ${name} =\\s*([\\s\\S]*?);\\n`));
  assert.ok(match, `${name} not found`);
  return [...match[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join('');
}

test('the browser and the server use the same not-available wording for world scenes', () => {
  assert.equal(stringConstant(read('src/config/unavailableFeatures.ts'), 'WORLD_SCENE_NOT_AVAILABLE'), WORLD_SCENE_NOT_AVAILABLE);
});

test('generate_world_scene no longer returns fixed sample captures', () => {
  for (const path of ['api/luma/generate-scene.js', 'src/server/api.ts', 'src/services/humeEviService.ts']) {
    assert.doesNotMatch(read(path), /lumalabs\.ai\/capture\//, path);
  }
  const handler = read('src/services/humeEviService.ts');
  const start = handler.indexOf('private async handleGenerateWorldScene(');
  const body = handler.slice(start, handler.indexOf('private async handleWorldMapNavigation(', start));
  assert.doesNotMatch(body, /fetch\(/);
  assert.match(body, /WORLD_SCENE_NOT_AVAILABLE/);
});

test('not-available routes answer 501 with code not_available and the plain message', () => {
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  sendNotAvailable(res, 'generate_world_scene', WORLD_SCENE_NOT_AVAILABLE);
  assert.equal(res.code, 501);
  assert.deepEqual(res.body, { success: false, available: false, code: NOT_AVAILABLE_CODE, feature: 'generate_world_scene', error: WORLD_SCENE_NOT_AVAILABLE });
  assert.match(read('api/luma/generate-scene.js'), /sendNotAvailable\(res, 'generate_world_scene', WORLD_SCENE_NOT_AVAILABLE\)/);
  assert.match(read('src/server/api.ts'), /sendNotAvailable\(res, 'generate_world_scene', WORLD_SCENE_NOT_AVAILABLE\)/);
});

// Routes the browser calls that exist only in the local dev server. Each one
// tells the user so when a deployed build answers 404.
const LOCAL_DEV_ONLY_ROUTES = new Set(['/api/fal/kling-image-to-video']);
// Routes referenced only behind a switch that is off in this build.
const GATED_ROUTES = new Set(['/api/proxy-model']); // MAP_MODEL_PLACEMENT_AVAILABLE

test('every /api route the browser code calls exists as a deployed function (or is a known local-dev-only route)', () => {
  const files = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' }).split('\n')
    .filter((f) => /\.(ts|tsx|js|mjs)$/.test(f) && !f.startsWith('src/server/') && !f.startsWith('src/pages/'));
  const missing = [];
  for (const file of files) {
    for (const m of read(file).matchAll(/['"`](\/api\/[A-Za-z0-9_./-]+)(\$\{|\/\$\{)?/g)) {
      if (m[2]) continue; // prefix of a template string; the full path is built at runtime
      const route = m[1].replace(/\/$/, '');
      if (route.split('/').length < 3) continue;
      if (LOCAL_DEV_ONLY_ROUTES.has(route) || GATED_ROUTES.has(route)) continue;
      if (existsSync(new URL(`..${route}/`, import.meta.url))) continue; // a base URL for a provider folder
      if (!existsSync(new URL(`..${route}.js`, import.meta.url))) missing.push(`${file}: ${route}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('unavailable integrations answer plainly instead of returning sample data', () => {
  const hume = read('src/services/humeEviService.ts');
  const place = hume.slice(hume.indexOf('private async handlePlace3DModelOnMap('));
  assert.ok(place.indexOf('MAP_MODEL_PLACEMENT_AVAILABLE') < place.indexOf('meshyService.submit'), 'map placement must answer before starting a paid job');

  const voices = read('api/elevenlabs/voices.js');
  assert.doesNotMatch(voices, /mock-voice|preview\d\.mp3/);
  assert.match(voices, /sendNotAvailable/);

  const collaborators = read('src/services/collaboratorService.ts');
  assert.doesNotMatch(collaborators, /mockCollaborators|mockInvites|mockSearchResults|john_doe|jane_smith/);

  const editor = read('src/components/creator/PanelEditor.tsx');
  const tryOn = editor.slice(editor.indexOf('const handleVirtualTryOn'), editor.indexOf('// Initialize history when selecting a tool'));
  assert.doesNotMatch(tryOn, /klingService|fetch\(/);
  assert.match(tryOn, /VIRTUAL_TRY_ON_NOT_AVAILABLE/);

  const roboflow = read('api/roboflow/sam3-detect.js');
  assert.doesNotMatch(roboflow, /res\.status\(200\)\.json\(\{\s*success: true,\s*objects: \[\]/);
  assert.doesNotMatch(roboflow, /Graceful fallback/);
});
