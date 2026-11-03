import { withApiAccess } from "../_lib/api-access.js";
import { ownedProviderId, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from '@fal-ai/client';

 async function handler(req, res, context) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { request_id: token } = req.query || {};
  if (!token) return res.status(400).json({ error: 'request_id required' });
  // Only jobs this user started (see api/_lib/job-ownership.js).
  let request_id;
  try { request_id = ownedProviderId(context?.actor, 'stt', token); }
  catch (error) { return sendJobOwnershipError(res, error); }
  try {
    fal.config({ credentials: process.env.FAL_API_KEY });
    const model = 'fal-ai/speech-to-text/turbo/stream';
    const status = await fal.queue.status(model, { requestId: String(request_id), logs: true });
    if (status.status === 'COMPLETED') {
      try {
        const result = await fal.queue.result(model, { requestId: String(request_id) });
        // Prefer punctuated/capitalized if available
        const transcript = result?.data?.text || result?.data?.transcript || result?.data?.punctuated || '';
        return res.status(200).json({ status: 'COMPLETED', transcript, request_id: token });
      } catch (e) {
        return res.status(200).json({ status: 'COMPLETED', transcript: '', request_id: token });
      }
    }
    if (status.status === 'FAILED') {
      return res.status(200).json({ status: 'FAILED', error: status?.logs?.map(l=>l.message).join('; ') || 'failed' });
    }
    return res.status(200).json({ status: status.status, progress: status?.logs?.slice(-1)[0]?.message || '' });
  } catch (e) {
    console.error('STT status error:', e);
    return res.status(500).json({ error: 'stt_status_failed', details: e?.message || String(e) });
  }
}

export default withApiAccess(handler, "/api/stt/status");
