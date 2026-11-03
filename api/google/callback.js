import { withApiAccess } from "../_lib/api-access.js";
import { readOAuthState, clearOAuthState, providerTokenCookie, oauthPage, AccessError } from '../_lib/oauth-state.js';
 async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  let proof;
  try {
    proof = readOAuthState(req, 'google');
    res.setHeader('Set-Cookie', clearOAuthState('google'));
    if (req.query?.error) return oauthPage(res, proof, { kind: 'google-error', error: 'Authorization failed' });
    const code = req.query?.code;
    if (typeof code !== 'string' || !code || code.length > 8192) return res.status(400).json({ error: 'Invalid authorization code' });
    const clientId = process.env.GOOGLE_CLIENT_ID; const secret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !secret) throw new AccessError(503, 'Google integration is not configured');
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: secret, redirect_uri: proof.redirect, grant_type: 'authorization_code' }),
    });
    const tokens = await response.json();
    if (!response.ok || typeof tokens.access_token !== 'string') throw Error('Token exchange failed');
    const expiry = Number(tokens.expires_in);
    res.setHeader('Set-Cookie', [clearOAuthState('google'), providerTokenCookie('gd_tokens', {
      access_token: tokens.access_token, refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (Number.isFinite(expiry) && expiry > 0 ? Math.min(expiry, 86400) : 3600) * 1000,
    }, proof.actor)]);
    return oauthPage(res, proof, { kind: 'google-connected' });
  } catch (error) {
    return res.status(error instanceof AccessError ? error.status : 502).json({ error: 'Google connection could not be completed' });
  }
}

export default withApiAccess(handler, "/api/google/callback");
