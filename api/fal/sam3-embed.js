import { withApiAccess } from "../_lib/api-access.js";
/**
 * FAL.ai SAM3 Image Embedding API
 * Generates semantic embeddings for images using SAM3
 * 
 * Endpoint: POST /api/fal/sam3-embed
 * Body: { imageUrl: string }
 * Returns: { success: true, embedding_b64: string }
 * 
 * Documentation: https://fal.ai/models/fal-ai/sam-3/image/embed/api
 * Use cases: Similarity search, visual matching, semantic understanding
 */

 async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed, use POST' });
  }

  try {
    const { imageUrl } = req.body || {};
    
    if (!imageUrl) {
      return res.status(400).json({ error: 'Missing imageUrl parameter' });
    }

    const falApiKey = process.env.FAL_API_KEY;
    if (!falApiKey) {
      console.warn('[SAM3] FAL_API_KEY not configured');
      return res.status(500).json({ error: 'FAL_API_KEY not configured' });
    }

    // FAL.ai SAM3 Image Embedding endpoint
    // Model: fal-ai/sam-3/image/embed
    // Documentation: https://fal.ai/models/fal-ai/sam-3/image/embed/api
    // 
    // Input: image_url
    // Output: embedding_b64 (base64 encoded embedding vector)
    
    console.log('[SAM3] Generating embedding for image:', imageUrl.substring(0, 50) + '...');

    const response = await fetch('https://fal.run/fal-ai/sam-3/image/embed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Key ${falApiKey}`
      },
      body: JSON.stringify({
        image_url: imageUrl
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[SAM3] FAL.ai embedding generation error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `SAM3 embedding generation failed: ${errorText}`,
        success: false
      });
    }

    const data = await response.json();
    
    // FAL SAM3 image/embed response format:
    // Returns: { embedding_b64: string }
    // embedding_b64 is a base64-encoded embedding vector
    
    if (!data.embedding_b64) {
      console.warn('[SAM3] No embedding returned');
      return res.status(200).json({ 
        success: false,
        error: 'No embedding returned',
        embedding_b64: null
      });
    }

    console.log('[SAM3] Generated embedding (length:', data.embedding_b64.length, 'chars)');

    return res.status(200).json({ 
      success: true,
      embedding_b64: data.embedding_b64
    });

  } catch (error) {
    console.error('[SAM3] Embedding generation error:', error);
    return res.status(500).json({ 
      success: false,
      error: error?.message || 'Unknown error',
      embedding_b64: null
    });
  }
}

export default withApiAccess(handler, "/api/fal/sam3-embed");
