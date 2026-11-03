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
    const { image_url, prompt, aspect_ratio, duration, negative_prompt, seed, dimension } = req.body || {};
    if (!image_url || !prompt) return res.status(400).json({ error: 'Missing image_url or prompt' });

    const apiKey = process.env.FAL_API_KEY;
    if (!apiKey) {
      console.error('FAL_API_KEY not set');
      return res.status(500).json({ error: 'Service configuration error' });
    }

    fal.config({ credentials: apiKey });

    const result = await fal.subscribe("moonvalley/marey/i2v", {
      input: {
        prompt,
        image_url,
        ...(aspect_ratio ? { aspect_ratio } : {}),
        ...(dimension ? { dimension } : {}),
        ...(duration ? { duration } : {}),
        ...(negative_prompt ? { negative_prompt } : {}),
        ...(typeof seed === 'number' ? { seed } : {})
      },
      logs: true,
    });

    const url = result?.data?.video?.url || result?.video?.url;
    if (!url) {
      return res.status(500).json({ error: 'Marey i2v did not return a video URL', debug: result });
    }
    return res.status(200).json({ videoUrl: url });
  } catch (error) {
    console.error('Marey i2v error:', error);
    return res.status(500).json({ error: error?.message || 'Unknown error' });
  }
}

export default withApiAccess(handler, "/api/marey/image-to-video");
