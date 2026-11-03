import { withApiAccess } from "../_lib/api-access.js";
import { fal } from "@fal-ai/client";

/**
 * Bytedance Seedream v4.5 Text-to-Image API endpoint
 * https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/text-to-image
 * 
 * Seedream 4.5 integrates image generation and image editing capabilities 
 * into a single, unified architecture. Up to 4 megapixels (2048x2048).
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
      num_images,
      seed,
      enable_safety_checker,
      sync_mode
    } = req.body || {};

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing required field: prompt' });
    }

    const result = await fal.subscribe("fal-ai/bytedance/seedream/v4.5/text-to-image", {
      input: {
        prompt,
        ...(negative_prompt && { negative_prompt }),
        ...(image_size && { image_size }),
        ...(num_images && { num_images }),
        ...(seed !== undefined && { seed }),
        ...(enable_safety_checker !== undefined && { enable_safety_checker }),
        ...(sync_mode !== undefined && { sync_mode })
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === 'IN_PROGRESS') {
          try {
            const logs = (update.logs || []).map(l => l.message);
            console.log('[Seedream-v4.5] progress:', logs);
          } catch {}
        }
      }
    });

    const images = result?.data?.images || [];
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(500).json({ error: 'No images returned from Seedream v4.5' });
    }

    return res.status(200).json({
      success: true,
      images,
      seed: result?.data?.seed,
      prompt
    });
  } catch (error) {
    console.error('[Seedream-v4.5] API error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withApiAccess(handler, "/api/fal/seedream-v45");
