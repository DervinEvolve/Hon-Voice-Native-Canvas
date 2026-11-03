import { withApiAccess } from "../_lib/api-access.js";
import { jobTokenIssuer, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from '@fal-ai/client';

 async function handler(req, res, context) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Check job signing before the provider is charged.
  let issueJobToken;
  try { issueJobToken = jobTokenIssuer(context?.actor, 'kling/pro-image'); }
  catch (error) { return sendJobOwnershipError(res, error); }

  try {
    const apiKey = process.env.FAL_API_KEY || process.env.FAL_AI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Service configuration error' });
    fal.config({ credentials: apiKey });

    const {
      prompt,
      image_url,
      tail_image_url,
      duration = '5',
      negative_prompt,
      cfg_scale = 0.5,
    } = req.body || {};

    if (!image_url) return res.status(400).json({ error: 'image_url is required' });

    const { request_id } = await fal.queue.submit('fal-ai/kling-video/v2.5-turbo/pro/image-to-video', {
      input: {
        ...(prompt && { prompt }),
        image_url,
        ...(tail_image_url && { tail_image_url }),
        ...(duration && { duration: `${duration}` }),
        ...(negative_prompt && { negative_prompt }),
        ...(cfg_scale !== undefined && { cfg_scale }),
      },
    });

    return res.status(202).json({ request_id: issueJobToken(request_id), status: 'IN_QUEUE' });
  } catch (err) {
    console.error('Kling Pro i2v submit error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to submit job' });
  }
}

export default withApiAccess(handler, "/api/kling/pro-image-to-video");
