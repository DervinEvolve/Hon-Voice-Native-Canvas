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
  try { issueJobToken = jobTokenIssuer(context?.actor, 'minimax/video'); }
  catch (error) { return sendJobOwnershipError(res, error); }

  const { prompt, prompt_optimizer } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  // Validate prompt length (Hailuo has 2000 character limit)
  if (prompt.length > 2000) {
    return res.status(400).json({ 
      error: 'Prompt too long', 
      details: `Prompt must be 2000 characters or less. Current length: ${prompt.length}` 
    });
  }

  try {
    console.log('Submitting Hailuo text-to-video generation job...');

    const result = await fal.queue.submit('fal-ai/minimax/hailuo-02/pro/text-to-video', {
      input: {
        prompt,
        prompt_optimizer,
      },
      webhookUrl: null,
    });

    console.log('Hailuo job submitted successfully:', result);

    res.status(202).json({
      request_id: issueJobToken(result.request_id),
      status: 'IN_QUEUE'
    });
  } catch (error) {
    console.error('Error submitting job to Hailuo 02 Pro:', error);
    res.status(500).json({ 
      error: 'Failed to submit job',
      details: error.message 
    });
  }
}

export default withApiAccess(handler, "/api/minimax/text-to-video");
