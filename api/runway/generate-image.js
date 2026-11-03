import { withApiAccess } from "../_lib/api-access.js";
import { jobTokenIssuer, sendJobOwnershipError } from "../_lib/job-ownership.js";
 async function handler(req, res, context) {
  // Enable CORS - Direct HTTP API implementation (SDK version incompatible)
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

    const { model, ratio, promptText, referenceImages, seed, guidance } = req.body;

    // Validate required fields
    if (!promptText) {
      return res.status(400).json({ error: 'promptText is required' });
    }

    // Add detailed logging for debugging
    console.log('Raw promptText:', JSON.stringify(promptText));
    console.log('promptText type:', typeof promptText);
    console.log('promptText length:', promptText?.length);
    
    // Validate promptText format and content
    if (typeof promptText !== 'string') {
      console.error('promptText is not a string:', promptText);
      return res.status(400).json({ error: 'promptText must be a string' });
    }
    
    if (promptText.trim().length === 0) {
      console.error('promptText is empty after trimming');
      return res.status(400).json({ error: 'promptText cannot be empty' });
    }
    
    // Clean the prompt text - remove any potential problematic characters
    const cleanPromptText = promptText.trim().replace(/[\x00-\x1F\x7F-\x9F]/g, '');
    
    // Validate prompt length (UI should prevent this, but double-check)
    if (cleanPromptText.length > 1000) {
      console.error(`promptText too long (${cleanPromptText.length} chars), should be prevented by UI`);
      return res.status(400).json({ error: 'promptText must be 1000 characters or less' });
    }

    // Validate seed parameter (2024-11-06 API version supports up to 2^32 - 1)
    if (seed !== undefined && (seed < 0 || seed > 4294967295)) {
      return res.status(400).json({ error: 'seed must be between 0 and 4294967295' });
    }

    console.log('Generating image with Runway Gen-4:', {
      model: model || 'gen4_image',
      ratio: ratio || '1024:1024',
      promptText: cleanPromptText,
      originalPromptText: promptText,
      referenceCount: referenceImages?.length || 0
    });

    // Use direct HTTP API call with updated 2024-11-06 format
    const requestBody = {
      model: model || 'gen4_image',
      ratio: ratio || '1024:1024',
      promptText: cleanPromptText
    };

    // Add optional parameters
    if (seed !== undefined) requestBody.seed = seed;
    if (guidance !== undefined) requestBody.guidance = guidance;

    // Add reference images if provided (with proper formatting)
    if (referenceImages && referenceImages.length > 0) {
      requestBody.referenceImages = referenceImages.map(ref => ({
        uri: ref.uri,
        tag: ref.tag
      }));
    }

    console.log('Runway API request:', JSON.stringify(requestBody, null, 2));

    const response = await fetch('https://api.dev.runwayml.com/v1/text_to_image', {
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
      throw new Error(`Runway API error: ${response.status} - ${errorData}`);
    }

    const task = await response.json();
    console.log('Initial task created:', task);

    // Return task ID immediately - let client poll for completion
    // This avoids Vercel's 10-second timeout limit
    return res.status(202).json({
      id: issueJobToken(task.id),
      status: 'pending',
      message: 'Task created, use /api/runway/status/{taskId} to check progress'
    });

  } catch (error) {
    console.error('Runway generation error:', error);
    console.error('Error type:', error.constructor.name);
    console.error('Error name:', error.name);
    
    // Handle specific Runway errors by name since TaskFailedError export doesn't exist
    if (error.name === 'TaskFailedError' || error.constructor.name === 'TaskFailedError') {
      console.error('TaskFailedError details:', error.taskDetails);
      return res.status(400).json({ 
        error: 'Task failed',
        details: error.taskDetails || error.message
      });
    }

    // Handle API authentication errors
    if (error.message?.includes('401') || error.message?.includes('unauthorized')) {
      return res.status(500).json({ 
        error: 'API authentication failed',
        message: 'Invalid Runway API key or authentication error.',
        details: error.message
      });
    }

    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

export default withApiAccess(handler, "/api/runway/generate-image");
