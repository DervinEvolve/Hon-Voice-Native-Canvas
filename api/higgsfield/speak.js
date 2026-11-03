import { withApiAccess } from "../_lib/api-access.js";
import { jobTokenIssuer, sendJobOwnershipError } from "../_lib/job-ownership.js";
 async function handler(req, res, context) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check job signing before the provider is charged.
  let issueJobToken;
  try { issueJobToken = jobTokenIssuer(context?.actor, 'higgsfield'); }
  catch (error) { return sendJobOwnershipError(res, error); }

  const apiKey = process.env.HIGGSFIELD_API_KEY;
  const apiSecret = process.env.HIGGSFIELD_SECRET;
  if (!apiKey || !apiSecret) {
    return res.status(500).json({ error: 'Missing HIGGSFIELD_API_KEY or HIGGSFIELD_SECRET' });
  }

  try {
    const { input_image, input_audio, prompt, quality = 'high', enhance_prompt = false, seed, duration = 5 } = req.body?.params || {};

    if (!input_image?.image_url || !input_audio?.audio_url) {
      return res.status(400).json({ error: 'input_image.image_url and input_audio.audio_url are required' });
    }

    const payload = {
      params: {
        input_image: { type: 'image_url', image_url: input_image.image_url },
        input_audio: { type: 'audio_url', audio_url: input_audio.audio_url },
        ...(prompt ? { prompt } : {}),
        ...(quality ? { quality } : {}),
        ...(typeof enhance_prompt === 'boolean' ? { enhance_prompt } : {}),
        ...(typeof seed === 'number' ? { seed } : {}),
        ...(typeof duration === 'number' ? { duration } : {}),
      }
    };

    const resp = await fetch('https://platform.higgsfield.ai/v1/speak/higgsfield', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'hf-api-key': apiKey,
        'hf-secret': apiSecret,
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const message = data?.error || data?.message || 'Higgsfield speak failed';
      return res.status(resp.status).json({ error: message, details: data });
    }

    const requestId = data?.id || data?.job_set_id;
    if (!requestId) {
      return res.status(500).json({ error: 'Missing id in Higgsfield speak response', details: data });
    }
    return res.status(202).json({ request_id: issueJobToken(requestId), status: 'IN_QUEUE' });
  } catch (err) {
    console.error('[Higgsfield] speak error', err);
    return res.status(500).json({ error: 'Internal error', details: String(err) });
  }
}

export default withApiAccess(handler, "/api/higgsfield/speak");
