import { withApiAccess } from "../_lib/api-access.js";
import { jobTokenIssuer, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from '@fal-ai/client';

 async function handler(req, res, context) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check job signing before the provider is charged.
  let issueJobToken;
  try { issueJobToken = jobTokenIssuer(context?.actor, 'kling/video'); }
  catch (error) { return sendJobOwnershipError(res, error); }

  try {
    const {
      prompt,
      negative_prompt = '',
      aspect_ratio = '16:9',
      duration = 5,
      seed
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    fal.config({ credentials: process.env.FAL_API_KEY });

    console.log('Backend: Starting Kling text-to-video generation - Prompt:', prompt);

    const input = {
      prompt,
      negative_prompt,
      aspect_ratio,
      duration: `${duration}`,
      cfg_scale: 0.5
    };
    if (seed !== undefined) input.seed = seed;

    // Queue the job and return immediately with request id to avoid timeouts
    const submit = await fal.queue.submit('fal-ai/kling-video/v2.5-turbo/pro/text-to-video', {
      input,
      webhook: undefined,
      logs: false
    });

    if (!submit?.request_id) {
      console.error('Backend: Failed to submit Kling job:', submit);
      return res.status(500).json({ error: 'Failed to submit Kling job' });
    }

    console.log('Backend: Kling job submitted. request_id:', submit.request_id);
    return res.status(202).json({ request_id: issueJobToken(submit.request_id) });
  } catch (error) {
    console.error('Backend: Kling API error:', error);
    return res.status(500).json({ error: error?.message || 'Video generation failed' });
  }
}

export default withApiAccess(handler, "/api/kling/text-to-video");
