import { withApiAccess } from "../_lib/api-access.js";
import { ownedProviderId, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from '@fal-ai/client';

 async function handler(req, res, context) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const token = String(req.query?.requestId || '');
  if (!token) return res.status(400).json({ error: 'Missing requestId' });
  // Only jobs this user started (see api/_lib/job-ownership.js).
  let requestId;
  try { requestId = ownedProviderId(context?.actor, 'fal/meshy', token); }
  catch (error) { return sendJobOwnershipError(res, error); }
  try {
    const apiKey = process.env.FAL_API_KEY || process.env.FAL_AI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Service configuration error' });
    fal.config({ credentials: apiKey });

    const status = await fal.queue.status('fal-ai/meshy/v6-preview/text-to-3d', { requestId, logs: true });
    console.log('[Meshy] status', requestId, status?.status);
    return res.status(200).json({ success: true, status });
  } catch (e) {
    console.error('[Meshy] status error', e);
    return res.status(500).json({ success: false, error: e?.message || 'meshy_status_failed' });
  }
}

export default withApiAccess(handler, "/api/fal/meshy-status");
