import { decodeJwt } from 'jose';
import { createClient } from '@supabase/supabase-js';
import { verifyPrivyAccessToken } from './privy-access.js';
import { readOAuthState, callbackProviders, AccessError } from './oauth-state.js';
import { PAID_GENERATION_ROUTES, DEFAULT_PAID_JOBS_PER_HOUR } from './paid-routes.js';
import { serverSupabaseCredentials } from './server-supabase.js';

export async function authorizeApiRequest(req, res, createClient, pathname, requestOrigin) {
  res.setHeader('Cache-Control', 'no-store');
  const origin = req.headers?.origin;
  const allowedOrigins = [requestOrigin, process.env.HON_APP_ORIGIN].filter(Boolean);
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL_ENV) allowedOrigins.push('http://localhost:5173', 'http://127.0.0.1:5173');
  if (origin && (typeof origin !== 'string' || !allowedOrigins.includes(origin))) {
    res.status(403).json({ error: 'Cross-origin API access is not allowed' }); return null;
  }
  const provider = callbackProviders[pathname];
  if (provider) {
    try { return readOAuthState(req, provider); }
    catch (error) { res.status(error instanceof AccessError ? error.status : 400).json({ error: error instanceof AccessError ? error.message : 'Invalid OAuth callback' }); return null; }
  }
  const authorization = req.headers?.authorization;
  if (typeof authorization !== 'string' || !/^Bearer [^\s]{1,8192}$/.test(authorization)) {
    res.status(401).json({ error: 'An access token is required' }); return null;
  }
  const allowed = (process.env.HON_API_ALLOWED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.length) { res.status(503).json({ error: 'API access is not configured' }); return null; }
  const token = authorization.slice(7);
  let privy = false;
  try { privy = decodeJwt(token).iss === 'privy.io'; } catch { /* The auth server rejects malformed Supabase proof. */ }
  let actor;
  if (privy) {
    if (!(process.env.PRIVY_APP_ID || process.env.VITE_PRIVY_APP_ID) || !process.env.PRIVY_VERIFICATION_KEY) {
      res.status(503).json({ error: 'Privy verification is not configured' }); return null;
    }
    try { actor = await verifyPrivyAccessToken(token); } catch { /* Signature/claims must be valid. */ }
  } else {
    // Auth lookup needs a public API key, not database/service-role authority.
    const rawUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    let url;
    try {
      url = new URL(rawUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !key) throw Error();
    } catch { res.status(503).json({ error: 'Supabase authentication is not configured' }); return null; }
    try {
      const client = createClient(url.origin, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: (input, init) => fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(5000) }) },
      });
      const { data, error } = await client.auth.getUser(token);
      if (error?.status >= 500) throw error;
      if (!error) actor = data?.user?.id;
    } catch { res.status(503).json({ error: 'Authentication could not be checked' }); return null; }
  }
  if (!actor) { res.status(401).json({ error: 'Invalid or expired access token' }); return null; }
  if (!allowed.includes(actor)) { res.status(403).json({ error: 'API access is not enabled for this user' }); return null; }
  return { actor };
}

// Enforce the same check at the function entrypoint too. Routing/rewrites must
// never be the only protection for a paid tool or provider-token endpoint.
export function withApiAccess(handler, pathname) {
  return async function verifiedApiHandler(req, res) {
    let context;
    try { context = await authorizeApiRequest(req, res, createClient, pathname, process.env.HON_APP_ORIGIN); }
    catch { return res.status(503).json({ error: 'API authorization could not be completed' }); }
    if (!context) return;
    if (!await consumeApiBudget(req, res, context.actor)) return;
    if (!await consumePaidJobBudget(req, res, context.actor, pathname)) return;
    return handler(req, res, context);
  };
}

// The database claims an atomic hourly slot across all server instances. Never
// fall back to process memory or dispatch paid work when the ledger is missing.
export async function consumeApiBudget(req, res, actor, clientFactory = createClient) {
  if (req.method === 'OPTIONS') return true;
  const read = ['GET', 'HEAD'].includes(req.method);
  const limitText = read ? process.env.HON_API_READS_PER_HOUR || '600' : process.env.HON_API_MUTATIONS_PER_HOUR || '60';
  const { url: configuredUrl, key } = serverSupabaseCredentials();
  let url;
  try {
    url = new URL(configuredUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !key || !/^[1-9][0-9]{0,4}$/.test(limitText) || Number(limitText) > 10000) throw Error();
    const client = clientFactory(url.origin, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(5000) }) },
    });
    const { data, error } = await client.rpc('claim_hon_api_request', { p_actor_id: `${read ? 'read' : 'write'}:${actor}`, p_limit: Number(limitText) });
    if (error || typeof data !== 'boolean') throw Error();
    if (!data) {
      res.setHeader('Retry-After', '3600');
      res.status(429).json({ error: 'Hourly tool request limit reached' });
      return false;
    }
    return true;
  } catch {
    res.status(503).json({ error: 'Tool request budget is not available' });
    return false;
  }
}

// Separate hourly cap on paid generation jobs per verified user. It uses the
// same atomic ledger as the request budget under a "paid:" key, so it needs no
// extra migration. This counts jobs, not money; provider budgets still apply.
export async function consumePaidJobBudget(req, res, actor, pathname, clientFactory = createClient) {
  if (req.method !== 'POST' || !PAID_GENERATION_ROUTES.has(pathname)) return true;
  const limitText = process.env.HON_API_PAID_JOBS_PER_HOUR || String(DEFAULT_PAID_JOBS_PER_HOUR);
  const { url: configuredUrl, key } = serverSupabaseCredentials();
  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !key || !/^[1-9][0-9]{0,3}$/.test(limitText)) throw Error();
    const client = clientFactory(url.origin, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(5000) }) },
    });
    const { data, error } = await client.rpc('claim_hon_api_request', { p_actor_id: `paid:${actor}`, p_limit: Number(limitText) });
    if (error || typeof data !== 'boolean') throw Error();
    if (!data) {
      const now = new Date();
      const retryAfter = 3600 - (now.getUTCMinutes() * 60 + now.getUTCSeconds());
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: `Hourly limit of ${Number(limitText)} paid generation jobs reached. Try again after the hour turns over.`,
        code: 'paid_job_limit',
        limit: Number(limitText),
      });
      return false;
    }
    return true;
  } catch {
    res.status(503).json({ error: 'Paid generation budget is not available' });
    return false;
  }
}

export function ownedApiCall(req, path) {
  if (!/^\/api\/[A-Za-z0-9/_-]+$/.test(path)) throw new Error('Invalid internal API path');
  const configured = process.env.HON_INTERNAL_API_ORIGIN || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://127.0.0.1:3000');
  const origin = new URL(configured);
  const local = ['localhost', '127.0.0.1'].includes(origin.hostname) && !process.env.VERCEL_ENV && process.env.NODE_ENV !== 'production';
  if ((origin.protocol !== 'https:' && !(local && origin.protocol === 'http:')) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('Invalid internal API origin');
  const authorization = req.headers?.authorization;
  if (typeof authorization !== 'string' || !/^Bearer [^\s]{1,8192}$/.test(authorization)) throw new Error('An access token is required');
  return { url: new URL(path, origin).href, options: { headers: { 'Content-Type': 'application/json', Authorization: authorization }, redirect: 'error' } };
}
