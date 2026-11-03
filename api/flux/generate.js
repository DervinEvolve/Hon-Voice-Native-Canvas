import { withApiAccess } from "../_lib/api-access.js";
import { fal } from '@fal-ai/client';

 async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { prompt, image_size = 'landscape_4_3', num_inference_steps = 28, guidance_scale = 3.5, num_images = 1, enable_safety_checker = true, output_format = 'jpeg' } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Configure FAL client with server-side API key
    fal.config({
      credentials: process.env.FAL_API_KEY
    });

    console.log('Backend: Generating image with Flux-1 Dev - Prompt:', prompt);

    const result = await fal.subscribe('fal-ai/flux-1/dev', {
      input: {
        prompt,
        image_size,
        num_inference_steps,
        guidance_scale,
        num_images,
        enable_safety_checker,
        output_format
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          console.log('Backend: Flux-1 Dev generation progress:', update.logs?.map(log => log.message));
        }
      },
    });

    console.log('Backend: Flux-1 Dev generation completed:', result);

    if (!result.data?.images?.[0]?.url) {
      return res.status(500).json({ error: 'No image URL in response' });
    }

    return res.status(200).json({ 
      imageUrl: result.data.images[0].url,
      success: true 
    });

  } catch (error) {
    console.error('Backend: Flux-1 Dev API error:', error);
    return res.status(500).json({ error: error.message || 'Image generation failed' });
  }
}

export default withApiAccess(handler, "/api/flux/generate");
