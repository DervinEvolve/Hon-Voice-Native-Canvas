import { withApiAccess } from "../_lib/api-access.js";
import { jobTokenIssuer, sendJobOwnershipError } from "../_lib/job-ownership.js";
 async function handler(req, res, context) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle OPTIONS method for preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed, use POST' });
  }

  // Check job signing before the provider is charged.
  let issueJobToken;
  try { issueJobToken = jobTokenIssuer(context?.actor, 'luma/generation'); }
  catch (error) { return sendJobOwnershipError(res, error); }

  try {
    const { videoUrl, imageUrl, prompt, mode = 'adhere_1' } = req.body;

    // Validate required inputs
    if (!videoUrl || !imageUrl) {
      return res.status(400).json({ 
        error: 'Missing required parameters: videoUrl and imageUrl are required' 
      });
    }

    // Validate mode parameter
    const validModes = [
      'adhere_1', 'adhere_2', 'adhere_3',
      'flex_1', 'flex_2', 'flex_3', 
      'reimagine_1', 'reimagine_2', 'reimagine_3'
    ];
    
    if (!validModes.includes(mode)) {
      return res.status(400).json({ 
        error: `Invalid mode. Must be one of: ${validModes.join(', ')}` 
      });
    }

    // Get API key from environment variables - following the pattern used in other Luma APIs
    const LUMA_API_KEY = process.env.LUMAAI_API_KEY || process.env.LUMA_API_KEY;
    
    if (!LUMA_API_KEY) {
      console.error('Missing LUMAAI_API_KEY or LUMA_API_KEY environment variable');
      return res.status(500).json({ error: 'Server configuration error - missing API key' });
    }

    console.log('Using Luma API key (first 10 chars):', LUMA_API_KEY.substring(0, 10) + '...');

    console.log('Starting Luma Ray-2 Flash video modification:', { 
      videoUrl: videoUrl.substring(0, 50) + '...', 
      imageUrl: imageUrl.substring(0, 50) + '...', 
      prompt: prompt || 'No prompt provided',
      mode,
      model: 'ray-flash-2'
    });

    // Build request payload for Luma's modify video API
    const requestPayload = {
      model: 'ray-flash-2', // Using Ray-2 Flash model (3x faster and cheaper)
      prompt: prompt || undefined,
      media: {
        url: videoUrl
      },
      first_frame: {
        url: imageUrl
      },
      mode: mode
    };

    console.log('Sending request to Luma API:', JSON.stringify(requestPayload, null, 2));

    // Make request to Luma's modify video API
    const lumaResponse = await fetch('https://api.lumalabs.ai/dream-machine/v1/generations/video/modify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LUMA_API_KEY}`
      },
      body: JSON.stringify(requestPayload)
    });

    if (!lumaResponse.ok) {
      const errorText = await lumaResponse.text();
      console.error(`Luma API error (${lumaResponse.status}): ${errorText}`);
      
      // Handle specific error cases
      if (lumaResponse.status === 401) {
        return res.status(500).json({ error: 'Authentication failed with Luma API' });
      } else if (lumaResponse.status === 429) {
        return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
      } else if (lumaResponse.status === 400) {
        return res.status(400).json({ error: 'Invalid request parameters for video modification' });
      }
      
      return res.status(lumaResponse.status).json({ 
        error: `Luma API error: ${errorText}` 
      });
    }

    const lumaData = await lumaResponse.json();
    console.log('Luma modify video generation started:', lumaData);

    // Luma API returns a generation ID that we need to poll for completion
    const generationId = lumaData.id;
    if (!generationId) {
      return res.status(500).json({ error: 'Invalid response from Luma API - missing generation ID' });
    }

    // Poll for completion - Luma modify video can take time to process
    let attempts = 0;
    const maxAttempts = 120; // Max 10 minutes (120 * 5 seconds)
    let finalResult = null;

    while (attempts < maxAttempts) {
      // Wait 5 seconds between polls
      await new Promise(resolve => setTimeout(resolve, 5000));
      attempts++;

      try {
        // Check generation status
        const statusResponse = await fetch(`https://api.lumalabs.ai/dream-machine/v1/generations/${generationId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${LUMA_API_KEY}`
        }
        });

        if (!statusResponse.ok) {
          console.error(`Status check failed: ${statusResponse.status}`);
          continue;
        }

        const statusData = await statusResponse.json();
        console.log(`Luma modify status check ${attempts}:`, statusData.state);

        if (statusData.state === 'completed') {
          finalResult = statusData;
          break;
        } else if (statusData.state === 'failed') {
          return res.status(500).json({ 
            error: 'Video modification failed during processing',
            details: statusData.failure_reason || 'Unknown error'
          });
        }
        // Continue polling if state is 'queued' or 'dreaming'
        
      } catch (pollError) {
        console.error('Error during status polling:', pollError);
        // Continue trying
      }
    }

    if (!finalResult) {
      return res.status(408).json({ 
        error: 'Video modification timed out. Please try again with a shorter video.',
        generationId: issueJobToken(generationId) // Lets the user check status later
      });
    }

    // Log the full response to debug the format
    console.log('Final Luma response structure:', JSON.stringify(finalResult, null, 2));

    // Extract the modified video URL from the final result
    // Based on Luma API docs, the response should have assets.video
    const modifiedVideoUrl = finalResult.assets?.video || 
                             finalResult.video?.url || 
                             finalResult.video_url ||
                             finalResult.assets?.video_url;
    
    if (!modifiedVideoUrl) {
      console.error('Could not find video URL in Luma response. Available keys:', Object.keys(finalResult));
      console.error('Assets keys:', finalResult.assets ? Object.keys(finalResult.assets) : 'No assets');
      return res.status(500).json({ 
        error: 'Invalid response format from video service',
        debug: {
          availableKeys: Object.keys(finalResult),
          assetsKeys: finalResult.assets ? Object.keys(finalResult.assets) : null
        }
      });
    }

    console.log('Luma Ray-2 Flash modify successful. Result:', modifiedVideoUrl);
    
    return res.status(200).json({ 
      success: true,
      modifiedVideoUrl,
      originalVideoUrl: videoUrl,
      referenceImageUrl: imageUrl,
      prompt: prompt || '',
      mode,
      model: 'ray-flash-2',
      generationId: issueJobToken(generationId),
      processingTimeSeconds: attempts * 5
    });

  } catch (error) {
    console.error('Error processing Luma Ray-2 Flash video modification:', error);
    
    // Provide more specific error messages based on common failure scenarios
    let errorMessage = 'Failed to modify video. Please try again.';
    
    if (error instanceof Error) {
      if (error.message.includes('timeout') || error.message.includes('ECONNRESET')) {
        errorMessage = 'Video modification request timed out. Please try with a shorter video or try again later.';
      } else if (error.message.includes('invalid') || error.message.includes('format')) {
        errorMessage = 'Invalid video or image format. Please use supported formats (MP4, PNG, JPG, WEBP).';
      } else if (error.message.includes('quota') || error.message.includes('limit') || error.message.includes('rate')) {
        errorMessage = 'Service temporarily unavailable due to high demand. Please try again in a few minutes.';
      } else if (error.message.includes('network') || error.message.includes('fetch')) {
        errorMessage = 'Network error occurred. Please check your connection and try again.';
      } else {
        errorMessage = `Video modification failed: ${error.message}`;
      }
    }
    
    return res.status(500).json({ 
      error: errorMessage,
      code: 'VIDEO_MODIFY_ERROR'
    });
  }
}

export default withApiAccess(handler, "/api/luma/modify");
