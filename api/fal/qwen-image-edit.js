import { withApiAccess } from "../_lib/api-access.js";
import { fal } from "@fal-ai/client";

 async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed, use POST' });

  try {
    const falApiKey = process.env.FAL_API_KEY || process.env.FAL_AI_API_KEY;
    if (!falApiKey) return res.status(500).json({ error: 'Service configuration error' });
    fal.config({ credentials: falApiKey });

    const {
      prompt,
      image_url,
      image_size,
      num_inference_steps,
      seed,
      guidance_scale,
      negative_prompt,
      output_format,
      acceleration
    } = req.body || {};

    if (!prompt || !image_url) {
      return res.status(400).json({ error: 'Missing required fields: prompt and image_url' });
    }

    const result = await fal.subscribe("fal-ai/qwen-image-edit", {
      input: {
        prompt,
        image_url,
        ...(image_size && { image_size }),
        ...(num_inference_steps && { num_inference_steps }),
        ...(seed !== undefined && { seed }),
        ...(guidance_scale && { guidance_scale }),
        ...(negative_prompt && { negative_prompt }),
        ...(output_format && { output_format }),
        ...(acceleration && { acceleration }),
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === 'IN_PROGRESS') {
          try { console.log('Qwen-Edit progress:', (update.logs||[]).map(l=>l.message)); } catch {}
        }
      }
    });

    const images = result?.data?.images || result?.data?.image ? [result.data.image] : [];
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(500).json({ error: 'No images returned from Qwen-Image-Edit' });
    }

    return res.status(200).json({ success: true, images, seed: result?.data?.seed, prompt });
  } catch (err) {
    console.error('Qwen-Image-Edit API error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default withApiAccess(handler, "/api/fal/qwen-image-edit");
