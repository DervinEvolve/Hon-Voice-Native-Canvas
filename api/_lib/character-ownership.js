import { createClient } from '@supabase/supabase-js';
import { serverSupabaseCredentials } from './server-supabase.js';
import { JobOwnershipError } from './job-ownership.js';

// A Higgsfield soul ID names a stored character, not a job, so it cannot carry
// a job token. All users share one provider account, and the provider renders
// with any soul ID that account owns, so the server checks the characters
// table before forwarding one: only the user whose row holds a soul ID may
// render with it.

const SOUL_ID = /^[A-Za-z0-9_-]{1,128}$/;

// Returns the caller's user_characters row ID for this soul ID, or throws a
// JobOwnershipError that sendJobOwnershipError turns into a response.
export async function assertOwnedSoulId(actor, soulId, clientFactory = createClient) {
  if (typeof actor !== 'string' || !actor) throw new JobOwnershipError(401, 'A verified user is required');
  if (typeof soulId !== 'string' || !SOUL_ID.test(soulId)) throw new JobOwnershipError(400, 'Invalid soul_id');
  // Server-only key. Without one the request stops: the anon key would leave
  // the answer to the table's row policies.
  const { url: configuredUrl, key } = serverSupabaseCredentials();
  let client;
  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !key) throw Error();
    client = clientFactory(url.origin, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(5000) }) },
    });
  } catch { throw new JobOwnershipError(503, 'Character ownership is not configured'); }
  // The client may save the same character more than once, so take any match
  // instead of requiring a single row.
  let row;
  try {
    const { data, error } = await client.from('user_characters').select('id').eq('soul_id', soulId).eq('user_id', actor).limit(1);
    if (!error && Array.isArray(data)) row = data[0];
  } catch { /* A failed lookup is refused below like a missing row. */ }
  // Another user's soul, an unknown soul and a failed lookup read the same, so
  // the response does not reveal whether the soul exists.
  if (!row?.id) throw new JobOwnershipError(404, 'Character not found');
  return row.id;
}
