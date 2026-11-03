import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../src/server/api.ts', import.meta.url), 'utf8');

test('the local API server registers routes only under /api, behind the access check', () => {
  const routes = [...source.matchAll(/\bapp\.(get|post|put|patch|delete|all)\(\s*['"`]([^'"`]+)/g)].map(m => m[2]);
  assert.ok(routes.length > 0);
  for (const route of routes) assert.ok(route.startsWith('/api/'), route);
  const guard = source.indexOf("app.use('/api', async (req, res, next)");
  assert.ok(guard > 0);
  for (const m of source.matchAll(/\bapp\.(get|post|put|patch|delete|all)\(/g)) assert.ok(m.index > guard, 'route registered before the access check');
});

test('the local Cloudinary upload uses the configured account, not one from the request', () => {
  const start = source.indexOf("app.post('/api/cloudinary-upload'");
  assert.ok(start > 0);
  const route = source.slice(start, source.indexOf('\n});\n', start));
  assert.doesNotMatch(route, /req\.body\??\.(cloudName|preset)/);
  assert.match(route, /process\.env\.CLOUDINARY_CLOUD_NAME/);
  assert.doesNotMatch(route, /api_key/);
});
