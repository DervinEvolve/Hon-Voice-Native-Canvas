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
      image_url,
      prompt,
      duration: rawDuration,
      aspect_ratio = 'auto',
      resolution = '1080p',  // Default to 1080p for higher quality
      generate_audio = false  // Default to no audio
    } = req.body || {};

    if (!image_url || !prompt) {
      return res.status(400).json({ 
        error: 'Missing required fields: image_url and prompt are required' 
      });
    }

    // Normalize duration to Veo 3.1 format (must be 4s, 6s, or 8s)
    const normalizeDuration = (d) => {
      if (!d) return '4s';
      const num = String(d).replace(/s$/i, '');
      if (['4', '6', '8'].includes(num)) return `${num}s`;
      return '4s'; // Default to fastest
    };
    const duration = normalizeDuration(rawDuration);

    // Configure fal client
    fal.config({ credentials: FAL_KEY });

    // Build webhook URL (optional) for faster completion push
    // Results are polled through the authenticated status route.


    console.log('[Veo 3.1 i2v] Submitting request via fal.queue.submit');
    // Enforce allowed aspect ratios per docs (only 16:9 or 9:16)
    const ar = (aspect_ratio === '16:9' || aspect_ratio === '9:16') ? aspect_ratio : '16:9';

    const submit = await fal.queue.submit('fal-ai/veo3.1/fast/image-to-video', {
      input: {
        image_url,
        prompt,
        duration,
        aspect_ratio: ar,
        resolution,
        generate_audio
      },
    });

    console.log('[Veo 3.1 i2v] Request submitted:', submit);

    return res.status(202).json({
      request_id: issueJobToken(submit.request_id),
      status: 'queued',
      message: 'Veo 3.1 image-to-video generation started'
    });

  } catch (error) {
    console.error('[Veo 3.1 i2v] Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error?.message || 'Unknown error' 
    });
  }
}

export default withApiAccess(handler, "/api/veo31/image-to-video");
