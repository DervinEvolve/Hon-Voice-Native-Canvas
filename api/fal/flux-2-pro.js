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
      seed,
      safety_tolerance = '2',
      enable_safety_checker = true,
      output_format = 'jpeg'
    } = req.body || {};

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    console.log('[AI] Flux 2 Pro generation:', { prompt: prompt.substring(0, 50) + '...' });

    const result = await fal.subscribe("fal-ai/flux-2-pro", {
      input: {
        prompt,
        image_size,
        ...(seed !== undefined && { seed }),
        safety_tolerance,
        enable_safety_checker,
        output_format
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === 'IN_PROGRESS') {
          console.log('[AI] Flux 2 Pro progress:', update.logs?.map(l => l.message));
        }
      }
    });

    const images = result?.data?.images || result?.images || [];
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(500).json({ error: 'No images returned' });
    }

    console.log('[AI] Flux 2 Pro complete');

    return res.status(200).json({
      success: true,
      images,
      imageUrl: images[0]?.url,
      seed: result?.data?.seed || result?.seed
    });
  } catch (error) {
    console.error('[AI] Flux 2 Pro error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Generation failed'
    });
  }
}

export default withApiAccess(handler, "/api/fal/flux-2-pro");
