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
    const { 
      prompt, 
      aspect_ratio, 
      num_images, 
      output_format 
    } = req.body || {};
    
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    const apiKey = process.env.FAL_API_KEY || process.env.FAL_AI_API_KEY;
    if (!apiKey) {
      console.error('FAL_API_KEY or FAL_AI_API_KEY not set');
      return res.status(500).json({ error: 'Service configuration error' });
    }

    fal.config({ credentials: apiKey });

    const result = await fal.subscribe("fal-ai/reve/text-to-image", {
      input: {
        prompt,
        ...(aspect_ratio ? { aspect_ratio } : {}),
        ...(typeof num_images === 'number' ? { num_images } : {}),
        ...(output_format ? { output_format } : {}),
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          console.log('Reve generation progress:', update.logs?.map(log => log.message));
        }
      },
    });

    const images = result?.data?.images || result?.images;
    if (!images || !images.length) {
      return res.status(500).json({ error: 'Reve did not return images', debug: result });
    }
    return res.status(200).json({ images: images.map((i) => i.url) });
  } catch (error) {
    console.error('Reve T2I error:', error);
    return res.status(500).json({ error: error?.message || 'Unknown error' });
  }
}

export default withApiAccess(handler, "/api/reve/text-to-image");
