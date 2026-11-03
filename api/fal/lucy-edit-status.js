import { withApiAccess } from "../_lib/api-access.js";
import { ownedProviderId, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from "@fal-ai/client";

 async function handler(req, res, context) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = req.query?.requestId;
  if (!token) {
    return res.status(400).json({ error: 'requestId is required' });
  }
  // Only jobs this user started (see api/_lib/job-ownership.js).
  let requestId;
  try { requestId = ownedProviderId(context?.actor, 'fal/lucy-edit', token); }
  catch (error) { return sendJobOwnershipError(res, error); }

  try {
    const falApiKey = process.env.FAL_API_KEY;
    if (!falApiKey) {
      console.error('FAL_API_KEY environment variable not set');
      return res.status(500).json({ error: 'Service configuration error' });
    }
    fal.config({ credentials: falApiKey });

    console.log('[AI] lucy-edit-status check:', requestId);

    // Check status
    const status = await fal.queue.status("decart/lucy-edit/fast", {
      requestId,
      logs: false
    });

    console.log('[AI] lucy-edit-status response:', { requestId, status: status?.status });

    if (status?.status === 'COMPLETED') {
      // Get the result
      const result = await fal.queue.result("decart/lucy-edit/fast", { requestId });

      // Lucy Edit returns video in result.data.video or result.data.video_url
      const videoUrl = result?.data?.video?.url || result?.data?.video_url || result?.data?.video;

      if (!videoUrl) {
        console.error('[AI] lucy-edit completed but no video URL:', result?.data);
        return res.status(500).json({
          id: token,
          status: 'failed',
          error: 'No video output returned'
        });
      }

      console.log('[AI] lucy-edit complete:', { requestId, videoUrl: videoUrl.substring(0, 50) });

      return res.status(200).json({
        id: token,
        status: 'completed',
        output: [videoUrl]
      });
    } else if (status?.status === 'FAILED') {
      console.error('[AI] lucy-edit failed:', { requestId, error: status?.error });
      return res.status(400).json({
        id: token,
        status: 'failed',
        error: status?.error || 'Video editing failed'
      });
    } else {
      // Still processing (QUEUED, IN_PROGRESS, etc.)
      return res.status(200).json({
        id: token,
        status: status?.status?.toLowerCase() || 'processing'
      });
    }

  } catch (error) {
    console.error('[AI] lucy-edit-status error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}

export default withApiAccess(handler, "/api/fal/lucy-edit-status");
