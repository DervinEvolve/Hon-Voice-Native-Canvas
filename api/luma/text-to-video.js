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
      prompt, 
      duration = 5,
      aspect_ratio = '16:9'
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    fal.config({
      credentials: process.env.FAL_API_KEY
    });

    console.log('Backend: Starting Luma text-to-video generation - Prompt:', prompt);

    // Luma has a different input structure
    const input = {
      prompt: prompt,
      guidance_scale: 7.5, // Default guidance scale
      num_frames: duration * 24, // Convert seconds to frames at 24 fps
      width: aspect_ratio === '16:9' ? 512 : 
             aspect_ratio === '9:16' ? 384 :
             aspect_ratio === '1:1' ? 448 : 512,
      height: aspect_ratio === '16:9' ? 288 : 
              aspect_ratio === '9:16' ? 672 :
              aspect_ratio === '1:1' ? 448 : 288
    };

    const result = await fal.subscribe('fal-ai/luma-dream-machine/ray-2-flash', {
      input,
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          console.log('Backend: Luma generation progress:', update.logs?.map(log => log.message));
        }
      },
    });

    console.log('Backend: Luma generation completed:', result);

    // Try different potential paths for the video URL
    const videoUrl = result.data?.output?.video?.url || 
                    result.data?.video?.url || 
                    result.data?.output?.url ||
                    result.data?.url || null;

    if (!videoUrl) {
      return res.status(500).json({ error: 'No video URL in response' });
    }

    return res.status(200).json({
      videoUrl,
      success: true
    });
  } catch (error) {
    console.error('Backend: Luma API error:', error);
    return res.status(500).json({ error: error.message || 'Video generation failed' });
  }
}

export default withApiAccess(handler, "/api/luma/text-to-video");
