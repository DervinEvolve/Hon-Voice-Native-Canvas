import { withApiAccess } from "../_lib/api-access.js";
import { fal } from "@fal-ai/client";

/**
 * Ovis Image API endpoint
 * https://fal.ai/models/fal-ai/ovis-image/api
 * 
 * Ovis-Image is a 7B text-to-image model specifically optimized for 
 * quick, high quality text rendering.
 */
 async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed, use POST' });
  }

  try {
    const falApiKey = process.env.FAL_API_KEY;
    if (!falApiKey) {
      console.error('FAL_API_KEY environment variable not set');
      return res.status(500).json({ error: 'Service configuration error' });
    }
    fal.config({ credentials: falApiKey });

    const {
      prompt,
      negative_prompt,
      image_size,
      num_inference_steps,
      guidance_scale,
      seed,
      num_images,
      enable_safety_checker,
      output_format,
      acceleration
    } = req.body || {};

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing required field: prompt' });
    }

    const result = await fal.subscribe("fal-ai/ovis-image", {
      input: {
        prompt,
        ...(negative_prompt && { negative_prompt }),
        ...(image_size && { image_size }),
        ...(num_inference_steps && { num_inference_steps }),
        ...(guidance_scale !== undefined && { guidance_scale }),
        ...(seed !== undefined && { seed }),
        ...(num_images && { num_images }),
        ...(enable_safety_checker !== undefined && { enable_safety_checker }),
        ...(output_format && { output_format }),
        ...(acceleration && { acceleration })
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === 'IN_PROGRESS') {
          try {
            const logs = (update.logs || []).map(l => l.message);
            console.log('[Ovis-Image] progress:', logs);
          } catch {}
        }
      }
    });

    const images = result?.data?.images || [];
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(500).json({ error: 'No images returned from Ovis-Image' });
    }

    return res.status(200).json({
      success: true,
      images,
      seed: result?.data?.seed,
      has_nsfw_concepts: result?.data?.has_nsfw_concepts,
      timings: result?.data?.timings,
      prompt: result?.data?.prompt || prompt
    });
  } catch (error) {
    console.error('[Ovis-Image] API error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withApiAccess(handler, "/api/fal/ovis-image");
