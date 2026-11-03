import { withApiAccess } from "../_lib/api-access.js";
import { fal } from '@fal-ai/client';

 async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { image_url, sync_mode = false, enable_safety_checker = true } = req.body;

    if (!image_url) {
      return res.status(400).json({ error: 'Image URL is required' });
    }

    // Configure FAL client with server-side API key
    fal.config({
      credentials: process.env.FAL_API_KEY
    });

    console.log('Recraft Crisp Upscale started with image:', image_url);

    // Submit the upscale request to fal.ai
    const result = await fal.subscribe('fal-ai/recraft/upscale/crisp', {
      input: {
        image_url: image_url.trim(),
        sync_mode,
        enable_safety_checker
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          console.log('Recraft Crisp Upscale in progress...');
          update.logs?.map((log) => log.message).forEach(console.log);
        }
      },
    });

    console.log('Recraft Crisp Upscale completed:', result);

    // Extract the upscaled image URL from the response
    const upscaledImageUrl = result.data?.image?.url;
    
    if (!upscaledImageUrl) {
      console.error('No upscaled image URL in Recraft response:', result);
      throw new Error('No upscaled image URL in response');
    }

    return res.status(200).json({
      upscaledImageUrl,
      requestId: result.requestId,
      data: result.data
    });

  } catch (error) {
    console.error('Recraft Crisp Upscale error:', error);
    
    // Handle specific error types
    let errorMessage = 'Image upscaling failed';
    if (error.message?.includes('safety')) {
      errorMessage = 'Content rejected by safety filter. Please try a different image.';
    } else if (error.message?.includes('quota') || error.message?.includes('limit')) {
      errorMessage = 'Service temporarily unavailable. Please try again later.';
    } else if (error.message?.includes('timeout')) {
      errorMessage = 'Upscaling timed out. Please try again.';
    } else if (error.message?.includes('format')) {
      errorMessage = 'Image format not supported. Please use PNG format.';
    }

    return res.status(500).json({ 
      error: errorMessage,
      details: error.message 
    });
  }
}

export default withApiAccess(handler, "/api/recraft/upscale");
