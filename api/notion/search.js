import { withApiAccess } from "../_lib/api-access.js";
import { readProviderTokens } from '../_lib/oauth-state.js';
// Helper to extract access token from either regular or MCP cookies
function getAccessToken(req) {
  const tokens = readProviderTokens(req, 'notion_mcp_tokens') || readProviderTokens(req, 'notion_tokens');
  return tokens?.mcp_access_token || tokens?.access_token || null;
}

 async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const accessToken = getAccessToken(req);

    if (!accessToken) {
      return res.status(401).json({ error: 'Not connected to Notion', needsAuth: true });
    }

    const q = String(req.query.q || '');

    const resp = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Notion-Version': process.env.NOTION_API_VERSION || '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: q, page_size: 10 })
    });
    const json = await resp.json();
    if (!resp.ok) return res.status(500).json({ error: json?.message || 'search_failed' });
    res.status(200).json(json);
  } catch (e) {
    res.status(500).json({ error: e?.message || 'search_failed' });
  }
}

export default withApiAccess(handler, "/api/notion/search");
