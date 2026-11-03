import { withApiAccess } from "../_lib/api-access.js";
import { generateHumeToken } from './hume-handlers.js';

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
    const humeApiKey = process.env.HUME_API_KEY;
    const humeSecretKey = process.env.HUME_SECRET_KEY;
    
    // Validate that we have the landing page config ID
    const landingConfigId = process.env.HUME_LANDING_CONFIG_ID;
    if (!landingConfigId) {
      console.error('Missing HUME_LANDING_CONFIG_ID environment variable');
      return res.status(500).json({ error: 'Landing page configuration not found' });
    }

    const result = await generateHumeToken(humeApiKey, humeSecretKey);
    
    // Return both token and config ID for the landing page
    return res.status(200).json({
      ...result,
      configId: landingConfigId
    });
  } catch (error) {
    console.error('Error in landing page Hume token generation handler:', error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to generate Hume access token for landing page' 
    });
  }
}

export default withApiAccess(handler, "/api/hume/generate-landing-token");
