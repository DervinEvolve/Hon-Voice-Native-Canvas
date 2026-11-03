import { withApiAccess } from "../_lib/api-access.js";
import { fal } from '@fal-ai/client';

 async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, options = {} } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Missing required parameter: prompt is required' });
  }

  try {
    const falApiKey = process.env.FAL_API_KEY || process.env.FAL_AI_API_KEY;
    
    if (!falApiKey) {
      return res.status(500).json({ error: 'Server configuration error: Missing FAL AI API key' });
    }

    console.log(`Processing GPT-Image-1 Mini text-to-image: "${prompt.substring(0, 100)}..."`);

    // Configure FAL client
    fal.config({
      credentials: falApiKey
    });

    const result = await fal.subscribe('fal-ai/gpt-image-1-mini', {
      input: {
        prompt,
        num_images: options.num_images || 1,
        output_format: options.output_format || 'jpeg'
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          console.log('GPT-Image-1 Mini generation progress:', update.logs?.map(log => log.message));
        }
      },
    });

    console.log('GPT-Image-1 Mini generation completed:', result);

    if (!result?.data?.images?.[0]?.url) {
      console.error('Unexpected response format from GPT-Image-1 Mini:', result);
      return res.status(500).json({ error: 'Invalid response format from image service' });
    }

    const generatedImageUrl = result.data.images[0].url;
    console.log(`GPT-Image-1 Mini generation successful. Result: ${generatedImageUrl}`);
    
    return res.status(200).json({ url: generatedImageUrl });

  } catch (error) {
    console.error('Error processing GPT-Image-1 Mini generation:', error);
    
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    });
  }
}

export default withApiAccess(handler, "/api/gpt/text-to-image");
