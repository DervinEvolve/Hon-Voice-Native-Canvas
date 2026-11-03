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
      image_size = 'landscape_4_3', 
      num_inference_steps = 28, 
      guidance_scale = 4.5, 
      num_images = 1, 
      enable_safety_checker = true, 
      output_format = 'jpeg',
      acceleration = 'regular',
      stream = false
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Configure FAL client with server-side API key
    fal.config({
      credentials: process.env.FAL_API_KEY
    });

    console.log('Backend: Generating image with Flux.1 Krea - Prompt:', prompt);

    // If streaming is requested, set up Server-Sent Events
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Send initial progress
      res.write(`data: ${JSON.stringify({ 
        type: 'progress', 
        status: 'starting', 
        message: 'Initializing Flux.1 Krea generation...' 
      })}\n\n`);

      try {
        const stream = await fal.stream('fal-ai/flux-1/krea', {
          input: {
            prompt,
            image_size,
            num_inference_steps,
            guidance_scale,
            num_images,
            enable_safety_checker,
            output_format,
            acceleration
          }
        });

        let progressCount = 0;
        // Stream progress updates with progressive image reveal when available
        for await (const event of stream) {
          progressCount++;
          console.log('Backend: Flux Krea stream event:', typeof event, 'count:', progressCount);
          
          // Check if there's a progressive image available
          let partialImageUrl = null;
          if (event?.images?.[0]?.url) {
            partialImageUrl = event.images[0].url;
          }
          
          // Send progress updates with partial image when available
          const progressData = {
            type: 'progress', 
            status: 'generating',
            message: `Generating with Flux.1 Krea... (${progressCount})`
          };
          
          if (partialImageUrl) {
            progressData.partialImageUrl = partialImageUrl;
          }
          
          res.write(`data: ${JSON.stringify(progressData)}\n\n`);
        }

        // Get final result
        const result = await stream.done();
        console.log('Backend: Flux.1 Krea streaming completed:', result);

        // Check for the correct response structure
        const imageUrl = result.data?.images?.[0]?.url || result.images?.[0]?.url;
        
        if (!imageUrl) {
          console.error('Backend: No image URL found in result:', result);
          res.write(`data: ${JSON.stringify({ 
            type: 'error', 
            error: 'No image URL in response' 
          })}\n\n`);
          return res.end();
        }

        // Send completion event with final image URL
        res.write(`data: ${JSON.stringify({ 
          type: 'complete', 
          imageUrl: imageUrl,
          result: result.data || result
        })}\n\n`);

        res.end();

      } catch (error) {
        console.error('Backend: Flux Krea streaming error:', error);
        res.write(`data: ${JSON.stringify({ 
          type: 'error', 
          error: error.message || 'Stream generation failed' 
        })}\n\n`);
        res.end();
      }

    } else {
      // Non-streaming mode
      const result = await fal.subscribe('fal-ai/flux-1/krea', {
        input: {
          prompt,
          image_size,
          num_inference_steps,
          guidance_scale,
          num_images,
          enable_safety_checker,
          output_format,
          acceleration
        }
      });

      console.log('Backend: Flux.1 Krea completed (non-streaming):', result);

      const imageUrl = result.data?.images?.[0]?.url || result.images?.[0]?.url;
      
      if (!imageUrl) {
        return res.status(500).json({ error: 'No image URL in response' });
      }

      return res.status(200).json({
        imageUrl: imageUrl,
        result: result.data || result
      });
    }

  } catch (error) {
    console.error('Backend: Flux Krea error:', error);
    return res.status(500).json({ 
      error: error.message || 'Image generation failed' 
    });
  }
}

export default withApiAccess(handler, "/api/flux/krea");
