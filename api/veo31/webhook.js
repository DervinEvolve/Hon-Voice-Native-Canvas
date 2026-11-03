import { withApiAccess } from "../_lib/api-access.js";
 async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const urlSecret = req.query?.secret;
    const expected = process.env.FAL_WEBHOOK_SECRET;
    if (expected && urlSecret !== expected) {
      return res.status(401).json({ error: 'Unauthorized webhook' });
    }

    const body = req.body || {};
    // Fal webhook payloads include request_id and data
    const requestId = body?.request_id || body?.requestId || body?.id;
    const videoUrl = body?.data?.video?.url || body?.video?.url;

    console.log('[Veo 3.1 webhook] Received:', { requestId, hasVideo: !!videoUrl });

    // TODO: Optionally persist mapping (requestId -> videoUrl) to DB/cache for clients
    // For now, just acknowledge receipt
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[Veo 3.1 webhook] Error:', e);
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export default withApiAccess(handler, "/api/veo31/webhook");
