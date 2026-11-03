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
      num_inference_steps = 8,
      seed,
      num_images = 1,
      enable_safety_checker = true,
      enable_prompt_expansion = false,
      output_format = 'png',
      acceleration = 'none'
    } = req.body || {};

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    console.log('[AI] Z-Image Turbo generation:', { prompt: prompt.substring(0, 50) + '...' });

    const result = await fal.subscribe("fal-ai/z-image/turbo", {
      input: {
        prompt,
        image_size,
        num_inference_steps,
        ...(seed !== undefined && { seed }),
        num_images,
        enable_safety_checker,
        enable_prompt_expansion,
        output_format,
        acceleration
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === 'IN_PROGRESS') {
          console.log('[AI] Z-Image Turbo progress:', update.logs?.map(l => l.message));
        }
      }
    });

    const images = result?.data?.images || result?.images || [];
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(500).json({ error: 'No images returned' });
    }

    console.log('[AI] Z-Image Turbo complete');

    return res.status(200).json({
      success: true,
      images,
      imageUrl: images[0]?.url,
      seed: result?.data?.seed || result?.seed
    });
  } catch (error) {
    console.error('[AI] Z-Image Turbo error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Generation failed'
    });
  }
}

export default withApiAccess(handler, "/api/fal/z-image-turbo");
