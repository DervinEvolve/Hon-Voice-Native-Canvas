import { withApiAccess } from "../_lib/api-access.js";
import { jobTokenIssuer, JobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from '@fal-ai/client';

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
      image_urls,
      prompt,
      duration = '8s',
      resolution = '720p',
      generate_audio = true
    } = req.body || {};

    if (!image_urls || !Array.isArray(image_urls) || image_urls.length === 0) {
      return res.status(400).json({ 
        error: 'Missing required field: image_urls (array of URLs) is required' 
      });
    }

    if (!prompt) {
      return res.status(400).json({ 
        error: 'Missing required field: prompt is required' 
      });
    }

    // Configure fal client
    fal.config({ credentials: FAL_KEY });

    // Optional webhook for faster completion
    // Results are polled through the authenticated status route.


    console.log('[Veo 3.1 reference-to-video] Submitting via fal.queue.submit');
    const submit = await fal.queue.submit('fal-ai/veo3.1/reference-to-video', {
      input: {
        image_urls,
        prompt,
        duration,
        resolution,
        generate_audio
      },
    });

    console.log('[Veo 3.1 reference-to-video] Request submitted:', submit);

    return res.status(202).json({
      request_id: issueJobToken(submit.request_id),
      status: 'queued',
      message: 'Veo 3.1 reference-to-video generation started'
    });

  } catch (error) {
    console.error('[Veo 3.1 reference-to-video] Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error?.message || 'Unknown error' 
    });
  }
}

export default withApiAccess(handler, "/api/veo31/reference-to-video");
