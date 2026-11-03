import { withApiAccess } from "../_lib/api-access.js";
import { fal } from '@fal-ai/client';
import { readJobToken, JobOwnershipError } from "../_lib/job-ownership.js";

 async function handler(req, res, context) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // Prevent caching - status must always be fresh
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const FAL_KEY = process.env.FAL_API_KEY || process.env.FAL_KEY;
  if (!FAL_KEY) {
    console.error('FAL_API_KEY not configured');
    return res.status(500).json({ error: 'FAL API key not configured' });
  }

  // Configure fal client
  fal.config({ credentials: FAL_KEY });

  const { model_type } = req.query;
  if (!req.query.request_id) {
    return res.status(400).json({ error: 'Missing request_id parameter' });
  }
  // Only jobs this user started (see api/_lib/job-ownership.js).
  let request_id;
  try { request_id = readJobToken(context?.actor, 'veo31', req.query.request_id); }
  catch (error) { return res.status(error instanceof JobOwnershipError ? error.status : 503).json({ error: error.message }); }
  if (!request_id) {
    return res.status(404).json({ error: 'Job not found' });
  }

  try {
    // Map model_type to correct Fal endpoint
    const endpoint = model_type === 'first-last-frame' 
      ? 'fal-ai/veo3.1/fast/first-last-frame-to-video'
      : model_type === 'text-to-video'
      ? 'fal-ai/veo3.1/fast'
      : model_type === 'reference-to-video'
      ? 'fal-ai/veo3.1/reference-to-video'
      : 'fal-ai/veo3.1/fast/image-to-video';
    
    console.log(`[Veo 3.1] Checking status - endpoint: ${endpoint}, request_id: ${request_id}`);

    // Use Fal client to check status
    const status = await fal.queue.status(endpoint, { 
      requestId: request_id, 
      logs: true 
    });

    console.log('[Veo 3.1] Status:', status.status);

    // If completed, fetch the result
    if (status.status === 'COMPLETED') {
      // Try direct fetch to fal queue first (more reliable)
      // Fal uses 'fal-ai/veo3.1' for queue URLs, not the full endpoint path
      const queuePaths = [
        `https://queue.fal.run/fal-ai/veo3.1/requests/${request_id}`,
        `https://queue.fal.run/${endpoint}/requests/${request_id}`
      ];
      
      for (const queueUrl of queuePaths) {
        try {
          console.log('[Veo 3.1] Trying queue URL:', queueUrl);
          const resp = await fetch(queueUrl, {
            headers: { 'Authorization': `Key ${FAL_KEY}` }
          });
          if (resp.ok) {
            const data = await resp.json();
            console.log('[Veo 3.1] Queue response:', JSON.stringify(data).substring(0, 300));
            const videoUrl = data?.video?.url || data?.data?.video?.url || data?.output?.video?.url;
            if (videoUrl) {
              console.log('[Veo 3.1] ✅ Video URL found:', videoUrl);
              return res.status(200).json({
                status: 'COMPLETED',
                video_url: videoUrl,
                result: data
              });
            }
          }
        } catch (e) {
          console.log('[Veo 3.1] Queue fetch failed:', e.message);
        }
      }
      
      // Fallback to fal client
      try {
        const result = await fal.queue.result(endpoint, { requestId: request_id });
        console.log('[Veo 3.1] Client result:', JSON.stringify(result).substring(0, 300));
        const videoUrl = result?.data?.video?.url || result?.video?.url;
        if (videoUrl) {
          return res.status(200).json({
            status: 'COMPLETED',
            video_url: videoUrl,
            result: result.data || result
          });
        }
      } catch (e) {
        console.log('[Veo 3.1] Client fetch failed:', e.message);
      }
      
      // Still COMPLETED but no URL yet
      console.warn('[Veo 3.1] COMPLETED but could not fetch video URL');
      return res.status(200).json({
        status: 'COMPLETED',
        video_url: null
      });
    }

    if (status.status === 'FAILED') {
      const errorMsg = status.logs?.map(l => l.message).join('; ') || 'Generation failed';
      console.error('[Veo 3.1] ❌ Failed:', errorMsg);
      return res.status(200).json({ 
        status: 'FAILED', 
        error: errorMsg
      });
    }

    // Still processing
    return res.status(200).json({
      status: status.status,
      logs: status.logs || []
    });

  } catch (error) {
    console.error('[Veo 3.1] Status error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}

export default withApiAccess(handler, "/api/veo31/status");
