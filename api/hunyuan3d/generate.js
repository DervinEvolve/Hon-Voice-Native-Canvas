import { withApiAccess } from "../_lib/api-access.js";
// Use Replicate REST API (no client import) for a blocking generate with polling

 async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle OPTIONS method for preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed, use POST' });
  }

  try {
    const { inputImageUrl, options = {} } = req.body;

    // Validate inputs
    if (!inputImageUrl) {
      return res.status(400).json({ error: 'Input image URL is required' });
    }

    const replicateKey = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY || process.env.REPLICATE_KEY;
    if (!replicateKey) {
      console.error('REPLICATE_API_TOKEN environment variable not set');
      return res.status(500).json({ error: 'Service configuration error' });
    }

    console.log('Starting Hunyuan 3D generation...');

    // Map to Replicate input schema
    const steps = options.numInferenceSteps ?? options.steps ?? 50;
    const guidance_scale = options.guidanceScale ?? 7.5;
    const octree_resolution = options.octreeResolution ?? 256;
    const generate_texture = options.texturedMesh ?? true;
    const remove_background = options.removeBackground ?? false;

    const submit = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: { 'Authorization': `Token ${replicateKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: "7c0bbd62ae231320ba0a01b99ef431b295426cf949fb5ffe4f4c83ad5bdaf136",
        input: {
          image: inputImageUrl,
          ...(options.seed !== undefined && { seed: options.seed }),
          steps,
          guidance_scale,
          octree_resolution,
          generate_texture,
          remove_background,
          ...(options.num_chunks !== undefined && { num_chunks: options.num_chunks }),
          ...(options.max_facenum !== undefined && { max_facenum: options.max_facenum })
        }
      })
    });
    if (!submit.ok) {
      const txt = await submit.text();
      throw new Error(`Replicate submit failed: ${txt}`);
    }
    const created = await submit.json();
    let statusRes = await fetch(`https://api.replicate.com/v1/predictions/${created.id}`, { headers: { 'Authorization': `Token ${replicateKey}` } });
    let result = await statusRes.json();
    const t0 = Date.now();
    const timeoutMs = 9 * 60 * 1000;
    while (result.status !== 'succeeded') {
      if (result.status === 'failed' || Date.now() - t0 > timeoutMs) {
        throw new Error(`Replicate prediction ${result.status}`);
      }
      await new Promise(r => setTimeout(r, 4000));
      const next = await fetch(`https://api.replicate.com/v1/predictions/${created.id}`, { headers: { 'Authorization': `Token ${replicateKey}` } });
      result = await next.json();
    }

    const out = result.output || {};
    const data = Array.isArray(out) ? out[0] : out;
    const responseData = {
      success: true,
      modelGlbUrl: data?.model_glb?.url || data?.glb || data?.model_glb_pbr?.url,
      modelMeshUrl: data?.model_mesh?.url || data?.mesh,
      seed: data?.seed
    };

    console.log('Hunyuan 3D generation completed successfully');
    return res.status(200).json(responseData);

  } catch (error) {
    console.error('Hunyuan 3D API error (Replicate):', error);
    
    // Provide more specific error messages based on the error type
    let errorMessage = 'Failed to generate 3D model. Please try again later.';
    
    if (error instanceof Error) {
      if (error.message.includes('429')) {
        errorMessage = 'Too many requests to the AI service. Please try again later.';
      } else if (error.message.includes('403')) {
        errorMessage = 'Access denied. Service configuration error.';
      } else if (error.message.includes('413')) {
        errorMessage = 'Image file is too large. Please use a smaller image.';
      } else if (error.message.includes('400')) {
        errorMessage = 'Invalid request. The AI service could not process the image. Try a different image.';
      } else if (error.message.includes('500')) {
        errorMessage = 'AI service error. Please try again later.';
      }
    }
    
    return res.status(500).json({ error: errorMessage });
  }
}

export default withApiAccess(handler, "/api/hunyuan3d/generate");
