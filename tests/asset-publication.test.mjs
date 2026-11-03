import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const registryPath = new URL('../src/lib/playcanvas/assetRegistry.ts', import.meta.url);
const registrySource = readFileSync(registryPath, 'utf8');
const registry = ts.transpileModule(registrySource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const loadRegistry = async env => {
  const source = `const fixtureEnv = ${JSON.stringify(env)};\n` + registry.replaceAll('import.meta.env', 'fixtureEnv');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
};

test('the public asset catalog contains only models with recorded CC-BY credits', async () => {
  const { ASSET_REGISTRY, ASSET_BASE_URL } = await loadRegistry({});
  const metadata = JSON.parse(readFileSync(new URL('../docs/3D_ASSET_CREDITS.json', import.meta.url), 'utf8'));
  const approved = new Set(metadata.filter(row => row.asset?.extras?.license?.startsWith('CC-BY-4.0')).map(row => row.path.replace(/^public/, '')));
  assert.equal(ASSET_REGISTRY.length, 44);
  for (const asset of ASSET_REGISTRY) assert(approved.has(asset.path), asset.path);
  assert.equal(ASSET_BASE_URL, '/assets/3d');
  assert.equal(/https:\/\/[a-z0-9]{20}\.supabase\.co/.test(registrySource), false);
});

test('the optional model manifest covers the catalog while source clones contain no model payloads', async () => {
  const { ASSET_REGISTRY } = await loadRegistry({});
  const manifest = JSON.parse(readFileSync(new URL('../docs/3D_ASSET_MANIFEST.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.map(row => row.path.replace(/^public/, '')).sort(), ASSET_REGISTRY.map(row => row.path).sort());
  assert.equal(new Set(manifest.map(row => row.path)).size, 44);
  assert.equal(manifest.reduce((total, row) => total + row.size, 0), 2379944024);
  for (const row of manifest) {
    assert.match(row.sha256, /^[0-9a-f]{64}$/);
    assert(Number.isSafeInteger(row.size) && row.size > 0);
  }
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.deepEqual(tracked.split('\0').filter(path => /\.glb$/i.test(path)), []);
});

test('asset storage can be configured by the operator without changing catalog source', async () => {
  const { ASSET_BASE_URL, getAssetUrl } = await loadRegistry({ VITE_3D_ASSET_BASE_URL: 'https://assets.example/models/' });
  assert.equal(ASSET_BASE_URL, 'https://assets.example/models');
  assert.equal(getAssetUrl('test.glb'), 'https://assets.example/models/test.glb');
});

test('an unset optional animation library performs no remote asset load', async () => {
  const path = new URL('../src/lib/playcanvas/animatedCharacterController.ts', import.meta.url);
  const source = readFileSync(path, 'utf8');
  const ast = ts.createSourceFile(path.pathname, source, ts.ScriptTarget.Latest, true);
  const loader = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'loadAnimationLibrary');
  assert(loader);
  const isolated = `const fixtureEnv = {}; let animationLibraryCache = null; let animationLibraryLoading = null;\n` + loader.getText(ast);
  const code = ts.transpileModule(isolated, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replaceAll('import.meta.env', 'fixtureEnv');
  const { loadAnimationLibrary } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  const clips = await loadAnimationLibrary({ assets: { add() { throw Error('Unexpected remote load'); } } });
  assert.equal(clips.size, 0);
});

test('no tracked file hard-codes a Supabase project URL or a local key-file path', t => {
  const root = new URL('..', import.meta.url);
  let tracked;
  try {
    tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  } catch {
    t.skip('not a git checkout');
    return;
  }
  const projectUrl = /https:\/\/[a-z0-9]{20}\.supabase\.co/;
  const keyFile = ['.cursor', 'mcp_password'].join('/');
  const offenders = [];
  for (const file of tracked.split('\0').filter(Boolean)) {
    if (!/\.(m?[jt]sx?|json|md|sql|py|sh|ya?ml|html|toml)$/.test(file) || file === 'package-lock.json') continue;
    let text;
    try { text = readFileSync(new URL(file, root), 'utf8'); } catch { continue; }
    if (projectUrl.test(text) || text.includes(keyFile)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});
