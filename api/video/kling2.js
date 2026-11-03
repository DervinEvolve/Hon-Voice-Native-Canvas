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
    const { 
      imageUrl, 
      prompt = '', 
      aspect_ratio = '16:9', 
      duration = '5',
      cfg_scale = 0.5,
      negative_prompt = 'blur, distort, and low quality'
    } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: 'Image URL is required' });
    }

    fal.config({
      credentials: process.env.FAL_API_KEY
    });

    console.log('Backend: Starting Kling2 video generation - Image:', imageUrl.substring(0, 50) + '...', 'Prompt:', prompt);

    const result = await fal.subscribe('fal-ai/kling-video/v2/master/image-to-video', {
      input: {
        image_url: imageUrl,
        prompt,
        aspect_ratio,
        duration,
        cfg_scale,
        negative_prompt
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          console.log('Backend: Kling2 generation progress:', update.logs?.map(log => log.message));
        }
      },
    });

    console.log('Backend: Kling2 generation completed:', result);

    const videoUrl = result.data?.video?.url;
    if (!videoUrl) {
      return res.status(500).json({ error: 'No video URL in response' });
    }

    return res.status(200).json({
      videoUrl,
      success: true
    });
  } catch (error) {
    console.error('Backend: Kling2 API error:', error);
    return res.status(500).json({ error: error.message || 'Video generation failed' });
  }
}

export default withApiAccess(handler, "/api/video/kling2");
