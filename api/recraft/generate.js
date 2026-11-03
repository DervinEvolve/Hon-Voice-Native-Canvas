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
    const { prompt, ...options } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Configure FAL client with server-side API key
    fal.config({
      credentials: process.env.FAL_API_KEY
    });

    console.log('Backend: Starting Recraft V3 generation - Prompt:', prompt);

    const result = await fal.subscribe("fal-ai/recraft-v3", {
      input: {
        prompt,
        ...options
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          console.log('Backend: Recraft generation progress:', update.logs?.map(log => log.message));
        }
      },
    });

    console.log('Backend: Recraft generation completed:', result);

    if (!result.data?.images?.[0]?.url) {
      return res.status(500).json({ error: 'No image URL in response' });
    }

    return res.status(200).json({ 
      imageUrl: result.data.images[0].url,
      success: true 
    });

  } catch (error) {
    console.error('Backend: Recraft V3 API error:', error);
    return res.status(500).json({ error: error.message || 'Image generation failed' });
  }
}

export default withApiAccess(handler, "/api/recraft/generate");
