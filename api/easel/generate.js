import { withApiAccess } from "../_lib/api-access.js";
import { fal } from '@fal-ai/client';

// Helper function to convert data URL to Blob
function dataURLtoBlob(dataURL) {
  try {
    const arr = dataURL.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  } catch (error) {
    console.error('Backend: Error converting data URL to Blob:', error);
    throw new Error('Invalid data URL format');
  }
}

// Helper function to upload image to fal.storage
async function uploadImageToFal(blob, filename = `image-${Date.now()}.png`) {
  try {
    const file = new File([blob], filename, { type: blob.type });
    const url = await fal.storage.upload(file);
    console.log(`Backend: Uploaded image to fal.storage: ${url}`);
    return url;
  } catch (error) {
    console.error('Backend: Error uploading to fal.storage:', error);
    throw new Error('Failed to upload image to fal.storage');
  }
}

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
    const { 
      faceImage0, 
      targetImage, 
      options = {} 
    } = req.body;

    if (!faceImage0) {
      return res.status(400).json({ error: 'Face image 0 is required' });
    }

    if (!targetImage) {
      return res.status(400).json({ error: 'Target image is required' });
    }

    // Configure FAL client with server-side API key
    fal.config({
      credentials: process.env.FAL_API_KEY
    });

    console.log('Backend: Starting face swap with Easel AI...');
    
    // Convert data URLs to HTTP URLs if needed
    let face0HttpUrl = faceImage0;
    let targetHttpUrl = targetImage;
    let face1HttpUrl = options.faceImage1;
    
    // Check if the URLs are data URLs and convert them
    if (faceImage0.startsWith('data:')) {
      const face0Blob = dataURLtoBlob(faceImage0);
      face0HttpUrl = await uploadImageToFal(face0Blob, 'face0.png');
      console.log('Backend: Uploaded face image 0:', face0HttpUrl);
    }
    
    if (targetImage.startsWith('data:')) {
      const targetBlob = dataURLtoBlob(targetImage);
      targetHttpUrl = await uploadImageToFal(targetBlob, 'target.png');
      console.log('Backend: Uploaded target image:', targetHttpUrl);
    }
    
    if (options.faceImage1 && options.faceImage1.startsWith('data:')) {
      const face1Blob = dataURLtoBlob(options.faceImage1);
      face1HttpUrl = await uploadImageToFal(face1Blob, 'face1.png');
      console.log('Backend: Uploaded face image 1:', face1HttpUrl);
    }
    
    console.log('Backend: Sending request to Easel AI with URLs:', { 
      face_image_0: face0HttpUrl,
      target_image: targetHttpUrl,
      ...(face1HttpUrl && { face_image_1: face1HttpUrl })
    });

    const result = await fal.subscribe('easel-ai/advanced-face-swap', {
      input: {
        face_image_0: face0HttpUrl,
        gender_0: options.gender0 || '',
        ...(face1HttpUrl && { face_image_1: face1HttpUrl }),
        ...(options.gender1 && { gender_1: options.gender1 }),
        target_image: targetHttpUrl,
        workflow_type: options.workflowType || 'user_hair',
        upscale: options.upscale !== undefined ? options.upscale : true
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          console.log('Backend: Face swap progress:', update.logs?.map(log => log.message));
        }
      },
    });

    console.log('Backend: Face swap completed:', result);

    if (!result.data?.image?.url) {
      return res.status(500).json({ error: 'No image URL in response' });
    }

    return res.status(200).json({ 
      imageUrl: result.data.image.url,
      success: true 
    });

  } catch (error) {
    console.error('Backend: Easel AI Face Swap error:', error);
    
    // Provide more specific error messages based on the error type
    if (error instanceof Error) {
      if (error.message.includes('429')) {
        return res.status(429).json({ error: 'Too many requests. Please try again later.' });
      } else if (error.message.includes('403')) {
        return res.status(403).json({ error: 'Access denied. Please check your API key.' });
      } else if (error.message.includes('413')) {
        return res.status(413).json({ error: 'Image file too large. Please use a smaller image.' });
      } else if (error.message.includes('400')) {
        return res.status(400).json({ error: 'Invalid request. Please check your inputs.' });
      } else if (error.message.includes('500')) {
        return res.status(500).json({ error: 'Server error. The face swap service is currently experiencing issues.' });
      }
    }
    
    return res.status(500).json({ error: error.message || 'Face swap failed' });
  }
}

export default withApiAccess(handler, "/api/easel/generate");
