import { withApiAccess } from "../_lib/api-access.js";
import { ownedProviderId, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from '@fal-ai/client';

 async function handler(req, res, context) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = req.query?.requestId;

  if (!token) {
    return res.status(400).json({ error: 'Request ID is required' });
  }
  // Only jobs this user started (see api/_lib/job-ownership.js).
  let requestId;
  try { requestId = ownedProviderId(context?.actor, 'vidu/video', token); }
  catch (error) { return sendJobOwnershipError(res, error); }

  try {
    fal.config({ credentials: process.env.FAL_API_KEY });
    console.log('Vidu status check for requestId:', requestId);
    
    const status = await fal.queue.status('fal-ai/vidu/q1/text-to-video', {
      requestId,
      logs: false,
    });

    console.log('Vidu status response:', JSON.stringify(status, null, 2));
    
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
      
      console.log('Vidu result data:', JSON.stringify(resultData, null, 2));
      
      res.status(200).json({
        status: 'COMPLETED',
        result: resultData
      });
    } else {
      res.status(200).json(status);
    }
  } catch (error) {
    console.error('Error fetching job status from Vidu:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to fetch job status',
      details: error.message 
    });
  }
}

export default withApiAccess(handler, "/api/vidu/status");
