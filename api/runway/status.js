import { withApiAccess } from "../_lib/api-access.js";
import { ownedProviderId, sendJobOwnershipError } from "../_lib/job-ownership.js";
 async function handler(req, res, context) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Validate environment variables
    if (!process.env.RUNWAY_API_KEY) {
      console.error('Missing RUNWAY_API_KEY environment variable');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const { taskId } = req.query;

    if (!taskId) {
      return res.status(400).json({ error: 'taskId is required' });
    }
    // Only this user's Runway tasks reach the provider. Replies echo the
    // token, which the client polls with.
    let providerTaskId;
    try { providerTaskId = ownedProviderId(context?.actor, 'runway', taskId); }
    catch (error) { return sendJobOwnershipError(res, error); }

    console.log('Checking status for Runway task:', taskId);

    const statusResponse = await fetch(`https://api.dev.runwayml.com/v1/tasks/${providerTaskId}`, {
      headers: {
        'Authorization': `Bearer ${process.env.RUNWAY_API_KEY}`,
        'X-Runway-Version': '2024-11-06'
      }
    });
    
    if (!statusResponse.ok) {
      throw new Error(`Status check failed: ${statusResponse.status}`);
    }
    
    const statusData = await statusResponse.json();
    console.log(`Runway task ${taskId} status:`, statusData.status);
    console.log(`Runway task ${taskId} full response:`, JSON.stringify(statusData, null, 2));
    
    if (statusData.status === 'completed' || statusData.status === 'SUCCEEDED') {
      console.log('Task completed successfully:', {
        taskId: taskId,
        status: statusData.status,
        fullResponse: statusData
      });

      // Handle different response formats
      const output = statusData.output || statusData.imageUrl || statusData.images;
      
      if (!output) {
        console.error('No output found in response:', statusData);
        throw new Error('No image output generated');
      }

      // Normalize output to array format
      const outputArray = Array.isArray(output) ? output : [output];

      return res.status(200).json({
        id: taskId,
        status: 'completed',
        output: outputArray
      });
    } else if (statusData.status === 'failed' || statusData.status === 'FAILED') {
      return res.status(400).json({
        id: taskId,
        status: 'failed',
        error: statusData.error || 'Video generation failed'
      });
    } else {
      // Still processing
      return res.status(200).json({
        id: taskId,
        status: statusData.status || 'processing'
      });
    }

  } catch (error) {
    console.error('Runway status check error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message
    });
  }
}

export default withApiAccess(handler, "/api/runway/status");
