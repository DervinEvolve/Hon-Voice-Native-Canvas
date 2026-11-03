import { withApiAccess } from "../_lib/api-access.js";
import { ownedProviderId, sendJobOwnershipError } from "../_lib/job-ownership.js";
// Query Replicate prediction status via REST API (no client import)

 async function handler(req, res, context) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed, use GET' });

  try {
    const replicateKey = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY || process.env.REPLICATE_KEY;
    if (!replicateKey) return res.status(500).json({ error: 'Service configuration error' });

    if (!req.query?.request_id) return res.status(400).json({ error: 'request_id is required' });
    // Only this user's Hunyuan3D jobs reach the provider.
    let request_id;
    try { request_id = ownedProviderId(context?.actor, 'hunyuan3d', req.query.request_id); }
    catch (error) { return sendJobOwnershipError(res, error); }

    const s = await fetch(`https://api.replicate.com/v1/predictions/${encodeURIComponent(request_id)}`, {
      headers: { 'Authorization': `Token ${replicateKey}` }
    });
    if (!s.ok) {
      const txt = await s.text();
      return res.status(s.status).json({ success: false, error: txt || 'replicate status failed' });
    }
    const prediction = await s.json();

    if (prediction.status === 'succeeded') {
      const out = prediction.output;
      // Robust URL extraction for various output shapes
      const collectUrls = (value) => {
        const urls = [];
        const visit = (v) => {
          if (!v) return;
          if (typeof v === 'string') {
            if (/^https?:\/\//.test(v)) urls.push(v);
            return;
          }
          if (Array.isArray(v)) {
            v.forEach(visit);
            return;
          }
          if (typeof v === 'object') {
            for (const k of Object.keys(v)) visit(v[k]);
          }
        };
        visit(value);
        return urls;
      };
      const urls = collectUrls(out);
      const pickByExt = (exts) => urls.find(u => exts.some(e => u.toLowerCase().includes(e)));
      const glbUrl = pickByExt(['.glb']);
      const meshUrl = pickByExt(['.zip', '.obj', '.ply']);
      // Keep legacy object mappings too
      const obj = (Array.isArray(out) ? out[0] : out) || {};
      const finalGlb = glbUrl || obj?.model_glb?.url || obj?.glb || obj?.model_glb_pbr?.url || null;
      const finalMesh = meshUrl || obj?.model_mesh?.url || obj?.mesh || null;

      return res.status(200).json({
        success: true,
        status: 'COMPLETED',
        modelGlbUrl: finalGlb,
        modelMeshUrl: finalMesh,
        seed: obj?.seed
      });
    }

    return res.status(200).json({ success: true, status: String(prediction.status || 'processing').toUpperCase(), logs: prediction.logs || [] });
  } catch (err) {
    console.error('Hunyuan3D status error:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Unknown error' });
  }
}

export default withApiAccess(handler, "/api/hunyuan3d/status");
