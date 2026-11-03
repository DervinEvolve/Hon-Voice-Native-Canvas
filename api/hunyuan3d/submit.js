import { withApiAccess } from "../_lib/api-access.js";
import { jobTokenIssuer, sendJobOwnershipError } from "../_lib/job-ownership.js";
// Submit a Replicate prediction for Hunyuan3D 2.1 without importing the client (use REST API)

 async function handler(req, res, context) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed, use POST' });

  // Check job signing before the provider is charged.
  let issueJobToken;
  try { issueJobToken = jobTokenIssuer(context?.actor, 'hunyuan3d'); }
  catch (error) { return sendJobOwnershipError(res, error); }

  try {
    const replicateKey = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY || process.env.REPLICATE_KEY;
    if (!replicateKey) return res.status(500).json({ error: 'Service configuration error' });

    const { inputImageUrl, options = {} } = req.body || {};
    if (!inputImageUrl) return res.status(400).json({ error: 'Input image URL is required' });

    // Map our options to the Replicate model input schema
    const steps = options.numInferenceSteps ?? options.steps ?? 50;
    const guidance_scale = options.guidanceScale ?? 7.5;
    const octree_resolution = options.octreeResolution ?? 256;
    const generate_texture = options.texturedMesh ?? true;
    const remove_background = options.removeBackground ?? false;
    const seed = options.seed;

    const body = {
      version: "7c0bbd62ae231320ba0a01b99ef431b295426cf949fb5ffe4f4c83ad5bdaf136",
      input: {
        image: inputImageUrl,
        ...(seed !== undefined && { seed }),
        steps,
        guidance_scale,
        octree_resolution,
        generate_texture,
        remove_background,
        ...(options.num_chunks !== undefined && { num_chunks: options.num_chunks }),
        ...(options.max_facenum !== undefined && { max_facenum: options.max_facenum })
      }
    };

    const resp = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${replicateKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const txt = await resp.text();
      return res.status(resp.status).json({ success: false, error: txt || 'replicate submit failed' });
    }
    const json = await resp.json();
    return res.status(200).json({ success: true, request_id: issueJobToken(json?.id) });
  } catch (err) {
    console.error('Hunyuan3D submit error (Replicate):', err);
    // Normalize upstream validation errors
    const status = err?.status || 500;
    const message = err?.message || 'Unknown error';
    try {
      return res.status(status).json({ success: false, error: message });
    } catch {
      return res.status(500).json({ success: false, error: message });
    }
  }
}

export default withApiAccess(handler, "/api/hunyuan3d/submit");
