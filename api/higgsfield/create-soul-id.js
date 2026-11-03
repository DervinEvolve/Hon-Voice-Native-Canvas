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
    const { prompt, reference_images, seed } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    // Align with docs: POST /v1/characters with params
    const payload = {
      params: {
        prompt,
        ...(Array.isArray(reference_images) && reference_images.length ? { reference_images } : {}),
        ...(typeof seed === 'number' ? { seed } : {}),
      }
    };

    const resp = await fetch('https://platform.higgsfield.ai/v1/characters', {
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
      const message = data?.error || data?.message || 'Higgsfield Soul ID creation failed';
      return res.status(resp.status).json({ error: message, details: data });
    }

    const requestId = data?.job_set_id || data?.id || data?.jobSetId;
    if (!requestId) {
      return res.status(500).json({ error: 'Missing job_set_id in Higgsfield response', details: data });
    }
    return res.status(202).json({ request_id: issueJobToken(requestId), status: 'IN_QUEUE' });
  } catch (err) {
    console.error('[Higgsfield] create-soul-id error', err);
    return res.status(500).json({ error: 'Internal error', details: String(err) });
  }
}

export default withApiAccess(handler, "/api/higgsfield/create-soul-id");
