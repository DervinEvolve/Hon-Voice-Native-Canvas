import { withApiAccess } from "../_lib/api-access.js";
import { jobTokenIssuer, ownedProviderId, sendJobOwnershipError } from "../_lib/job-ownership.js";
 async function handler(req, res, context) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  
  // Handle OPTIONS method for preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only allow POST requests for Luma Video API
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed, use POST' });
  }

  // Check job signing before the provider is charged. A reference to an
  // earlier generation must be this user's own job token.
  let issueJobToken, referenceId;
  try {
    issueJobToken = jobTokenIssuer(context?.actor, 'luma/generation');
    if (req.body?.reference_video_id) referenceId = ownedProviderId(context?.actor, 'luma/generation', req.body.reference_video_id);
  } catch (error) { return sendJobOwnershipError(res, error); }
  
  try {
    const {
      prompt,
      operation_type = 'text_to_video',
      model = 'ray-flash-2',
      resolution = '720p',
      duration = '5s',
      aspect_ratio = '16:9',
      loop = false,
      start_image_url,
      end_image_url,
      reference_video_id,
      camera_motion,
      concepts = [],
      motion_intensity = 'medium',
      style_prompt,
      negative_prompt,
      enhance_prompt = false,
      webhook_url
    } = req.body;
    
    if (!prompt && operation_type !== 'extend_video') {
      return res.status(400).json({ error: 'Prompt is required for most operations' });
    }
    
    // Get API key from environment variables
    const LUMA_API_KEY = process.env.LUMAAI_API_KEY || process.env.LUMA_API_KEY;
    
    if (!LUMA_API_KEY) {
      console.error('Missing LUMAAI_API_KEY environment variable');
      return res.status(500).json({ error: 'Server configuration error - missing API key' });
    }
    
    // Build the request payload based on operation type
    let requestPayload = {
      model,
      aspect_ratio,
      loop
    };
    
    // Add resolution and duration for applicable operations
    if (operation_type !== 'extend_video' && operation_type !== 'interpolate') {
      requestPayload.resolution = resolution;
      requestPayload.duration = duration;
    }
    
    // Handle different operation types
    switch (operation_type) {
      case 'text_to_video':
        requestPayload.prompt = buildEnhancedPrompt(prompt, camera_motion, style_prompt, motion_intensity, enhance_prompt);
        if (concepts.length > 0) {
          requestPayload.concepts = concepts.map(concept => ({ key: concept }));
        }
        break;
        
      case 'image_to_video':
        if (!start_image_url) {
          return res.status(400).json({ error: 'start_image_url is required for image-to-video' });
        }
        requestPayload.prompt = buildEnhancedPrompt(prompt, camera_motion, style_prompt, motion_intensity, enhance_prompt);
        requestPayload.keyframes = {
          frame0: {
            type: 'image',
            url: start_image_url
          }
        };
        if (end_image_url) {
          requestPayload.keyframes.frame1 = {
            type: 'image',
            url: end_image_url
          };
        }
        break;
        
      case 'extend_video':
        if (!reference_video_id) {
          return res.status(400).json({ error: 'reference_video_id is required for extend_video' });
        }
        requestPayload.prompt = prompt || 'Continue the video sequence';
        requestPayload.keyframes = {
          frame0: {
            type: 'generation',
            id: referenceId
          }
        };
        if (end_image_url) {
          requestPayload.keyframes.frame1 = {
            type: 'image',
            url: end_image_url
          };
        }
        break;
        
      case 'reverse_extend':
        if (!reference_video_id) {
          return res.status(400).json({ error: 'reference_video_id is required for reverse_extend' });
        }
        requestPayload.prompt = prompt || 'Generate video leading up to this sequence';
        requestPayload.keyframes = {
          frame1: {
            type: 'generation',
            id: referenceId
          }
        };
        if (start_image_url) {
          requestPayload.keyframes.frame0 = {
            type: 'image',
            url: start_image_url
          };
        }
        break;
        
      case 'interpolate':
        if (!reference_video_id) {
          return res.status(400).json({ error: 'reference_video_id is required for interpolate' });
        }
        // For interpolation, we need two generation IDs
        // This is a simplified version - you might want to extend this for more complex interpolation
        requestPayload.prompt = prompt || 'Interpolate between video sequences';
        requestPayload.keyframes = {
          frame0: {
            type: 'generation',
            id: referenceId
          },
          frame1: {
            type: 'generation',
            id: referenceId // You'd typically want a different ID here
          }
        };
        break;
        
      default:
        return res.status(400).json({ error: `Unsupported operation_type: ${operation_type}` });
    }
    
    // Add webhook URL if provided
    if (webhook_url) {
      requestPayload.callback_url = webhook_url;
    }
    
    console.log(`Luma Video Generation Request:`, {
      operation_type,
      model,
      prompt: prompt?.substring(0, 100) + '...',
      hasKeyframes: !!requestPayload.keyframes
    });
    
    // Make request to Luma Dream Machine API
    const lumaResponse = await fetch(
      'https://api.lumalabs.ai/dream-machine/v1/generations',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LUMA_API_KEY}`,
          'Accept': 'application/json'
        },
        body: JSON.stringify(requestPayload)
      }
    );
    
    if (!lumaResponse.ok) {
      const errorText = await lumaResponse.text();
      console.error(`Luma API error (${lumaResponse.status}): ${errorText}`);
      return res.status(lumaResponse.status).json({ 
        error: `Luma API error: ${errorText}` 
      });
    }
    
    const lumaData = await lumaResponse.json();
    
    // Return the generation data
    return res.status(200).json({
      id: issueJobToken(lumaData.id),
      state: lumaData.state,
      operation_type,
      model,
      created_at: lumaData.created_at,
      assets: lumaData.assets,
      request: lumaData.request,
      status: "success"
    });
    
  } catch (error) {
    console.error('Luma video generation error:', error);
    return res.status(500).json({ 
      error: error.message || 'Failed to generate Luma video' 
    });
  }
}

// Helper function to build enhanced prompts
function buildEnhancedPrompt(basePrompt, cameraMotion, stylePrompt, motionIntensity, enhancePrompt) {
  let enhancedPrompt = basePrompt;
  
  // Add camera motion to prompt
  if (cameraMotion) {
    enhancedPrompt += `, ${cameraMotion}`;
  }
  
  // Add style instructions
  if (stylePrompt) {
    enhancedPrompt += `, ${stylePrompt}`;
  }
  
  // Add motion intensity hints
  if (motionIntensity === 'low') {
    enhancedPrompt += ', subtle movement, gentle motion';
  } else if (motionIntensity === 'high') {
    enhancedPrompt += ', dynamic movement, energetic motion';
  }
  
  // Add enhancement hints if requested
  if (enhancePrompt) {
    enhancedPrompt += ', high quality, detailed, cinematic';
  }
  
  return enhancedPrompt;
}

export default withApiAccess(handler, "/api/luma/video-generation");
