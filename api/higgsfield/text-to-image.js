import { withApiAccess } from "../_lib/api-access.js";
import { jobTokenIssuer, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { assertOwnedSoulId } from "../_lib/character-ownership.js";
 async function handler(req, res, context) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check job signing before the provider is charged.
  let issueJobToken;
  try { issueJobToken = jobTokenIssuer(context?.actor, 'higgsfield'); }
  catch (error) { return sendJobOwnershipError(res, error); }

  // soul_id becomes the provider's custom_reference_id; only the user who
  // saved that character may render with it.
  if (req.body?.soul_id) {
    try { await assertOwnedSoulId(context?.actor, req.body.soul_id); }
    catch (error) { return sendJobOwnershipError(res, error); }
  }

  const apiKey = process.env.HIGGSFIELD_API_KEY;
  const apiSecret = process.env.HIGGSFIELD_SECRET;

  if (!apiKey || !apiSecret) {
    return res.status(500).json({ error: 'Missing HIGGSFIELD_API_KEY or HIGGSFIELD_SECRET' });
  }

  try {
    const {
      prompt,
      aspect_ratio,
      width_and_height,
      soul_id,
      style_id,
      style_strength,
      enhance_prompt,
      seed,
      quality,
      image_reference_url,
      batch_size
    } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt is required' });
    }

    // Map aspect ratio to size if explicit width_and_height not provided
    const allowedSizes = new Set([
      '1152x2048','2048x1152','2048x1536','1536x2048','1344x2016','2016x1344','960x1696','1536x1536','1536x1152','1696x1152','1152x1536','1088x1632','1632x1088'
    ]);
    const mapAspectToSize = (ar) => {
      switch (ar) {
        case '16:9': return '2048x1152';
        case '9:16': return '1152x2048';
        case '4:3': return '1536x1152';
        case '3:4': return '1152x1536';
        default: return '1536x1536';
      }
    };

    let resolvedWH = typeof width_and_height === 'string' && width_and_height.includes('x')
      ? width_and_height
      : mapAspectToSize(aspect_ratio);
    if (!allowedSizes.has(resolvedWH)) {
      // fallback to a safe default
      resolvedWH = mapAspectToSize('1:1');
    }

    // Align with docs: POST /v1/text2image/soul with params
    const payload = {
      params: {
        prompt,
        width_and_height: resolvedWH,
        ...(typeof enhance_prompt === 'boolean' ? { enhance_prompt } : {}),
        ...(style_id ? { style_id } : {}),
        ...(typeof style_strength === 'number' ? { style_strength } : {}),
        ...(quality ? { quality } : {}),
        ...(typeof seed === 'number' ? { seed } : {}),
        ...(soul_id ? { custom_reference_id: soul_id } : {}),
        ...(image_reference_url ? { image_reference: { type: 'image_url', image_url: image_reference_url } } : {}),
        batch_size: typeof batch_size === 'number' ? batch_size : 1,
      }
    };

    const resp = await fetch('https://platform.higgsfield.ai/v1/text2image/soul', {
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
          if (Array.isArray(d)) return d.map(x => x?.msg || x?.message || JSON.stringify(x)).join('; ');
          return d?.msg || d?.message || JSON.stringify(d);
        } catch { return undefined; }
      };
      const detail = stringifyDetail(data?.detail);
      const message = data?.error || data?.message || detail || 'Higgsfield text-to-image failed';
      return res.status(resp.status).json({ error: message, details: data });
    }

    // Normalize to our standard 202 + request_id for polling
    const requestId = data?.id || data?.job_set_id || data?.jobSetId;
    if (!requestId) {
      return res.status(500).json({ error: 'Missing job_set_id in Higgsfield response', details: data });
    }
    return res.status(202).json({ request_id: issueJobToken(requestId), status: 'IN_QUEUE' });
  } catch (err) {
    console.error('[Higgsfield] text-to-image error', err);
    return res.status(500).json({ error: 'Internal error', details: String(err) });
  }
}

export default withApiAccess(handler, "/api/higgsfield/text-to-image");
