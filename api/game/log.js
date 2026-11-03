import { withApiAccess } from "../_lib/api-access.js";
 async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { panelId, stage, message, extra } = req.body || {};
    const requestId = (req.headers['x-request-id'] ? String(req.headers['x-request-id']) : '') || `gp_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    console.log(`[game.panel][${requestId}] panel=${panelId || 'unknown'} stage=${stage || 'unknown'} msg=${(message || '').slice(0, 160)}`, extra ? { extra } : '');
    return res.status(200).json({ ok: true, requestId });
  } catch (e) {
    console.error('[game.panel] log endpoint error', e);
    return res.status(200).json({ ok: true });
  }
}

export default withApiAccess(handler, "/api/game/log");
