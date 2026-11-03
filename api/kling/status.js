import { withApiAccess } from "../_lib/api-access.js";
import { ownedProviderId, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from '@fal-ai/client';

// Configure the fal client with the API key from environment variables
fal.config({
  credentials: process.env.FAL_API_KEY,
});

 async function handler(req, res, context) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!req.query.requestId) {
    return res.status(400).json({ error: 'Request ID is required' });
  }
  // Only this user's Kling text-to-video jobs reach the provider.
  let requestId;
  try { requestId = ownedProviderId(context?.actor, 'kling/video', req.query.requestId); }
  catch (error) { return sendJobOwnershipError(res, error); }

  try {
    console.log('Kling text-to-video status check for requestId:', requestId);
    
    const status = await fal.queue.status('fal-ai/kling-video/v2.5-turbo/pro/text-to-video', {
      requestId,
      logs: false,
    });

    console.log('Kling text-to-video status response:', JSON.stringify(status, null, 2));
    
    if (status.status === 'COMPLETED' && status.response_url) {
      console.log('Job completed, fetching result from response_url:', status.response_url);
      
      // Fetch the actual result from the response_url with proper auth headers
      const resultResponse = await fetch(status.response_url, {
        headers: {
          'Authorization': `Key ${process.env.FAL_API_KEY}`,
          'Content-Type': 'application/json',
        }
      });
      const resultData = await resultResponse.json();
      
      console.log('Kling text-to-video result data:', JSON.stringify(resultData, null, 2));
      
      res.status(200).json({
        status: 'COMPLETED',
        result: resultData
      });
    } else {
      res.status(200).json(status);
    }
  } catch (error) {
    console.error('Error fetching job status from Kling 2.1:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to fetch job status',
      details: error.message 
    });
  }
}

export default withApiAccess(handler, "/api/kling/status");
