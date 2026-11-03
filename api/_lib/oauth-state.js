import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { decodeJwt } from 'jose';

export class AccessError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const providers = {
  google: { redirectEnv: 'GOOGLE_REDIRECT_URI', path: '/api/google/callback' },
  notion: { redirectEnv: 'NOTION_MCP_REDIRECT_URI', path: '/api/notion/mcp-callback' },
};
export const callbackProviders = Object.fromEntries(Object.entries(providers).map(([name, value]) => [value.path, name]));
const production = () => process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL_ENV);
const cookieName = provider => `${production() ? '__Host-' : ''}hon-${provider}-oauth${production() ? '' : '-dev'}`;
const cookieAttributes = () => `Path=/; HttpOnly; SameSite=Lax${production() ? '; Secure' : ''}`;

function signingKey() {
  const key = process.env.HON_OAUTH_STATE_SECRET || '';
  if (Buffer.byteLength(key) < 32 || Buffer.byteLength(key) > 512) throw new AccessError(503, 'OAuth state verification is not configured');
  return key;
}
function signature(payload, purpose = 'oauth-state') { return createHmac('sha256', signingKey()).update(`${purpose}\0${payload}`).digest('base64url'); }
function equal(left, right) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function oauthRedirect(provider) {
  const config = providers[provider];
  if (!config) throw new AccessError(400, 'Unknown OAuth provider');
  try {
    const url = new URL(process.env[config.redirectEnv]);
    const local = !production() && ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password ||
        url.search || url.hash || url.pathname !== config.path || (!local && url.port)) throw Error();
    return url.href;
  } catch { throw new AccessError(503, 'An explicit OAuth callback URL is required'); }
}

export function beginOAuthState(res, provider, actor, now = Date.now()) {
  const nonce = randomBytes(32).toString('base64url');
  const proof = { provider, actor, nonce, redirect: oauthRedirect(provider), exp: now + 600000 };
  const payload = Buffer.from(JSON.stringify(proof)).toString('base64url');
  res.setHeader('Set-Cookie', `${cookieName(provider)}=${payload}.${signature(payload)}; ${cookieAttributes()}; Max-Age=600`);
  res.setHeader('Cache-Control', 'no-store');
  return proof;
}

export function readOAuthState(req, provider, now = Date.now()) {
  const state = req.query?.state;
  if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new AccessError(400, 'Invalid or expired OAuth state');
  const raw = req.headers?.cookie;
  if (typeof raw !== 'string' || raw.length > 16384) throw new AccessError(400, 'Invalid or expired OAuth state');
  const values = raw.split(';').map(s => s.trim()).filter(s => s.startsWith(`${cookieName(provider)}=`));
  if (values.length !== 1) throw new AccessError(400, 'Invalid or expired OAuth state');
  const value = values[0].slice(cookieName(provider).length + 1);
  const parts = value.split('.');
  if (parts.length !== 2 || parts[0].length > 4096 || !/^[A-Za-z0-9_-]{43}$/.test(parts[1]) || !equal(signature(parts[0]), parts[1])) {
    throw new AccessError(400, 'Invalid or expired OAuth state');
  }
  let proof;
  try { proof = JSON.parse(Buffer.from(parts[0], 'base64url')); } catch { throw new AccessError(400, 'Invalid or expired OAuth state'); }
  const allowed = (process.env.HON_API_ALLOWED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.length) throw new AccessError(503, 'API access is not configured');
  if (proof.provider !== provider || proof.redirect !== oauthRedirect(provider) || !Number.isFinite(proof.exp) ||
      proof.exp <= now || proof.exp > now + 630000 || typeof proof.nonce !== 'string' || !equal(proof.nonce, state) ||
      typeof proof.actor !== 'string' || !allowed.includes(proof.actor)) throw new AccessError(400, 'Invalid or expired OAuth state');
  return proof;
}

export function clearOAuthState(provider) { return `${cookieName(provider)}=; ${cookieAttributes()}; Max-Age=0`; }

function tokenCookieName(name) { return `${production() ? '__Host-hon-' : 'hon-dev-'}${name.replaceAll('_', '-')}`; }
export function clearProviderCookie(name) { return `${tokenCookieName(name)}=; ${cookieAttributes()}; Max-Age=0`; }
export function providerTokenCookie(name, tokens, actor, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ ...tokens, hon_actor: actor, hon_exp: now + 604800000 })).toString('base64url');
  if (payload.length > 3400) throw new AccessError(502, 'Provider session is too large');
  return `${tokenCookieName(name)}=${payload}.${signature(payload, `provider:${name}`)}; ${cookieAttributes()}; Max-Age=604800`;
}
export function readProviderTokens(req, name, now = Date.now()) {
  try {
    const cookie = req.headers?.cookie;
    if (typeof cookie !== 'string' || cookie.length > 16384) return null;
    const values = cookie.split(';').map(s => s.trim()).filter(s => s.startsWith(`${tokenCookieName(name)}=`));
    if (values.length !== 1) return null;
    const [payload, mac, extra] = values[0].slice(tokenCookieName(name).length + 1).split('.');
    if (extra || !payload || payload.length > 12000 || !mac || !equal(signature(payload, `provider:${name}`), mac)) return null;
    const tokens = JSON.parse(Buffer.from(payload, 'base64url'));
    // The API boundary verifies this provider proof. This check binds the cookie
    // to that subject; decoding alone is never used as an authentication proof.
    const authorization = req.headers?.authorization;
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return null;
    const actor = decodeJwt(authorization.slice(7)).sub;
    if (typeof actor !== 'string' || actor !== tokens.hon_actor || !Number.isFinite(tokens.hon_exp) || tokens.hon_exp <= now || tokens.hon_exp > now + 604830000) return null;
    return tokens;
  } catch { return null; }
}

export function oauthPage(res, proof, payload) {
  const message = JSON.stringify(payload).replaceAll('<', '\\u003c');
  const origin = JSON.stringify(new URL(proof.redirect).origin);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.end(`<script>window.opener?.postMessage(${message},${origin});window.close();</script><p>You can close this window.</p>`);
}
