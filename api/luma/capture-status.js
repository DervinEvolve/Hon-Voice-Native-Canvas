import { withApiAccess } from "../_lib/api-access.js";
import { ownedProviderId, sendJobOwnershipError } from "../_lib/job-ownership.js";
 async function handler(req, res, context) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!req.query.slug) {
    return res.status(400).json({ error: 'Missing slug' });
  }
  // Only this user's Luma capture jobs reach the provider. No route in this
  // build starts a capture, so every slug answers not found for now.
  let slug;
  try { slug = ownedProviderId(context?.actor, 'luma/capture', req.query.slug); }
  catch (error) { return sendJobOwnershipError(res, error); }

  const LUMA_API_KEY = process.env.LUMAAI_API_KEY || process.env.LUMA_API_KEY;
  if (!LUMA_API_KEY) {
    return res.status(500).json({ error: 'Server configuration error: Missing Luma API key' });
  }

  try {
    const response = await fetch(`https://api.lumalabs.ai/capture/v1/captures/${slug}`, {
      headers: {
        'Authorization': `luma-api-key=${LUMA_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Luma Capture Status Error:', err);
      return res.status(response.status).json({ error: 'Failed to fetch capture status' });
    }

    const data = await response.json();
    const capture = data.capture;
    
    if (!capture) {
      return res.status(404).json({ error: 'Capture not found' });
    }

    const latestRun = capture.latestRun;
    const status = latestRun ? latestRun.status : 'pending';
    
    // Find splat artifact
    let splatUrl = null;
    if (latestRun && latestRun.artifacts) {
      const splat = latestRun.artifacts.find(a => a.type === 'gaussian-splat' || a.type === 'splat');
      if (splat) splatUrl = splat.url;
    }

    // If legacy/simple format
    if (!splatUrl && capture.signedUrls && capture.signedUrls.source) {
       // This is source video, not splat
    }

    return res.status(200).json({
      status, // 'processing', 'finished', 'failed'
      splatUrl,
      progress: latestRun ? latestRun.progress : 0
    });

  } catch (error) {
    console.error('Luma Capture Status Exception:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default withApiAccess(handler, "/api/luma/capture-status");
