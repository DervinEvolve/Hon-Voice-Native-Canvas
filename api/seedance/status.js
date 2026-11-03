import { withApiAccess } from "../_lib/api-access.js";
import { ownedProviderId, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from '@fal-ai/client';

 async function handler(req, res, context) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  
  // Handle OPTIONS method for preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed, use GET' });
  }

  try {
    const { request_id: token, model_type } = req.query;

    if (!token) {
      return res.status(400).json({ error: 'request_id is required' });
    }
    // Only jobs this user started (see api/_lib/job-ownership.js).
    let request_id;
    try { request_id = ownedProviderId(context?.actor, 'seedance', token); }
    catch (error) { return sendJobOwnershipError(res, error); }

    // Validate API key
    if (!process.env.FAL_API_KEY) {
      console.error('Missing FAL_API_KEY environment variable');
      return res.status(500).json({ error: 'Server configuration error - missing API key' });
    }
    fal.config({ credentials: process.env.FAL_API_KEY });

    // Determine the model endpoint based on model_type
    let modelEndpoint;
    if (model_type === 'image-to-video') {
      modelEndpoint = 'fal-ai/bytedance/seedance/v1/lite/image-to-video';
    } else {
      // Default to text-to-video
      modelEndpoint = 'fal-ai/bytedance/seedance/v1/lite/text-to-video';
    }

    console.log(`Checking Seedance video generation status: ${request_id}`);

    // Check the status of the generation
    const status = await fal.queue.status(modelEndpoint, {
      requestId: request_id,
      logs: true,
    });

    console.log(`Seedance video generation status for ${request_id}:`, {
      status: status.status,
      completed: status.status === 'COMPLETED'
    });

    // If completed, fetch the result (tolerate brief propagation delay)
    if (status.status === 'COMPLETED') {
      try {
        const result = await fal.queue.result(modelEndpoint, {
          requestId: request_id
        });

        console.log(`Seedance video generation completed for ${request_id}:`, {
          hasVideo: !!result.data?.video?.url,
          videoUrl: result.data?.video?.url?.substring(0, 50) + '...'
        });

        return res.status(200).json({
          status: 'COMPLETED',
          video_url: result.data?.video?.url,
          seed: result.data?.seed,
          request_id: token
        });
      } catch (e) {
        // fal may briefly return 422 right after completion; allow client to poll again
        console.warn(`Result not ready yet for ${request_id} (will continue polling):`, e?.message || e);
        return res.status(200).json({
          status: 'COMPLETED',
          video_url: null,
          request_id: token
        });
      }
    } else if (status.status === 'FAILED') {
      console.error(`Seedance video generation failed for ${request_id}:`, status);
      res.status(200).json({
        status: 'FAILED',
        error: status.logs ? status.logs.map(log => log.message).join('; ') : 'Generation failed',
        request_id: token
      });
    } else {
      // Still in progress
      res.status(200).json({
        status: status.status, // IN_QUEUE, IN_PROGRESS
        progress: status.logs ? status.logs.map(log => log.message).slice(-1)[0] : 'Processing...',
        request_id: token
      });
    }
  } catch (error) {
    console.error('Error checking Seedance video generation status:', error);
    res.status(500).json({ 
      error: 'Failed to check generation status',
      details: error.message 
    });
  }
}

export default withApiAccess(handler, "/api/seedance/status");
