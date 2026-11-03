import { fetchApprovedAsset } from '../_lib/asset-source.js';
import { withApiAccess } from "../_lib/api-access.js";
/**
 * Anything World - Animate API
 * 
 * Submits a 3D model (from URL or file) to Anything World's AI pipeline
 * for auto-rigging and animation.
 * 
 * POST /api/anythingworld/animate
 * Body: { modelUrl, modelName, modelType, options? }
 * 
 * Returns: { success: true, modelId: string }
 */

import FormData from 'form-data';

 async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const apiKey = process.env.ANYTHING_WORLD_API_KEY;
    if (!apiKey) {
      console.error('[AnythingWorld] Missing API key');
      return res.status(500).json({ error: 'Anything World API key not configured' });
    }

    const { modelUrl, modelName, modelType, options = {} } = req.body || {};

    if (!modelUrl) {
      return res.status(400).json({ error: 'Missing modelUrl' });
    }
    if (!modelName) {
      return res.status(400).json({ error: 'Missing modelName' });
    }

    console.log('[AnythingWorld] Animate request:', { modelUrl, modelName, modelType });

    // Download the model file from the URL
    const modelResponse = await fetchApprovedAsset(modelUrl);
    if (!modelResponse.ok) {
      console.error('[AnythingWorld] Failed to download model:', modelResponse.status);
      return res.status(400).json({ error: 'Failed to download model from URL' });
    }

    const modelBuffer = Buffer.from(await modelResponse.arrayBuffer());
    
    // Determine file extension from URL
    const urlPath = new URL(modelUrl).pathname;
    const extension = urlPath.split('.').pop()?.toLowerCase() || 'glb';
    const fileName = `${modelName.replace(/[^a-zA-Z0-9]/g, '_')}.${extension}`;

    // Map extension to content-type
    const contentTypes = {
      'glb': 'model/gltf-binary',
      'gltf': 'model/gltf+json',
      'fbx': 'application/octet-stream',
      'obj': 'text/plain',
      'dae': 'application/xml',
    };
    const contentType = contentTypes[extension] || 'application/octet-stream';

    // Build form data
    const formData = new FormData();
    formData.append('files', modelBuffer, {
      filename: fileName,
      contentType: contentType,
    });
    formData.append('key', apiKey);
    formData.append('model_name', modelName);
    
    // If model_type is provided, use it; otherwise enable auto_classify
    if (modelType) {
      formData.append('model_type', modelType);
      formData.append('auto_classify', 'false');
    } else {
      formData.append('auto_classify', 'true');
    }

    // Optional parameters
    formData.append('symmetry', options.symmetry || 'true');
    formData.append('auto_rotate', options.autoRotate || 'true');
    formData.append('can_use_for_internal_improvements', 'false');
    formData.append('author', options.author || 'Hon AI');
    formData.append('license', options.license || 'ccby');

    console.log('[AnythingWorld] Submitting to animate endpoint...');

    // Submit to Anything World
    const awResponse = await fetch('https://api.anything.world/animate', {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders(),
    });

    const awData = await awResponse.json();

    if (!awResponse.ok) {
      console.error('[AnythingWorld] API error:', awData);
      return res.status(awResponse.status).json({ 
        error: awData.msg || awData.error || 'Anything World API error',
        code: awData.code 
      });
    }

    if (!awData.model_id) {
      console.error('[AnythingWorld] No model_id in response:', awData);
      return res.status(500).json({ error: 'No model_id returned from Anything World' });
    }

    console.log('[AnythingWorld] Animation submitted:', awData.model_id);

    return res.status(200).json({
      success: true,
      modelId: awData.model_id,
      message: 'Animation processing started. Poll /api/anythingworld/status for progress.',
    });

  } catch (error) {
    console.error('[AnythingWorld] Error:', error);
    return res.status(500).json({ 
      error: error.message || 'Failed to submit animation request' 
    });
  }
}

export default withApiAccess(handler, "/api/anythingworld/animate");
