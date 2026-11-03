import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serverSupabaseCredentials } from '../api/_lib/server-supabase.js';

const names = ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_URL', 'VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'];
const withEnv = (values, run) => {
  const saved = Object.fromEntries(names.map(n => [n, process.env[n]]));
  for (const n of names) delete process.env[n];
  Object.assign(process.env, values);
  try { return run(); } finally { for (const n of names) { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; } }
};

test('the secret key is preferred over the older service-key names', () => {
  withEnv({ SUPABASE_SECRET_KEY: 'fixture-secret', SUPABASE_SERVICE_ROLE_KEY: 'fixture-old-role', SUPABASE_SERVICE_KEY: 'fixture-old-alias', SUPABASE_URL: 'https://project.example' },
    () => assert.deepEqual(serverSupabaseCredentials(), { url: 'https://project.example', key: 'fixture-secret' }));
  withEnv({ SUPABASE_SERVICE_ROLE_KEY: 'fixture-old-role', SUPABASE_SERVICE_KEY: 'fixture-old-alias', VITE_SUPABASE_URL: 'https://vite.example' },
    () => assert.deepEqual(serverSupabaseCredentials(), { url: 'https://vite.example', key: 'fixture-old-role' }));
  withEnv({ SUPABASE_SERVICE_KEY: 'fixture-old-alias', NEXT_PUBLIC_SUPABASE_URL: 'https://next.example' },
    () => assert.deepEqual(serverSupabaseCredentials(), { url: 'https://next.example', key: 'fixture-old-alias' }));
  withEnv({}, () => assert.deepEqual(serverSupabaseCredentials(), { url: undefined, key: undefined }));
});

test('every server credential read goes through the shared helper', async () => {
  const { readFileSync } = await import('node:fs');
  for (const file of ['api/_lib/api-access.js', 'api/_lib/splat-security.js', 'api/_lib/character-ownership.js', 'api/hume/memoryHandlers.js']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /serverSupabaseCredentials\(\)/, file);
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_KEY/, `${file} must not read the key names directly`);
  }
});
