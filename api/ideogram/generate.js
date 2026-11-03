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
    const { 
      prompt, 
      style = "auto", 
      aspect_ratio = "1:1", 
      negative_prompt = "", 
      expand_prompt = true, 
      seed 
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Configure FAL client with server-side API key
    fal.config({
      credentials: process.env.FAL_API_KEY
    });

    console.log('Backend: Generating image with Ideogram - Prompt:', prompt);

    const result = await fal.subscribe("fal-ai/ideogram/v2", {
      input: {
        prompt,
        style,
        aspect_ratio,
        negative_prompt,
        expand_prompt,
        ...(seed !== undefined && { seed })
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          console.log('Backend: Ideogram generation progress:', update.logs?.map(log => log.message));
        }
      },
    });

    console.log('Backend: Ideogram generation completed:', result);

    if (!result.data?.images?.[0]?.url) {
      return res.status(500).json({ error: 'No image URL in response' });
    }

    return res.status(200).json({ 
      imageUrl: result.data.images[0].url,
      success: true 
    });

  } catch (error) {
    console.error('Backend: Ideogram API error:', error);
    return res.status(500).json({ error: error.message || 'Image generation failed' });
  }
}

export default withApiAccess(handler, "/api/ideogram/generate");
