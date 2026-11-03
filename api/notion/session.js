import { withApiAccess } from "../_lib/api-access.js";
import { readProviderTokens } from '../_lib/oauth-state.js';

 async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const tokens = readProviderTokens(req, 'notion_mcp_tokens') || readProviderTokens(req, 'notion_tokens');
  if (!tokens?.access_token) return res.status(401).json({ ok: false });
  return res.status(200).json({ ok: true, mcp: tokens.mcp === true,
    workspace: typeof tokens.workspace_name === 'string' ? tokens.workspace_name.slice(0, 200) : 'Notion' });
}

export default withApiAccess(handler, "/api/notion/session");
