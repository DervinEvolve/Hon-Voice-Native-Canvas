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

    const result = await fal.queue.result('fal-ai/meshy/v6-preview/text-to-3d', { requestId });
    console.log('[Meshy] result', requestId, !!result?.data?.model_urls);
    return res.status(200).json({ success: true, result });
  } catch (e) {
    // Surface upstream status codes so client can decide whether to continue polling
    const status = (e && e.status) || 500;
    const body = e && e.body;
    const detail = (body && (body.detail || body.message)) || e?.message || '';
    const detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail);
    console.error('[Meshy] result error', { status, detail: detailStr, requestId: req.query.requestId });
    // If upstream says still in progress, forward 422 so the client continues polling
    if (status === 400 || status === 422) {
      return res.status(status).json({ success: false, inProgress: true, error: detailStr });
    }
    return res.status(status).json({ success: false, error: detailStr || 'meshy_result_failed' });
  }
}

export default withApiAccess(handler, "/api/fal/meshy-result");
