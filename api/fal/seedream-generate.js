import { withApiAccess } from "../_lib/api-access.js";
import { jobTokenIssuer, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from '@fal-ai/client';

 async function handler(req, res, context) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  // Check job ownership signing before any provider call.
  let issueJobToken;
  try { issueJobToken = jobTokenIssuer(context?.actor, 'fal/seedream'); }
  catch (error) { return sendJobOwnershipError(res, error); }
  try {
    const apiKey = process.env.FAL_API_KEY || process.env.FAL_AI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Service configuration error' });
    fal.config({ credentials: apiKey });

    const { prompt, aspect_ratio = '1:1', negative_prompt, seed, refs } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt is required' });
    }

    // Map aspect_ratio -> image_size per Seedream v4.5 docs
    const imageSize = (() => {
      switch (aspect_ratio) {
        case '1:1': return 'square';
        case '16:9': return 'landscape_16_9';
        case '9:16': return 'portrait_16_9';
        case '4:3': return 'landscape_4_3';
        case '3:4': return 'portrait_4_3';
        default: return 'landscape_4_3';
      }
    })();

    // Use queued submit to avoid blocking serverless function
    // Upgraded to Seedream v4.5 for better quality and unified architecture
    let submit;
    try {
      submit = await fal.queue.submit('fal-ai/bytedance/seedream/v4.5/text-to-image', {
        input: {
          prompt,
          image_size: imageSize,
          ...(negative_prompt && { negative_prompt }),
          ...(seed !== undefined && { seed }),
          ...(Array.isArray(refs) && refs.length ? { 
            reference_images: refs
              .filter((u) => typeof u === 'string' && /^https?:\/\//.test(u))
              .slice(0, 4)
              .map((u) => ({ type: 'image_url', image_url: u })),
            num_images: 1
          } : {})
        },
        logs: false
      });
    } catch (e) {
      // Fallback to reference_image_urls format
      if (Array.isArray(refs) && refs.length) {
        submit = await fal.queue.submit('fal-ai/bytedance/seedream/v4.5/text-to-image', {
          input: {
            prompt,
            image_size: imageSize,
            ...(negative_prompt && { negative_prompt }),
            ...(seed !== undefined && { seed }),
            reference_image_urls: refs.filter((u) => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 4),
            num_images: 1
          },
          logs: false
        });
      } else {
        throw e;
      }
    }

    if (!submit?.request_id) {
      console.error('Seedream v4.5 submit failed:', submit);
      return res.status(500).json({ error: 'Failed to submit Seedream v4.5 job' });
    }
    return res.status(202).json({ request_id: issueJobToken(submit.request_id) });
  } catch (err) {
    try {
      // Surface upstream validation details when available
      const status = err?.status || 500;
      const body = err?.body || null;
      console.error('Seedream v4.5 t2i error:', { status, body, message: err?.message });
      return res.status(status).json({ error: err?.message || 'failed', detail: body?.detail || body || null });
    } catch {
      return res.status(500).json({ error: 'failed' });
    }
  }
}

export default withApiAccess(handler, "/api/fal/seedream-generate");
