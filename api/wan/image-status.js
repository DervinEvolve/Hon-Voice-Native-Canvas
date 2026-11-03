import { withApiAccess } from "../_lib/api-access.js";
import { ownedProviderId, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from '@fal-ai/client';

 async function handler(req, res, context) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const token = req.query?.requestId;
  if (!token) return res.status(400).json({ error: 'requestId is required' });
  // Only jobs this user started (see api/_lib/job-ownership.js).
  let requestId;
  try { requestId = ownedProviderId(context?.actor, 'wan/image', token); }
  catch (error) { return sendJobOwnershipError(res, error); }
  try {
    const apiKey = process.env.FAL_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Service configuration error' });
    fal.config({ credentials: apiKey });
    const status = await fal.queue.status('fal-ai/wan-25-preview/text-to-image', { requestId, logs: false });
    if (status.status === 'COMPLETED' && status.response_url) {
      const r = await fetch(status.response_url, { headers: { Authorization: `Key ${apiKey}` } });
      const data = await r.json();
      return res.status(200).json({ status: 'COMPLETED', result: data });
    }
    return res.status(200).json(status);
  } catch (e) {
    console.error('WAN t2i status error:', e);
    return res.status(500).json({ error: e?.message || 'failed' });
  }
}

export default withApiAccess(handler, "/api/wan/image-status");
