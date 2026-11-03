import { withApiAccess } from "../_lib/api-access.js";
import { jobTokenIssuer, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from '@fal-ai/client';

// Configure the fal client with the API key from environment variables
fal.config({
  credentials: process.env.FAL_API_KEY,
});

 async function handler(req, res, context) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check job signing before the provider is charged.
  let issueJobToken;
  try { issueJobToken = jobTokenIssuer(context?.actor, 'minimax/image'); }
  catch (error) { return sendJobOwnershipError(res, error); }

  const { prompt, image_url, prompt_optimizer } = req.body;

  if (!prompt || !image_url) {
    return res.status(400).json({ error: 'Both prompt and image_url are required' });
  }

  // Validate prompt length (Hailuo has 2000 character limit)
  if (prompt.length > 2000) {
    return res.status(400).json({ 
      error: 'Prompt too long', 
      details: `Prompt must be 2000 characters or less. Current length: ${prompt.length}` 
    });
  }

  try {
    console.log('Submitting Hailuo image-to-video generation job...');

    const result = await fal.queue.submit('fal-ai/minimax/hailuo-02/pro/image-to-video', {
      input: {
        prompt: prompt,
        image_url,
        prompt_optimizer,
      },
      webhookUrl: null,
    });

    console.log('Hailuo image-to-video job submitted successfully:', result);

    res.status(202).json({
      request_id: issueJobToken(result.request_id),
      status: 'IN_QUEUE'
    });
  } catch (error) {
    console.error('Error submitting job to Hailuo 02 Pro (image-to-video):', error);
    res.status(500).json({ 
      error: 'Failed to submit job',
      details: error.message 
    });
  }
}

export default withApiAccess(handler, "/api/minimax/image");
