import { withApiAccess } from "../_lib/api-access.js";
import { fal } from "@fal-ai/client";

 async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed, use POST' });
  }

  try {
    const { prompt, image_size, num_images, seed, enhance_prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    const apiKey = process.env.FAL_API_KEY;
    if (!apiKey) {
      console.error('FAL_API_KEY not set');
      return res.status(500).json({ error: 'Service configuration error' });
    }

    fal.config({ credentials: apiKey });

    const result = await fal.subscribe("fal-ai/bytedance/dreamina/v3.1/text-to-image", {
      input: {
        prompt,
        ...(image_size ? { image_size } : {}),
        ...(typeof num_images === 'number' ? { num_images } : {}),
        ...(typeof seed === 'number' ? { seed } : {}),
        ...(typeof enhance_prompt === 'boolean' ? { enhance_prompt } : {}),
      },
      logs: true,
    });

    const images = result?.data?.images || result?.images;
    if (!images || !images.length) {
      return res.status(500).json({ error: 'Dreamina did not return images', debug: result });
    }
    return res.status(200).json({ images: images.map((i) => i.url) });
  } catch (error) {
    console.error('Dreamina T2I error:', error);
    return res.status(500).json({ error: error?.message || 'Unknown error' });
  }
}

export default withApiAccess(handler, "/api/dreamina/text-to-image");
