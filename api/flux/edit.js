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
    const { prompt, image_url, guidance_scale = 3.5, num_images = 1, safety_tolerance = "2", output_format = "jpeg" } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    if (!image_url) {
      return res.status(400).json({ error: 'Image URL is required' });
    }

    // Configure FAL client with server-side API key
    fal.config({
      credentials: process.env.FAL_API_KEY
    });

    console.log('Backend: Editing image with Flux Kontext Max - Prompt:', prompt, 'Image:', image_url);

    // Set up timeout handling - Vercel Pro allows up to 60s, Hobby allows 10s
    const timeoutMs = 55000; // 55 seconds to be safe with Vercel Pro limits
    let timeoutId;
    let isCompleted = false;

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        if (!isCompleted) {
          console.warn('Backend: Flux Kontext Max edit timeout after', timeoutMs, 'ms');
          reject(new Error('Image editing timed out. The model may be processing - please try again in a moment.'));
        }
      }, timeoutMs);
    });

    const editPromise = fal.subscribe('fal-ai/flux-pro/kontext/max', {
      input: {
        prompt,
        image_url,
        guidance_scale,
        num_images,
        safety_tolerance,
        output_format
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          console.log('Backend: Flux Kontext Max edit progress:', update.logs?.map(log => log.message));
        }
        if (update.status === "COMPLETED") {
          console.log('Backend: Flux Kontext Max edit completed successfully');
        }
      },
    });

    // Race between the edit operation and timeout
    let result;
    try {
      result = await Promise.race([editPromise, timeoutPromise]);
      isCompleted = true;
      clearTimeout(timeoutId);
    } catch (error) {
      isCompleted = true;
      clearTimeout(timeoutId);
      throw error;
    }

    console.log('Backend: Flux Kontext Max edit completed:', result);

    if (!result.data?.images?.[0]?.url) {
      throw new Error('No image URL in response - the model may have failed to generate');
    }

    return res.status(200).json({ 
      imageUrl: result.data.images[0].url,
      success: true 
    });

  } catch (error) {
    console.error('Backend: Flux Kontext Max API error:', error);
    
    // Provide more specific error messages based on error type
    let errorMessage = 'Image editing failed';
    if (error.message?.includes('timeout') || error.message?.includes('timed out')) {
      errorMessage = 'Image editing timed out. The AI model is taking longer than expected. Please try again.';
    } else if (error.message?.includes('queue') || error.message?.includes('capacity')) {
      errorMessage = 'AI model is at capacity. Please try again in a moment.';
    } else if (error.message?.includes('content') || error.message?.includes('safety')) {
      errorMessage = 'Content was rejected by safety filters. Please try a different prompt.';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    return res.status(500).json({ 
      error: errorMessage,
      timeout: error.message?.includes('timeout') || error.message?.includes('timed out'),
      retryable: true
    });
  }
}

export default withApiAccess(handler, "/api/flux/edit");
