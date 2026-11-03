import { withApiAccess } from "../_lib/api-access.js";
import { ownedProviderId, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from "@fal-ai/client";

fal.config({ credentials: process.env.FAL_API_KEY });

 async function handler(req, res, context) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!req.query.requestId) return res.status(400).json({ error: 'Request ID is required' });
  // Only this user's Marey jobs reach the provider.
  let requestId;
  try { requestId = ownedProviderId(context?.actor, 'marey', req.query.requestId); }
  catch (error) { return sendJobOwnershipError(res, error); }
  try {
    const status = await fal.queue.status('moonvalley/marey/t2v', {
      requestId,
      logs: false,
    });
    if (status.status === 'COMPLETED' && status.response_url) {
      const resultResponse = await fetch(status.response_url, {
        headers: {
          'Authorization': `Key ${process.env.FAL_API_KEY}`,
          'Content-Type': 'application/json',
        }
      });
      const resultData = await resultResponse.json();
      return res.status(200).json({ status: 'COMPLETED', result: resultData });
    }
    return res.status(200).json(status);
  } catch (error) {
    console.error('Marey status error:', error);
    return res.status(500).json({ error: 'Failed to fetch Marey status', details: error?.message });
  }
}

export default withApiAccess(handler, "/api/marey/status");
