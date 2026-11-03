import { withApiAccess } from "../_lib/api-access.js";
import { fal } from "@fal-ai/client";

 async function handler(req, res) {
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

  try {
    const { imageUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: 'Missing imageUrl parameter' });
    }

    // Configure FAL client with server-side environment variable
    // Use server-side only env var (not VITE_ prefixed to keep secure)
    const falApiKey = process.env.FAL_API_KEY;
    if (!falApiKey) {
      console.error('FAL_API_KEY environment variable not set (server-side only)');
      return res.status(500).json({ error: 'Service configuration error' });
    }

    fal.config({
      credentials: falApiKey
    });

    // Simple memory cache for faster responses and to reduce API calls
    const CAPTION_CACHE = globalThis.CAPTION_CACHE || (globalThis.CAPTION_CACHE = new Map());
    const cacheKey = imageUrl;
    
    // Check cache first
    if (CAPTION_CACHE.has(cacheKey)) {
      const cachedResult = CAPTION_CACHE.get(cacheKey);
      console.log('🔍 Retrieved caption from cache for:', imageUrl.substring(0, 30) + '...');
      return res.json(cachedResult);
    }

    console.log('🔄 [MD3] Caption request for image:', imageUrl.substring(0, 30) + '...');

    const result = await fal.subscribe("fal-ai/moondream3-preview/caption", {
      input: {
        image_url: imageUrl,
        response_format: "json" // Request JSON formatting for structured data
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          console.log('🔄 [MD3] caption progress:', update.logs?.map(log => log.message));
        }
      },
    });

    console.log('✅ [MD3] caption completed:', result);

    if (!result.data) {
      throw new Error('No data in Moondream response');
    }

    // Extract caption from result.data.output or result.data directly
    const caption = result.data.output || 
                    (typeof result.data === 'string' ? result.data : null);
    
    if (!caption) {
      throw new Error('No valid caption in Moondream response');
    }

    // Build response with success flag
    const response = { 
      success: true,
      caption,
      timestamp: new Date().toISOString()
    };

    // Cache the result
    CAPTION_CACHE.set(cacheKey, response);
    console.log('💾 Cached caption for:', imageUrl.substring(0, 30) + '...');

    return res.json(response);
  } catch (error) {
    console.error('❌ Moondream API error:', error);
    return res.status(500).json({ 
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      caption: null
    });
  }
}

export default withApiAccess(handler, "/api/fal/moondream");
