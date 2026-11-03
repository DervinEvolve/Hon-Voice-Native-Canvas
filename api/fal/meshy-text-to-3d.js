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
  try { issueJobToken = jobTokenIssuer(context?.actor, 'fal/meshy'); }
  catch (error) { return sendJobOwnershipError(res, error); }
  try {
    const apiKey = process.env.FAL_API_KEY || process.env.FAL_AI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Service configuration error' });
    fal.config({ credentials: apiKey });

    const body = req.body || {};
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    // Enforce textured output by default
    const mode = body.mode === 'preview' ? 'preview' : 'full';
    const topology = body.topology || 'triangle';
    const enable_pbr = body.enable_pbr === false ? false : true;
    const texture_prompt = body.texture_prompt;
    const texture_image_url = body.texture_image_url;

    console.log('[Meshy] submit', { mode, topology, enable_pbr, hasTexturePrompt: !!texture_prompt, hasTextureImage: !!texture_image_url });

    const submit = await fal.queue.submit('fal-ai/meshy/v6-preview/text-to-3d', {
      input: {
        prompt,
        mode,
        topology,
        enable_pbr,
        art_style: 'realistic',
        should_remesh: true,
        symmetry_mode: 'auto',
        ...(texture_prompt ? { texture_prompt } : {}),
        ...(texture_image_url ? { texture_image_url } : {}),
      },
      logs: false
    });

    if (!submit?.request_id) {
      console.error('[Meshy] submit failed payload:', submit);
      return res.status(500).json({ error: 'meshy_submit_failed' });
    }
    console.log('[Meshy] request_id', submit.request_id);
    return res.status(200).json({ success: true, requestId: issueJobToken(submit.request_id) });
  } catch (e) {
    console.error('[Meshy] submit error', e);
    return res.status(500).json({ success: false, error: e?.message || 'meshy_submit_failed' });
  }
}

export default withApiAccess(handler, "/api/fal/meshy-text-to-3d");
