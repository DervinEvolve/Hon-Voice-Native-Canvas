import { withApiAccess } from "../_lib/api-access.js";
import { fal } from "@fal-ai/client";

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

    const { prompt, num_images } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing required field: prompt' });
    }

    const result = await fal.subscribe("fal-ai/nano-banana-pro", {
      input: {
        prompt,
        ...(typeof num_images === 'number' && num_images > 0 ? { num_images } : {})
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === 'IN_PROGRESS') {
          try {
            const logs = (update.logs || []).map(l => l.message);
            // Production-safe log (no model names)
            console.log('[AI] image_gen progress', logs);
          } catch {}
        }
      }
    });

    const images = result?.data?.images || [];
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(500).json({ error: 'No images returned' });
    }

    return res.status(200).json({ success: true, images, prompt });
  } catch (error) {
    console.error('[AI] image_gen error:', error);
    return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

export default withApiAccess(handler, "/api/fal/nano-banana");
