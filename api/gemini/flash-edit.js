import { withApiAccess } from "../_lib/api-access.js";
import { fal } from '@fal-ai/client';

 async function handler(req, res) {
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
    const { prompt, image_url } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    if (!image_url) {
      return res.status(400).json({ error: 'Image URL is required' });
    }

    fal.config({
      credentials: process.env.FAL_API_KEY
    });

    console.log('Backend: Starting Gemini Flash Edit - Prompt:', prompt, 'Image:', image_url.substring(0, 50) + '...');

    const result = await fal.subscribe('fal-ai/gemini-flash-edit', {
      input: {
        prompt,
        image_url
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          console.log('Backend: Gemini Flash Edit progress:', update.logs?.map(log => log.message));
        }
      },
    });

    console.log('Backend: Gemini Flash Edit completed:', result);

    const imageUrl = result.data?.image?.url || result.data?.image_url || result.data?.output?.image?.url;
    if (!imageUrl) {
      return res.status(500).json({ error: 'No image URL in response' });
    }

    return res.status(200).json({
      imageUrl,
      success: true
    });
  } catch (error) {
    console.error('Backend: Gemini Flash Edit API error:', error);
    return res.status(500).json({ error: error.message || 'Image editing failed' });
  }
}

export default withApiAccess(handler, "/api/gemini/flash-edit");
