import { withApiAccess } from "../_lib/api-access.js";
import { ownedProviderId, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from '@fal-ai/client';

 async function handler(req, res, context) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed, use GET' });

  try {
    const { request_id: token, model_type } = req.query || {};
    if (!token) return res.status(400).json({ error: 'request_id is required' });
    // Only jobs this user started (see api/_lib/job-ownership.js).
    let request_id;
    try { request_id = ownedProviderId(context?.actor, 'sora2', token); }
    catch (error) { return sendJobOwnershipError(res, error); }

    if (!process.env.FAL_API_KEY) {
      console.error('Missing FAL_API_KEY');
      return res.status(500).json({ error: 'Server misconfigured: missing FAL_API_KEY' });
    }
    fal.config({ credentials: process.env.FAL_API_KEY });

    const endpoint = model_type === 'image-to-video' ? 'fal-ai/sora-2/image-to-video/pro' : 'fal-ai/sora-2/text-to-video/pro';

    const status = await fal.queue.status(endpoint, { requestId: request_id, logs: true });

    if (status.status === 'COMPLETED') {
      try {
        const result = await fal.queue.result(endpoint, { requestId: request_id });
        return res.status(200).json({ status: 'COMPLETED', result, request_id: token });
      } catch (e) {
        // Result artifacts can take a moment to become available after COMPLETED
        console.log('Sora2 result not ready yet; continuing to poll');
        return res.status(200).json({ status: 'PROCESSING', result: null, request_id: token });
      }
    }

    if (status.status === 'FAILED') {
      return res.status(200).json({ status: 'FAILED', error: status.logs?.map(l => l.message).join('; ') || 'Failed', request_id: token });
    }

    return res.status(200).json({ status: status.status, request_id: token, progress: status.logs?.slice(-1)[0]?.message });
  } catch (error) {
    console.error('Sora2 status error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to check Sora2 status' });
  }
}

export default withApiAccess(handler, "/api/sora2/status");
