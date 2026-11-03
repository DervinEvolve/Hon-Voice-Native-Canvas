import { withApiAccess } from "../_lib/api-access.js";
import { fal } from '@fal-ai/client';

 async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { input_concept, style = 'Cinematic', prompt_length = 'Medium' } = req.body;

    if (!input_concept) {
      return res.status(400).json({ error: 'Input concept is required' });
    }

    fal.config({
      credentials: process.env.FAL_API_KEY
    });

    console.log('Backend: Optimizing video prompt:', input_concept);

    const result = await fal.subscribe('fal-ai/video-prompt-generator', {
      input: {
        input_concept,
        style,
        prompt_length
      }
    });

    console.log('Backend: Prompt optimization completed:', result);

    if (!result?.data?.prompt) {
      return res.status(500).json({ error: 'No optimized prompt in response' });
    }

    return res.status(200).json({
      optimizedPrompt: result.data.prompt,
      success: true
    });
  } catch (error) {
    console.error('Backend: Video prompt optimizer API error:', error);
    return res.status(500).json({ error: error.message || 'Prompt optimization failed' });
  }
}

export default withApiAccess(handler, "/api/video/prompt-optimizer");
