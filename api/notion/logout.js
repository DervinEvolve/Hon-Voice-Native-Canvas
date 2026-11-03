import { withApiAccess } from "../_lib/api-access.js";
import { clearProviderCookie } from '../_lib/oauth-state.js';
/**
 * Clear Notion OAuth tokens from cookies
 */
 async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Clear both regular and MCP-specific Notion cookies
    res.setHeader('Set-Cookie', [
      clearProviderCookie('notion_tokens'),
      clearProviderCookie('notion_mcp_tokens')
    ]);

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'logout_failed' });
  }
}

export default withApiAccess(handler, "/api/notion/logout");
