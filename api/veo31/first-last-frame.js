import { withApiAccess } from "../_lib/api-access.js";
import { jobTokenIssuer, JobOwnershipError } from "../_lib/job-ownership.js";
 async function handler(req, res, context) {
  // Check job ownership signing before any provider call.
  let issueJobToken;
  if (req.method === 'POST') {
    try { issueJobToken = jobTokenIssuer(context?.actor, 'veo31'); }
    catch (error) { return res.status(error instanceof JobOwnershipError ? error.status : 503).json({ error: error.message }); }
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const FAL_KEY = process.env.FAL_API_KEY || process.env.FAL_KEY;
  if (!FAL_KEY) {
    console.error('FAL_API_KEY not configured');
    return res.status(500).json({ error: 'FAL API key not configured' });
  }

  try {
    const {
      first_frame_url,
      last_frame_url,
      prompt,
      duration = '8s',
      aspect_ratio = 'auto',
      resolution = '720p',
      generate_audio = true
    } = req.body;

    if (!first_frame_url || !last_frame_url || !prompt) {
      return res.status(400).json({ 
        error: 'Missing required fields: first_frame_url, last_frame_url, and prompt are required' 
      });
    }

    console.log('[Veo 3.1] Submitting first-last frame request:', {
      first_frame_url: first_frame_url.substring(0, 50) + '...',
      last_frame_url: last_frame_url.substring(0, 50) + '...',
      prompt: prompt.substring(0, 100),
      duration,
      aspect_ratio,
      resolution,
      generate_audio
    });

    // Submit to Fal.ai queue
    const submitResponse = await fetch('https://queue.fal.run/fal-ai/veo3.1/fast/first-last-frame-to-video', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${FAL_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        first_frame_url,
        last_frame_url,
        prompt,
        duration,
        aspect_ratio,
        resolution,
        generate_audio
      })
    });

    if (!submitResponse.ok) {
      const errorData = await submitResponse.json().catch(() => ({}));
      console.error('[Veo 3.1] Submit failed:', errorData);
      return res.status(submitResponse.status).json({ 
        error: errorData.detail || 'Failed to submit Veo 3.1 request',
        details: errorData
      });
    }

    const submitData = await submitResponse.json();
    console.log('[Veo 3.1] Request submitted:', submitData);

    return res.status(202).json({
      request_id: issueJobToken(submitData.request_id),
      status: 'queued',
      message: 'Veo 3.1 video generation started'
    });

  } catch (error) {
    console.error('[Veo 3.1] Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}

export default withApiAccess(handler, "/api/veo31/first-last-frame");
