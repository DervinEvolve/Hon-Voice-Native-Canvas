import { createClient } from '@supabase/supabase-js';
import { serverSupabaseCredentials } from '../_lib/server-supabase.js';

const { url: supabaseUrl, key: supabaseKey } = serverSupabaseCredentials();
const supabase = createClient(supabaseUrl, supabaseKey);

export async function putMemory(payload) {
  const row = {
    user_id: payload.user_id || null,
    wallet_address: payload.wallet_address || null,
    key: payload.key,
    value_json: payload.value,
    tags: payload.tags || null,
    importance: payload.importance ?? null,
    scope: payload.scope || 'user',
    project_id: payload.projectId || null,
  };
  const { data, error } = await supabase
    .from('hon_memories')
    .upsert(row, { onConflict: 'user_id,wallet_address,key' })
    .select()
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function getMemory(key) {
  if (!key) return null;
  // In API context, you can pass user_id/wallet_address from auth middleware (omitted here)
  return null;
}

export async function searchMemories(params) {
  // Placeholder: implement if needed from server-side
  return [];
}

export async function deleteMemory(key) {
  if (!key) return false;
  return false;
}

export async function upsertSession(snapshot) {
  const row = { user_id: null, wallet_address: null, snapshot_json: snapshot };
  await supabase.from('hon_sessions').upsert(row, { onConflict: 'user_id,wallet_address' });
}

export async function getSession() {
  const { data } = await supabase.from('hon_sessions').select('snapshot_json').limit(1).maybeSingle();
  return data?.snapshot_json || null;
}


