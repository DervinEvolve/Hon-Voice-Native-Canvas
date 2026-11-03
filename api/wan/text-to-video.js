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

  // Check job ownership signing before any provider call.
  let issueJobToken;
  try { issueJobToken = jobTokenIssuer(context?.actor, 'wan/video'); }
  catch (error) { return sendJobOwnershipError(res, error); }

  try {
    const { prompt, fps, num_frames, resolution } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    const apiKey = process.env.FAL_API_KEY;
    if (!apiKey) {
      console.error('FAL_API_KEY not set');
      return res.status(500).json({ error: 'Service configuration error' });
    }

    fal.config({ credentials: apiKey });

    // Switch to WAN 2.5 preview via queued submit
    const submit = await fal.queue.submit('fal-ai/wan-25-preview/text-to-video', {
      input: {
        prompt,
        aspect_ratio: '16:9',
        resolution: resolution || '1080p',
        duration: '5',
        enable_prompt_expansion: true
      },
      logs: false
    });
    if (!submit?.request_id) return res.status(500).json({ error: 'Failed to submit WAN 2.5 job' });
    return res.status(202).json({ request_id: issueJobToken(submit.request_id) });
  } catch (error) {
    console.error('WAN T2V error:', error);
    return res.status(500).json({ error: error?.message || 'Unknown error' });
  }
}

export default withApiAccess(handler, "/api/wan/text-to-video");
