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
  try { issueJobToken = jobTokenIssuer(context?.actor, 'wan/image'); }
  catch (error) { return sendJobOwnershipError(res, error); }

  try {
    const apiKey = process.env.FAL_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Service configuration error' });
    fal.config({ credentials: apiKey });

    const { prompt, negative_prompt, image_size = 'landscape_4_3', enable_prompt_expansion = true, seed, num_images = 1 } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const submit = await fal.queue.submit('fal-ai/wan-25-preview/text-to-image', {
      input: {
        prompt,
        ...(negative_prompt && { negative_prompt }),
        image_size,
        enable_prompt_expansion,
        ...(typeof seed === 'number' && { seed }),
        num_images
      },
      logs: false
    });
    if (!submit?.request_id) return res.status(500).json({ error: 'Failed to submit WAN t2i job' });
    return res.status(202).json({ request_id: issueJobToken(submit.request_id) });
  } catch (e) {
    console.error('WAN t2i submit error:', e);
    return res.status(500).json({ error: e?.message || 'failed' });
  }
}

export default withApiAccess(handler, "/api/wan/text-to-image");
