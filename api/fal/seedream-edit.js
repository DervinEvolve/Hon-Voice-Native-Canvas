import { withApiAccess } from "../_lib/api-access.js";
import { fal } from '@fal-ai/client';

 async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const apiKey = process.env.FAL_API_KEY || process.env.FAL_AI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Service configuration error' });
    fal.config({ credentials: apiKey });

    // Accepts: prompt (string), image_url (single) OR image_urls (array) and optional refs[] (compat)
    const { prompt, image_url, image_urls, mask_url, negative_prompt, strength, seed, refs } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    // Collect all reference images into a single array
    // Seedream v4.5 Edit expects image_urls as an array
    const allUrls = [];
    if (image_url && typeof image_url === 'string' && /^https?:\/\//.test(image_url)) {
      allUrls.push(image_url);
    }
    if (Array.isArray(image_urls)) {
      allUrls.push(...image_urls.filter((u) => typeof u === 'string' && /^https?:\/\//.test(u)));
    }
    if (Array.isArray(refs)) {
      allUrls.push(...refs.filter((u) => typeof u === 'string' && /^https?:\/\//.test(u)));
    }

    // Deduplicate and limit to 4 reference images
    const uniqueUrls = [...new Set(allUrls)].slice(0, 4);

    if (uniqueUrls.length === 0) {
      return res.status(400).json({ error: 'At least one reference image URL is required' });
    }

    // Build edit input - Seedream v4.5 Edit uses image_urls array format
    const input = {
      prompt,
      image_urls: uniqueUrls,
      ...(mask_url && { mask_url }),
      ...(negative_prompt && { negative_prompt }),
      ...(strength !== undefined && { strength }),
      ...(seed !== undefined && { seed }),
    };

    console.log('[Seedream v4.5 Edit] Submitting:', { prompt: prompt.slice(0, 100), image_count: uniqueUrls.length });

    const result = await fal.subscribe('fal-ai/bytedance/seedream/v4.5/edit', {
      input,
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === 'IN_PROGRESS') {
          console.log('Seedream v4.5 edit progress:', update.logs?.map(l => l.message));
        }
      }
    });

    const images = result?.data?.images || [];
    if (!images.length) return res.status(500).json({ error: 'No images in response' });

    console.log('[Seedream v4.5 Edit] Success:', { output_count: images.length });

    // Return all images for batch support, plus imageUrl for backwards compatibility
    return res.status(200).json({
      success: true,
      imageUrl: images[0]?.url,
      images: images.map(img => ({ url: img.url, width: img.width, height: img.height }))
    });
  } catch (err) {
    const status = err?.status || 500;
    const body = err?.body || null;
    // Log full error detail for debugging
    console.error('Seedream v4.5 edit error:', {
      status,
      body: JSON.stringify(body, null, 2),
      message: err?.message
    });
    return res.status(status).json({
      error: err?.message || 'failed',
      detail: body?.detail || body || null
    });
  }
}

export default withApiAccess(handler, "/api/fal/seedream-edit");
