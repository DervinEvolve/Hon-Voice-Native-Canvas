import { withApiAccess } from "../_lib/api-access.js";
import { fal } from '@fal-ai/client';

 async function handler(req, res) {
  // Set CORS headers
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
    const { imageUrl, maskDataUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: 'Image URL is required' });
    }

    if (!maskDataUrl) {
      return res.status(400).json({ error: 'Mask data URL is required' });
    }

    // Configure FAL client with server-side API key
    fal.config({
      credentials: process.env.FAL_API_KEY
    });

    console.log('Backend: Erasing object from image...');
    
    // Handle mask upload - convert data URL to blob and upload to fal.ai storage
    let maskUrl = maskDataUrl;
    
    if (maskDataUrl.startsWith('data:')) {
      try {
        // Convert data URL to blob
        const base64Data = maskDataUrl.split(',')[1];
        const byteCharacters = atob(base64Data);
        const byteArrays = [];
        
        for (let i = 0; i < byteCharacters.length; i += 512) {
          const slice = byteCharacters.slice(i, i + 512);
          const byteNumbers = new Array(slice.length);
          
          for (let j = 0; j < slice.length; j++) {
            byteNumbers[j] = slice.charCodeAt(j);
          }
          
          const byteArray = new Uint8Array(byteNumbers);
          byteArrays.push(byteArray);
        }
        
        const blob = new Blob(byteArrays, { type: 'image/png' });
        
        // Create a File object from the blob
        const file = new File([blob], 'mask.png', { type: 'image/png' });
        
        // Upload to fal.ai storage
        maskUrl = await fal.storage.upload(file);
        console.log('Backend: Uploaded mask to fal.ai storage:', maskUrl);
      } catch (error) {
        console.error('Backend: Failed to upload mask to fal.ai storage:', error);
        return res.status(500).json({ error: 'Failed to upload mask' });
      }
    }

    const result = await fal.subscribe('fal-ai/bria/eraser', {
      input: {
        image_url: imageUrl,
        mask_url: maskUrl,
        mask_type: "manual"
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          console.log('Backend: Eraser progress:', update.logs?.map(log => log.message));
        }
      },
    });

    console.log('Backend: Eraser completed:', result);

    if (!result.data?.image?.url) {
      return res.status(500).json({ error: 'No image URL in response' });
    }

    return res.status(200).json({ 
      imageUrl: result.data.image.url,
      success: true 
    });

  } catch (error) {
    console.error('Backend: Bria Eraser API error:', error);
    return res.status(500).json({ error: error.message || 'Object erasing failed' });
  }
}

export default withApiAccess(handler, "/api/bria/generate");
