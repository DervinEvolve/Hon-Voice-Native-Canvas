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
    const { prompt, referenceImage } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Configure FAL client with server-side API key
    fal.config({
      credentials: process.env.FAL_API_KEY
    });

    console.log('Backend: Starting Luma Photon Flash generation - Prompt:', prompt);

    // Create input for Luma Photon Flash model
    const input = {
      prompt,
      // Note: Luma Photon on Fal doesn't directly support style references
      // For advanced usage, this could be expanded with referenceImage
    };

    const result = await fal.subscribe("fal-ai/luma-photon/flash", {
      input,
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          console.log('Backend: Luma Photon generation progress:', update.logs?.map(log => log.message));
        }
      },
    });

    console.log('Backend: Luma Photon generation completed:', result);

    if (!result.data?.images?.[0]?.url) {
      return res.status(500).json({ error: 'No image URL in response' });
    }

    return res.status(200).json({ 
      imageUrl: result.data.images[0].url,
      success: true 
    });

  } catch (error) {
    console.error('Backend: Luma Photon API error:', error);
    return res.status(500).json({ error: error.message || 'Image generation failed' });
  }
}

export default withApiAccess(handler, "/api/luma/photon");
