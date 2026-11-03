import { withApiAccess } from "../_lib/api-access.js";
import { jobTokenIssuer, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from "@fal-ai/client";

 async function handler(req, res, context) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed, use POST' });
  }

  // Check job signing before the provider is charged.
  let issueJobToken;
  try { issueJobToken = jobTokenIssuer(context?.actor, 'marey'); }
  catch (error) { return sendJobOwnershipError(res, error); }

  try {
    const { prompt, aspect_ratio, duration, negative_prompt, seed, image_url } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    const apiKey = process.env.FAL_API_KEY;
    if (!apiKey) {
      console.error('FAL_API_KEY not set');
      return res.status(500).json({ error: 'Service configuration error' });
    }

    fal.config({ credentials: apiKey });

    // Use Queue submit to avoid Vercel 300s timeout; client will poll status
    const submit = await fal.queue.submit("moonvalley/marey/t2v", {
      input: {
        prompt,
        ...(aspect_ratio ? { aspect_ratio } : {}),
        ...(duration ? { duration } : {}),
        ...(negative_prompt ? { negative_prompt } : {}),
        ...(typeof seed === 'number' ? { seed } : {}),
        ...(image_url ? { image_url } : {}),
      },
      webhookUrl: undefined,
    });

    if (!submit?.request_id) {
      return res.status(500).json({ error: 'Failed to submit Marey job' });
    }
    return res.status(202).json({ request_id: issueJobToken(submit.request_id) });
  } catch (error) {
    console.error('Marey T2V submit error:', error);
    return res.status(500).json({ error: error?.message || 'Unknown error' });
  }
}

export default withApiAccess(handler, "/api/marey/text-to-video");
