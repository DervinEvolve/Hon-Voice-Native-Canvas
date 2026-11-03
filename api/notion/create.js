import { withApiAccess } from "../_lib/api-access.js";
import { readProviderTokens } from '../_lib/oauth-state.js';
// Helper to extract access token from either regular or MCP cookies
function getAccessToken(req) {
  const tokens = readProviderTokens(req, 'notion_mcp_tokens') || readProviderTokens(req, 'notion_tokens');
  return tokens?.mcp_access_token || tokens?.access_token || null;
}

 async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const accessToken = getAccessToken(req);

    if (!accessToken) {
      return res.status(401).json({ error: 'Not connected to Notion', needsAuth: true });
    }

    const { title = 'Hon Notes' } = req.body || {};

    // First, find an existing page to use as parent (workspace: true often doesn't work)
    let parentId = null;
    try {
      const searchResp = await fetch('https://api.notion.com/v1/search', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Notion-Version': process.env.NOTION_API_VERSION || '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ page_size: 1 })
      });
      const searchJson = await searchResp.json();
      if (searchJson.results?.[0]) {
        parentId = searchJson.results[0].id;
      }
    } catch (e) {
      console.warn('[notion/create] Could not find parent page:', e.message);
    }

    // Build page payload (minimal - no placeholder content)
    const pagePayload = {
      properties: {
        title: {
          title: [{ type: 'text', text: { content: title } }]
        }
      },
      children: [] // Empty - content will be added by user or Hon
    };

    // Use parent page if found
    if (parentId) {
      pagePayload.parent = { page_id: parentId };
    } else {
      // Try workspace as fallback
      pagePayload.parent = { workspace: true };
    }

    const resp = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Notion-Version': process.env.NOTION_API_VERSION || '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(pagePayload)
    });
    const json = await resp.json();
    if (!resp.ok) return res.status(500).json({ error: json?.message || 'create_failed' });
    res.status(200).json({ pageId: json?.id });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'create_failed' });
  }
}

export default withApiAccess(handler, "/api/notion/create");
