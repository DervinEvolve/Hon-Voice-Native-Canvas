import { withApiAccess } from "../_lib/api-access.js";
import { jobTokenIssuer, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from '@fal-ai/client';

// Configure the fal client with the API key from environment variables
fal.config({
  credentials: process.env.FAL_API_KEY,
});

 async function handler(req, res, context) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check job signing before the provider is charged.
  let issueJobToken;
  try { issueJobToken = jobTokenIssuer(context?.actor, 'kling/image'); }
  catch (error) { return sendJobOwnershipError(res, error); }

  const { prompt, image_url, duration, negative_prompt, cfg_scale } = req.body;

  if (!prompt || !image_url) {
    return res.status(400).json({ error: 'Both prompt and image_url are required' });
  }

  try {
    console.log('Submitting Kling 2.5 Turbo Pro image-to-video generation job...');

    const result = await fal.queue.submit('fal-ai/kling-video/v2.5-turbo/pro/image-to-video', {
      input: {
        prompt,
        image_url,
        duration: duration ? `${duration}` : undefined,
        negative_prompt,
        cfg_scale: cfg_scale !== undefined ? cfg_scale : 0.5, // Default from API spec
      },
      webhookUrl: null,
    });

    console.log('Kling 2.5 Turbo Pro image-to-video job submitted successfully:', result);

    res.status(202).json({
      request_id: issueJobToken(result.request_id),
      status: 'IN_QUEUE'
    });
  } catch (error) {
    console.error('Error submitting job to Kling 2.1 Master (image-to-video):', error);
    res.status(500).json({ 
      error: 'Failed to submit job',
      details: error.message 
    });
  }
}

export default withApiAccess(handler, "/api/kling/image-to-video");
