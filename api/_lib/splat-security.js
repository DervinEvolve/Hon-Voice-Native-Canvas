import { randomUUID, createHash } from 'node:crypto';
import { serverSupabaseCredentials } from './server-supabase.js';
import { decodeJwt } from 'jose';
import { verifyPrivyAccessToken } from './privy-access.js';

export const PRIVATE_SPLAT_BUCKET = 'hon-private-splats';
export const MAX_SPLAT_BYTES = 128 * 1024 * 1024;

// Verify the actual provider token before applying the operator's user allowlist.
export async function authorizeSplatRequest(req, res, createClient, allowedEnvironment = 'HON_SPLAT_ALLOWED_USER_IDS') {
  res.setHeader('Cache-Control', 'no-store');
  const authorization = req.headers?.authorization;
  if (typeof authorization !== 'string' || !/^Bearer [^\s]{1,8192}$/.test(authorization)) {
    res.status(401).json({ error: 'An access token is required' });
    return null;
  }
  const { url, key } = serverSupabaseCredentials();
  const allowed = (process.env[allowedEnvironment] || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!url || !key || !allowed.length) {
    res.status(503).json({ error: 'This tool is not configured for use' });
    return null;
  }
  let parsed;
  try {
    parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Invalid URL');
  } catch {
    res.status(503).json({ error: 'This tool is not configured for use' });
    return null;
  }
  const client = createClient(parsed.origin, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = authorization.slice(7);
  let isPrivy = false;
  try { isPrivy = decodeJwt(token).iss === 'privy.io'; } catch { /* Supabase will reject malformed tokens. */ }
  let actor;
  try {
    if (isPrivy) {
      actor = await verifyPrivyAccessToken(token);
    } else {
      const { data, error } = await client.auth.getUser(token);
      if (!error) actor = data?.user?.id;
    }
  } catch { /* Invalid provider proof must not fall back to a UI identity. */ }
  if (!actor) {
    res.status(401).json({ error: 'Invalid or expired access token' });
    return null;
  }
  if (!allowed.includes(actor)) {
    res.status(403).json({ error: 'This tool is not enabled for this user' });
    return null;
  }
  const userId = isPrivy ? `privy_${createHash('sha256').update(actor).digest('hex')}` : actor;
  return { client, userId, storageOrigin: parsed.origin };
}

export function newJobId() { return `sharp_${randomUUID()}`; }
export function validJobId(id) { return typeof id === 'string' && /^sharp_[0-9a-f-]{36}$/.test(id); }
export function validSceneId(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id); }

export function allowedLodSource(raw, storageOrigin) {
  const source = new URL(raw);
  const prefix = '/storage/v1/object/public/hon-assets/';
  if (source.origin !== storageOrigin || source.username || source.password || source.search || source.hash ||
      !source.pathname.startsWith(prefix) || !/^[A-Za-z0-9_./-]+$/.test(source.pathname) ||
      source.pathname.slice(prefix.length).split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Invalid public storage source');
  }
  return source;
}

export function allowedImageUrl(raw, storageOrigin) {
  if (typeof raw !== 'string' || raw.length > 8192) throw new Error('Invalid image URL');
  const url = new URL(raw);
  const allowed = (process.env.HON_SPLAT_IMAGE_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean);
  allowed.push(new URL(storageOrigin).hostname);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowed.includes(url.hostname)) {
    throw new Error('Image host is not allowed');
  }
  return url.href;
}

export async function boundedDownload(url, maximum, fetchImpl = fetch) {
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  return readBoundedResponse(response, maximum);
}

export async function readBoundedResponse(response, maximum) {
  if (!response.ok || !response.body) throw new Error('Source download failed');
  if (Number(response.headers.get('content-length')) > maximum) {
    await response.body.cancel();
    throw new Error('Source file is too large');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) throw new Error('Source file is too large');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks, length);
}

export async function requirePrivateBucket(client) {
  const { data, error } = await client.storage.getBucket(PRIVATE_SPLAT_BUCKET);
  if (error || !data || data.public !== false) throw new Error('Private splat bucket is required');
}
