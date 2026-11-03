import { withApiAccess } from "../_lib/api-access.js";
import { jobTokenIssuer, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from '@fal-ai/client';

 async function handler(req, res, context) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check job ownership signing before any provider call.
  let issueJobToken;
  try { issueJobToken = jobTokenIssuer(context?.actor, 'vidu/video'); }
  catch (error) { return sendJobOwnershipError(res, error); }

  const { prompt, seed, style, movement_amplitude } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  // Validate prompt length (Vidu has 1500 character limit)
  if (prompt.length > 1500) {
    return res.status(400).json({ 
      error: 'Prompt too long', 
      details: `Prompt must be 1500 characters or less. Current length: ${prompt.length}` 
    });
  }

  try {
    console.log('Submitting Vidu text-to-video generation job...');
    fal.config({ credentials: process.env.FAL_API_KEY });

    const result = await fal.queue.submit('fal-ai/vidu/q1/text-to-video', {
      input: {
        prompt,
        seed,
        style,
        movement_amplitude,
      },
      webhookUrl: null,
    });

    console.log('Vidu job submitted successfully:', result);

    res.status(202).json({
      request_id: issueJobToken(result.request_id),
      status: 'IN_QUEUE'
    });
  } catch (error) {
    console.error('Error submitting job to Vidu:', error);
    res.status(500).json({ 
      error: 'Failed to submit job',
      details: error.message 
    });
  }
}

export default withApiAccess(handler, "/api/vidu/text-to-video");
