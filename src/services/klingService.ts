import { fal } from "@fal-ai/client";

// Helper function to convert data URL to Blob
const dataURLtoBlob = (dataURL: string): Blob => {
  try {
    const arr = dataURL.split(',');
    if (arr.length < 2) {
      throw new Error('Invalid data URL format');
    }
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  } catch (error) {
    console.error('Error converting data URL to Blob:', error);
    throw new Error('Failed to process image data. Please try a different image.');
  }
};

// Helper function to upload image using fal.storage
const uploadImageToFal = async (blob: Blob): Promise<string> => {
  try {
    // Generate a random filename with the correct extension
    const extension = blob.type.split('/')[1] || 'png';
    const filename = `image_${Date.now()}.${extension}`;
    
    // Create a File object from the Blob
    const file = new File([blob], filename, { type: blob.type });
    
    // Upload the file using fal.storage
    const url = await fal.storage.upload(file);
    console.log('Uploaded image to fal.storage:', url);
    return url;
  } catch (error) {
    console.error('Error uploading to fal.storage:', error);
    throw new Error('Failed to upload image. Please try again.');
  }
};

interface KlingImageToVideoInput {
  prompt: string;
  image_url: string;
  duration?: '5' | '10';
}

export const klingService = {
  /**
   * Generates a video from an image and a prompt using Kling 2.1.
   * This function communicates with our secure backend endpoint.
   * @param input - The image-to-video generation parameters.
   * @returns The URL of the generated video.
   */
  generateVideoFromImage: async (input: KlingImageToVideoInput): Promise<string> => {
    console.log('🚀 Initiating Kling 2.1 Image-to-Video generation via secure endpoint:', input);
    try {
      const response = await fetch('/api/fal/kling-image-to-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });

      if (response.status === 404) {
        // This route exists only in the local dev server (src/server/api.ts).
        throw new Error('Kling 2.1 image-to-video through fal.ai is only available with the local dev server (npm run dev); a deployed build does not include it.');
      }
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to generate video from image');
      }

      const result = await response.json();
      console.log('✅ Kling 2.1 Image-to-Video generation successful:', result);
      
      if (!result.video?.url) {
        throw new Error('No video URL in response from Kling 2.1 API');
      }
      
      return result.video.url;
    } catch (error) {
      console.error('❌ Kling 2.1 Image-to-Video generation failed:', error);
      throw error;
    }
  },
}; 