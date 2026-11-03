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
      prompt,
      duration = '8s',
      aspect_ratio = '16:9',
      resolution = '720p',
      negative_prompt,
      enhance_prompt = true,
      generate_audio = true,
      seed
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ 
        error: 'Missing required field: prompt is required' 
      });
    }

    // Configure fal client
    fal.config({ credentials: FAL_KEY });

    // Optional webhook for faster completion
    // Results are polled through the authenticated status route.


    console.log('[Veo 3.1 t2v] Submitting via fal.queue.submit');
    // Enforce allowed aspect ratios per docs (9:16, 16:9, 1:1). If 1:1, Veo will outpaint.
    const ar = (['9:16','16:9','1:1'].includes(aspect_ratio)) ? aspect_ratio : '16:9';

    const submit = await fal.queue.submit('fal-ai/veo3.1/fast', {
      input: {
        prompt,
        duration,
        aspect_ratio: ar,
        resolution,
        negative_prompt,
        enhance_prompt,
        generate_audio,
        ...(seed !== undefined && { seed })
      },
    });

    console.log('[Veo 3.1 t2v] Request submitted:', submit);

    return res.status(202).json({
      request_id: issueJobToken(submit.request_id),
      status: 'queued',
      message: 'Veo 3.1 text-to-video generation started'
    });

  } catch (error) {
    console.error('[Veo 3.1 t2v] Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}

export default withApiAccess(handler, "/api/veo31/text-to-video");
