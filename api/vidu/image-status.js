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
  try { requestId = ownedProviderId(context?.actor, 'vidu/image', token); }
  catch (error) { return sendJobOwnershipError(res, error); }

  try {
    fal.config({ credentials: process.env.FAL_API_KEY });
    console.log('Vidu Q1 image-to-video status check for requestId:', requestId);
    
    const status = await fal.queue.status('fal-ai/vidu/q1/image-to-video', {
      requestId,
      logs: false,
    });

    console.log('Vidu Q1 image-to-video status response:', JSON.stringify(status, null, 2));
    
    if (status.status === 'COMPLETED' && status.response_url) {
      console.log('Job completed, fetching result from response_url:', status.response_url);
      
      // Fetch the actual result from the response_url with proper auth headers
      const resultResponse = await fetch(status.response_url, {
        headers: {
          'Authorization': `Key ${process.env.FAL_API_KEY}`,
          'Content-Type': 'application/json',
        }
      });
      
      if (!resultResponse.ok) {
        console.error('Failed to fetch result from response_url:', resultResponse.status, resultResponse.statusText);
        return res.status(200).json({
          status: 'FAILED',
          error: `Failed to fetch result: ${resultResponse.status} ${resultResponse.statusText}`
        });
      }
      
      const resultData = await resultResponse.json();
      console.log('Vidu Q1 image-to-video result data:', JSON.stringify(resultData, null, 2));
      
      // Check if the result contains an error
      if (resultData.detail && resultData.detail.includes('error')) {
        console.error('Vidu API returned error:', resultData.detail);
        return res.status(200).json({
          status: 'FAILED',
          error: resultData.detail
        });
      }
      
      // Look for video URL in the result
      const videoUrl = resultData.video?.url || resultData.output?.url || resultData.url;
      if (!videoUrl) {
        console.error('No video URL found in result:', resultData);
        return res.status(200).json({
          status: 'FAILED',
          error: 'No video URL found in completed result'
        });
      }
      
      res.status(200).json({
        status: 'COMPLETED',
        video_url: videoUrl,
        result: resultData
      });
    } else {
      res.status(200).json(status);
    }
  } catch (error) {
    console.error('Error fetching job status from Vidu Q1 (image-to-video):', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to fetch job status',
      details: error.message 
    });
  }
}

export default withApiAccess(handler, "/api/vidu/image-status");
