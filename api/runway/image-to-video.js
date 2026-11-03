import { withApiAccess } from "../_lib/api-access.js";
import { jobTokenIssuer, sendJobOwnershipError } from "../_lib/job-ownership.js";
 async function handler(req, res, context) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check job signing before the provider is charged.
  let issueJobToken;
  try { issueJobToken = jobTokenIssuer(context?.actor, 'runway'); }
  catch (error) { return sendJobOwnershipError(res, error); }

  try {
    // Validate environment variables
    if (!process.env.RUNWAY_API_KEY) {
      console.error('Missing RUNWAY_API_KEY environment variable');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const { promptImage, promptText, model, ratio, duration, seed, watermark } = req.body;

    // Validate required fields
    if (!promptImage) {
      return res.status(400).json({ error: 'promptImage is required' });
    }

    // Validate duration (API supports 5 or 10 seconds)
    if (duration && ![5, 10].includes(duration)) {
      return res.status(400).json({ error: 'duration must be 5 or 10 seconds' });
    }

    // Validate seed parameter (2024-11-06 API version supports up to 2^32 - 1)
    if (seed !== undefined && (seed < 0 || seed > 4294967295)) {
      return res.status(400).json({ error: 'seed must be between 0 and 4294967295' });
    }

    console.log('Generating video with Runway Gen-4:', {
      model: model || 'gen4_turbo',
      ratio: ratio || '1280:720',
      duration: duration || 5,
      hasPromptImage: !!promptImage,
      promptText: promptText || 'subtle animation'
    });

    // Build request body with 2024-11-06 format
    const requestBody = {
      model: model || 'gen4_turbo',
      ratio: ratio || '1280:720',
      duration: duration || 5
    };

    // Handle promptImage parameter (can be string or array)
    if (typeof promptImage === 'string') {
      requestBody.promptImage = promptImage;
    } else if (Array.isArray(promptImage)) {
      // Validate array format for 2024-11-06 API
      const validPositions = ['first', 'last'];
      for (const img of promptImage) {
        if (!img.uri || !img.position || !validPositions.includes(img.position)) {
          return res.status(400).json({ 
            error: 'Invalid promptImage array format. Each item must have uri and position (first|last)' 
          });
        }
      }
      requestBody.promptImage = promptImage;
    } else {
      return res.status(400).json({ error: 'promptImage must be a string URL or array of image objects' });
    }

    // Add optional parameters
    if (promptText) requestBody.promptText = promptText;
    if (seed !== undefined) requestBody.seed = seed;
    if (watermark !== undefined) requestBody.watermark = watermark;

    console.log('Runway image-to-video API request:', JSON.stringify(requestBody, null, 2));

    const response = await fetch('https://api.dev.runwayml.com/v1/image_to_video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RUNWAY_API_KEY}`,
        'X-Runway-Version': '2024-11-06'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`Runway API error - Status: ${response.status}, Response: ${errorData}`);
      
      // Handle specific error cases
      if (response.status === 502) {
        throw new Error(`Runway API temporarily unavailable (502 Bad Gateway). Please try again in a moment.`);
      }
      
      throw new Error(`Runway API error: ${response.status} - ${errorData}`);
    }

    const task = await response.json();
    console.log('Initial video task created:', task);

    // Return immediately with processing status - no more waiting/polling
    console.log('Returning task ID immediately for background processing:', task.id);
    
    return res.status(200).json({
      id: issueJobToken(task.id),
      status: 'processing',
      message: 'Video generation started. Use /api/runway/status to check progress.'
    });

  } catch (error) {
    console.error('Runway video generation error:', error);
    console.error('Error type:', error.constructor.name);
    
    // Handle specific Runway errors
    if (error.name === 'TaskFailedError' || error.constructor.name === 'TaskFailedError') {
      console.error('TaskFailedError details:', error.taskDetails);
      return res.status(400).json({ 
        error: 'Video generation task failed',
        details: error.taskDetails || error.message
      });
    }

    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

export default withApiAccess(handler, "/api/runway/image-to-video");
