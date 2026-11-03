import { withApiAccess } from "../_lib/api-access.js";
import { readOAuthState, clearOAuthState, providerTokenCookie, oauthPage, AccessError } from '../_lib/oauth-state.js';
 async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const proof = readOAuthState(req, 'notion');
    res.setHeader('Set-Cookie', clearOAuthState('notion'));
    if (req.query?.error) return oauthPage(res, proof, { kind: 'notion-mcp-error', error: 'Authorization failed' });
    const code = req.query?.code;
    if (typeof code !== 'string' || !code || code.length > 8192) return res.status(400).json({ error: 'Invalid authorization code' });
    const clientId = process.env.NOTION_CLIENT_ID; const secret = process.env.NOTION_CLIENT_SECRET;
    if (!clientId || !secret) throw new AccessError(503, 'Notion integration is not configured');
    const response = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${clientId}:${secret}`).toString('base64') },
      body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: proof.redirect }),
    });
    const tokens = await response.json();
    if (!response.ok || typeof tokens.access_token !== 'string') throw Error('Token exchange failed');
    const payload = { access_token: tokens.access_token, bot_id: tokens.bot_id, workspace_id: tokens.workspace_id, workspace_name: tokens.workspace_name, mcp: true };
    res.setHeader('Set-Cookie', [clearOAuthState('notion'), providerTokenCookie('notion_mcp_tokens', payload, proof.actor), providerTokenCookie('notion_tokens', payload, proof.actor)]);
    return oauthPage(res, proof, { kind: 'notion-mcp-connected', workspace: typeof tokens.workspace_name === 'string' ? tokens.workspace_name.slice(0, 200) : 'Notion' });
  } catch (error) {
    return res.status(error instanceof AccessError ? error.status : 502).json({ error: 'Notion connection could not be completed' });
  }
}

export default withApiAccess(handler, "/api/notion/mcp-callback");
