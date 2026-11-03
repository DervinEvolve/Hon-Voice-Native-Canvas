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
    const { prompt, aspect_ratio = '1:1' } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Configure FAL client with server-side API key
    fal.config({
      credentials: process.env.FAL_API_KEY
    });

    console.log('Luma Photon Flash generation started with prompt:', prompt);

    // Submit the generation request to fal.ai
    const result = await fal.subscribe('fal-ai/luma-photon/flash', {
      input: {
        prompt: prompt.trim(),
        aspect_ratio: aspect_ratio
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          console.log('Luma Photon Flash generation in progress...');
          update.logs?.map((log) => log.message).forEach(console.log);
        }
      },
    });

    console.log('Luma Photon Flash generation completed:', result);

    // Extract the image URL from the response
    const imageUrl = result.data?.images?.[0]?.url;
    
    if (!imageUrl) {
      console.error('No image URL in Luma Photon Flash response:', result);
      throw new Error('No image URL in response');
    }

    return res.status(200).json({
      imageUrl,
      requestId: result.requestId,
      data: result.data
    });

  } catch (error) {
    console.error('Luma Photon Flash generation error:', error);
    
    // Handle specific error types
    let errorMessage = 'Image generation failed';
    if (error.message?.includes('safety')) {
      errorMessage = 'Content rejected by safety filter. Please try a different prompt.';
    } else if (error.message?.includes('quota') || error.message?.includes('limit')) {
      errorMessage = 'Service temporarily unavailable. Please try again later.';
    } else if (error.message?.includes('timeout')) {
      errorMessage = 'Generation timed out. Please try again.';
    }

    return res.status(500).json({ 
      error: errorMessage,
      details: error.message 
    });
  }
}

export default withApiAccess(handler, "/api/luma/photon-flash");
