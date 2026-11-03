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
    const { image_url, prompt, motion_id, seed, enhance_prompt } = req.body || {};
    if (!image_url) {
      return res.status(400).json({ error: 'image_url is required' });
    }
    if (!motion_id || typeof motion_id !== 'string') {
      return res.status(400).json({ error: 'motion_id is required' });
    }

    const payload = {
      params: {
        model: 'dop-turbo',
        ...(prompt ? { prompt } : {}),
        ...(typeof seed === 'number' ? { seed } : {}),
        motions: [{ id: motion_id, strength: 0.5 }],
        input_images: [ { type: 'image_url', image_url } ],
        ...(typeof enhance_prompt === 'boolean' ? { enhance_prompt } : {}),
      }
    };

    const resp = await fetch('https://platform.higgsfield.ai/v1/image2video/dop', {
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
      const stringifyDetail = (d) => {
        try {
          if (!d) return undefined;
          if (typeof d === 'string') return d;
          if (Array.isArray(d)) {
            return d.map((x) => x?.msg || x?.message || JSON.stringify(x)).join('; ');
          }
          return d?.msg || d?.message || JSON.stringify(d);
        } catch {
          return undefined;
        }
      };
      const errors = Array.isArray(data?.errors) ? data.errors.map(e => e.message || JSON.stringify(e)).join('; ') : undefined;
      const detail = stringifyDetail(data?.detail);
      const message = data?.error || data?.message || detail || errors || 'Higgsfield image-to-video failed';
      console.error('[Higgsfield] image2video/dop error:', { status: resp.status, body: data, message });
      return res.status(resp.status).json({ error: message, details: data });
    }

    const requestId = data?.job_set_id || data?.id || data?.jobSetId;
    if (!requestId) {
      return res.status(500).json({ error: 'Missing job_set_id in Higgsfield response', details: data });
    }
    return res.status(202).json({ request_id: issueJobToken(requestId), status: 'IN_QUEUE' });
  } catch (err) {
    console.error('[Higgsfield] image-to-video error', err);
    return res.status(500).json({ error: 'Internal error', details: String(err) });
  }
}

export default withApiAccess(handler, "/api/higgsfield/image-to-video");
