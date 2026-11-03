import { withApiAccess } from "../_lib/api-access.js";
import { ownedProviderId, sendJobOwnershipError } from "../_lib/job-ownership.js";
 async function handler(req, res, context) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  
  // Handle OPTIONS method for preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only allow GET requests for status checking
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed, use GET' });
  }
  
  try {
    if (!req.query.id) {
      return res.status(400).json({ error: 'Generation ID is required' });
    }
    // Only this user's Luma jobs reach the provider.
    let id;
    try { id = ownedProviderId(context?.actor, 'luma/generation', req.query.id); }
    catch (error) { return sendJobOwnershipError(res, error); }
    
    // Get API key from environment variables
    const LUMA_API_KEY = process.env.LUMAAI_API_KEY || process.env.LUMA_API_KEY;
    
    if (!LUMA_API_KEY) {
      console.error('Missing LUMAAI_API_KEY environment variable');
      return res.status(500).json({ error: 'Server configuration error - missing API key' });
    }
    
    console.log(`Checking Luma generation status for ID: ${id}`);
    
    // Make request to Luma Dream Machine API to get generation status
    const lumaResponse = await fetch(
      `https://api.lumalabs.ai/dream-machine/v1/generations/${id}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${LUMA_API_KEY}`,
          'Accept': 'application/json'
        }
      }
    );
    
    if (!lumaResponse.ok) {
      const errorText = await lumaResponse.text();
      console.error(`Luma API status error (${lumaResponse.status}): ${errorText}`);
      return res.status(lumaResponse.status).json({ 
        error: `Luma API error: ${errorText}` 
      });
    }
    
    const lumaData = await lumaResponse.json();
    
    // Return the generation status data
    return res.status(200).json({
      // Echo the token so the reply can be polled again.
      id: req.query.id,
      state: lumaData.state,
      failure_reason: lumaData.failure_reason,
      created_at: lumaData.created_at,
      assets: lumaData.assets,
      request: lumaData.request,
      status: "success"
    });
    
  } catch (error) {
    console.error('Luma status check error:', error);
    return res.status(500).json({ 
      error: error.message || 'Failed to check Luma generation status' 
    });
  }
}

export default withApiAccess(handler, "/api/luma/status");
