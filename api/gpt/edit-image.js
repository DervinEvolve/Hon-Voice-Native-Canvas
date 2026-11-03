import { withApiAccess } from "../_lib/api-access.js";
import { fal } from '@fal-ai/client';

 async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, imageUrl, options = {} } = req.body;

  if (!prompt || !imageUrl) {
    return res.status(400).json({ error: 'Missing required parameters: prompt and imageUrl are required' });
  }

  try {
    const openAIApiKey = process.env.OPENAI_API_KEY;
    const falApiKey = process.env.FAL_AI_API_KEY;
    
    // Debug environment variables (safely)
    console.log('Environment check:', {
      hasOpenAIKey: !!openAIApiKey,
      openAIKeyLength: openAIApiKey?.length || 0,
      openAIKeyPrefix: openAIApiKey?.substring(0, 7) || 'missing',
      hasFalKey: !!falApiKey,
      falKeyLength: falApiKey?.length || 0
    });
    
    if (!openAIApiKey) {
      return res.status(500).json({ error: 'Server configuration error: Missing OpenAI API key' });
    }
    
    if (!falApiKey) {
      return res.status(500).json({ error: 'Server configuration error: Missing FAL AI API key' });
    }

    console.log(`Processing GPT-Image-1 image edit: "${prompt.substring(0, 50)}..." for image ${imageUrl.substring(0, 30)}...`);

    // Configure FAL client
    fal.config({
      credentials: falApiKey
    });

    const result = await fal.subscribe('fal-ai/gpt-image-1/edit-image/byok', {
      input: {
        image_urls: [imageUrl],
        prompt,
        openai_api_key: openAIApiKey,
        image_size: options.image_size || 'auto',
        quality: options.quality || 'auto',
        num_images: options.num_images || 1
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          console.log('GPT-Image-1 edit progress:', update.logs?.map(log => log.message));
        }
      },
    });

    console.log('GPT-Image-1 edit completed:', result);

    if (!result?.data?.images?.[0]?.url) {
      console.error('Unexpected response format from GPT-Image-1:', result);
      return res.status(500).json({ error: 'Invalid response format from image service' });
    }

    const editedImageUrl = result.data.images[0].url;
    console.log(`GPT-Image-1 edit successful. Result: ${editedImageUrl}`);
    
    return res.status(200).json({ editedImageUrl });

  } catch (error) {
    console.error('Error processing GPT-Image-1 edit:', error);
    
    // Provide more specific error messages
    if (error.status === 401) {
      return res.status(500).json({ 
        error: 'Authentication failed: Please check that your OpenAI API key is valid and has access to GPT-4 models.' 
      });
    }
    
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    });
  }
}

export default withApiAccess(handler, "/api/gpt/edit-image");
