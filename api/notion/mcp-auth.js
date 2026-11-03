import { withApiAccess } from "../_lib/api-access.js";
import { beginOAuthState, AccessError } from '../_lib/oauth-state.js';

 async function handler(req, res, context) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const clientId = process.env.NOTION_CLIENT_ID;
    if (!clientId) throw new AccessError(503, 'Notion integration is not configured');
    const proof = beginOAuthState(res, 'notion', context.actor);
    const url = new URL('https://api.notion.com/v1/oauth/authorize');
    for (const [key, value] of Object.entries({ client_id: clientId, response_type: 'code', owner: 'user', redirect_uri: proof.redirect, state: proof.nonce })) url.searchParams.set(key, value);
    return res.status(200).json({ url: url.href });
  } catch (error) { return res.status(error instanceof AccessError ? error.status : 503).json({ error: 'Notion connection could not be started' }); }
}

export default withApiAccess(handler, "/api/notion/mcp-auth");
