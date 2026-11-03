import { withApiAccess } from "../_lib/api-access.js";
import { fal } from "@fal-ai/client";

 async function handler(req, res) {
  // CORS
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
    const falApiKey = process.env.FAL_API_KEY;
    if (!falApiKey) {
      return res.status(500).json({ error: 'FAL_API_KEY not configured' });
    }
    fal.config({ credentials: falApiKey });

    const {
      prompt,
      image_size = 'landscape_4_3',
      num_inference_steps = 28,
      seed,
      num_images = 1,
      enable_safety_checker = true,
      output_format = 'png',
      guidance_scale = 3.5
    } = req.body || {};

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    console.log('[AI] Longcat Image generation:', { prompt: prompt.substring(0, 50) + '...' });

    const result = await fal.subscribe("fal-ai/longcat-image", {
      input: {
        prompt,
        image_size,
        num_inference_steps,
        ...(seed !== undefined && { seed }),
        num_images,
        enable_safety_checker,
        output_format,
        guidance_scale
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === 'IN_PROGRESS') {
          console.log('[AI] Longcat Image progress:', update.logs?.map(l => l.message));
        }
      }
    });

    const images = result?.data?.images || result?.images || [];
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(500).json({ error: 'No images returned' });
    }

    console.log('[AI] Longcat Image complete');

    return res.status(200).json({
      success: true,
      images,
      imageUrl: images[0]?.url,
      seed: result?.data?.seed || result?.seed
    });
  } catch (error) {
    console.error('[AI] Longcat Image error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Generation failed'
    });
  }
}

export default withApiAccess(handler, "/api/fal/longcat-image");
