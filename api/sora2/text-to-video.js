import { withApiAccess } from "../_lib/api-access.js";
import { jobTokenIssuer, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from '@fal-ai/client';

 async function handler(req, res, context) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed, use POST' });
  // Check job ownership signing before any provider call.
  let issueJobToken;
  try { issueJobToken = jobTokenIssuer(context?.actor, 'sora2'); }
  catch (error) { return sendJobOwnershipError(res, error); }

  try {
    const { prompt = '', resolution = '1080p', aspect_ratio = '16:9', duration = 4 } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    if (!process.env.FAL_API_KEY) {
      console.error('Missing FAL_API_KEY');
      return res.status(500).json({ error: 'Server misconfigured: missing FAL_API_KEY' });
    }
    fal.config({ credentials: process.env.FAL_API_KEY });

    const baseInput = { prompt, resolution, aspect_ratio, duration };

    // Path A: always use OpenAI if explicitly enabled
    if (process.env.SORA_USE_OPENAI === '1' && process.env.OPENAI_API_KEY) {
      const { request_id } = await fal.queue.submit('fal-ai/sora-2/text-to-video/pro', {
        input: { ...baseInput, api_key: process.env.OPENAI_API_KEY },
        webhookUrl: null,
      });
      return res.status(202).json({ request_id: issueJobToken(request_id), status: 'IN_QUEUE', model: 'sora2-text-to-video' });
    }

    // Path B: try FAL credits first, fallback to OpenAI if insufficient credits
    let request_id;
    try {
      ({ request_id } = await fal.queue.submit('fal-ai/sora-2/text-to-video/pro', {
        input: baseInput,
        webhookUrl: null,
      }));
    } catch (err) {
      const msg = err?.message?.toLowerCase?.() || '';
      const canFallback = !!process.env.OPENAI_API_KEY;
      const isCreditError = msg.includes('insufficient') || msg.includes('balance') || msg.includes('payment') || msg.includes('402');
      if (canFallback && isCreditError) {
        ({ request_id } = await fal.queue.submit('fal-ai/sora-2/text-to-video/pro', {
          input: { ...baseInput, api_key: process.env.OPENAI_API_KEY },
          webhookUrl: null,
        }));
      } else {
        throw err;
      }
    }

    return res.status(202).json({ request_id: issueJobToken(request_id), status: 'IN_QUEUE', model: 'sora2-text-to-video' });
  } catch (error) {
    console.error('Sora2 text-to-video submit error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to submit Sora2 text-to-video' });
  }
}

export default withApiAccess(handler, "/api/sora2/text-to-video");
