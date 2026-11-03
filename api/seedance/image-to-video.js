import { withApiAccess } from "../_lib/api-access.js";
import { jobTokenIssuer, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from '@fal-ai/client';

 async function handler(req, res, context) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  
  // Handle OPTIONS method for preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed, use POST' });
  }

  // Check job ownership signing before any provider call.
  let issueJobToken;
  try { issueJobToken = jobTokenIssuer(context?.actor, 'seedance'); }
  catch (error) { return sendJobOwnershipError(res, error); }

  try {
    const { 
      prompt, 
      image_url,
      end_image_url,
      resolution = '720p',
      duration = '5',
      camera_fixed = false,
      seed
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    if (!image_url) {
      return res.status(400).json({ error: 'image_url is required for image-to-video generation' });
    }

    // Validate API key
    if (!process.env.FAL_API_KEY) {
      console.error('Missing FAL_API_KEY environment variable');
      return res.status(500).json({ error: 'Server configuration error - missing API key' });
    }
    fal.config({ credentials: process.env.FAL_API_KEY });

    console.log('Submitting Seedance image-to-video generation job:', {
      prompt: prompt.substring(0, 100) + '...',
      image_url: image_url.substring(0, 50) + '...',
      resolution,
      duration,
      camera_fixed,
      hasEndImage: !!end_image_url
    });

    // Submit job to Seedance Lite Image-to-Video API
    const result = await fal.queue.submit('fal-ai/bytedance/seedance/v1/lite/image-to-video', {
      input: {
        prompt,
        image_url,
        resolution,
        duration,
        camera_fixed,
        ...(end_image_url && { end_image_url }),
        ...(seed !== undefined && { seed })
      },
      webhookUrl: null,
    });

    console.log('Seedance image-to-video job submitted successfully:', result);

    res.status(202).json({
      request_id: issueJobToken(result.request_id),
      status: 'IN_QUEUE',
      model: 'seedance-lite-image-to-video'
    });
  } catch (error) {
    console.error('Error submitting job to Seedance image-to-video:', error);
    res.status(500).json({ 
      error: 'Failed to submit video generation job',
      details: error.message 
    });
  }
}

export default withApiAccess(handler, "/api/seedance/image-to-video");
