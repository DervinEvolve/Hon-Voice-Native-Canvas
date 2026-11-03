import { withApiAccess } from "../_lib/api-access.js";
import { readProviderTokens } from '../_lib/oauth-state.js';
// Helper to extract access token from either regular or MCP cookies
function getAccessToken(req) {
  const tokens = readProviderTokens(req, 'notion_mcp_tokens') || readProviderTokens(req, 'notion_tokens');
  return tokens?.mcp_access_token || tokens?.access_token || null;
}

async function notionFetch(path, opts, token) {
  const resp = await fetch(`https://api.notion.com/v1${path}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': process.env.NOTION_API_VERSION || '2022-06-28',
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.message || 'notion_request_failed');
  return json;
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

    const { pageId, blocks, previousIds } = req.body || {};
    if (!pageId || !Array.isArray(blocks)) return res.status(400).json({ error: 'pageId and blocks[] required' });

    // Archive previous blocks if provided
    if (Array.isArray(previousIds) && previousIds.length) {
      await Promise.all(previousIds.slice(0, 50).map((bid) => notionFetch(`/blocks/${bid}`, { method: 'DELETE' }, accessToken)));
    }

    // Map our simple blocks to Notion children
    const children = blocks.slice(0, 50).map((b) => {
      if (b.type === 'heading') {
        return { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: b.text || '' } }] } };
      }
      if (b.type === 'todo') {
        return { object: 'block', type: 'to_do', to_do: { rich_text: [{ type: 'text', text: { content: b.text || '' } }], checked: !!b.checked } };
      }
      if (b.type === 'image' && b.url) {
        return { object: 'block', type: 'image', image: { type: 'external', external: { url: b.url } } };
      }
      return { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: b.text || '' } }] } };
    });

    // Append to page
    const result = await notionFetch(`/blocks/${pageId}/children`, {
      method: 'PATCH',
      body: JSON.stringify({ children })
    }, accessToken);

    const newIds = (result?.results || []).map((r) => r?.id).filter(Boolean);
    res.status(200).json({ ok: true, blockIds: newIds });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'save_failed' });
  }
}

export default withApiAccess(handler, "/api/notion/save");
