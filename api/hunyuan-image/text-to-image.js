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
      negative_prompt, 
      image_size, 
      num_images, 
      num_inference_steps, 
      guidance_scale, 
      seed, 
      enable_safety_checker, 
      output_format, 
      enable_prompt_expansion 
    } = req.body || {};
    
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    const apiKey = process.env.FAL_API_KEY || process.env.FAL_AI_API_KEY;
    if (!apiKey) {
      console.error('FAL_API_KEY or FAL_AI_API_KEY not set');
      return res.status(500).json({ error: 'Service configuration error' });
    }

    fal.config({ credentials: apiKey });

    const result = await fal.subscribe("fal-ai/hunyuan-image/v3/text-to-image", {
      input: {
        prompt,
        ...(negative_prompt ? { negative_prompt } : {}),
        ...(image_size ? { image_size } : {}),
        ...(typeof num_images === 'number' ? { num_images } : {}),
        ...(typeof num_inference_steps === 'number' ? { num_inference_steps } : {}),
        ...(typeof guidance_scale === 'number' ? { guidance_scale } : {}),
        ...(typeof seed === 'number' ? { seed } : {}),
        ...(typeof enable_safety_checker === 'boolean' ? { enable_safety_checker } : {}),
        ...(output_format ? { output_format } : {}),
        ...(typeof enable_prompt_expansion === 'boolean' ? { enable_prompt_expansion } : {}),
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          console.log('Hunyuan Image v3 generation progress:', update.logs?.map(log => log.message));
        }
      },
    });

    const images = result?.data?.images || result?.images;
    if (!images || !images.length) {
      return res.status(500).json({ error: 'Hunyuan Image v3 did not return images', debug: result });
    }
    return res.status(200).json({ images: images.map((i) => i.url) });
  } catch (error) {
    console.error('Hunyuan Image v3 T2I error:', error);
    return res.status(500).json({ error: error?.message || 'Unknown error' });
  }
}

export default withApiAccess(handler, "/api/hunyuan-image/text-to-image");
