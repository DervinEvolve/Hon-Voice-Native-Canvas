// Service to handle interactions with the GPT-Image-1 Mini model via our backend proxy

export interface GptTextToImageOptions {
  numImages?: number;
  outputFormat?: 'jpeg' | 'png' | 'webp';
}

export interface GptImageEditOptions {
  imageSize?: 'auto' | '1024x1024' | '1536x1024' | '1024x1536';
  quality?: 'auto' | 'low' | 'medium' | 'high';
  numImages?: number;
}

export const gptImageService = {
  /**
   * Generates an image using the GPT-Image-1 Mini model via our backend proxy.
   * 
   * @param prompt The text prompt for image generation.
   * @param options Optional generation parameters.
   * @returns A promise that resolves to the URL of the generated image.
   */
  async generateImage(prompt: string, options: GptTextToImageOptions = {}): Promise<string> {
    console.log(`Calling backend for GPT-Image-1 Mini generation: Prompt="${prompt}"`);

    const response = await fetch('/api/gpt/text-to-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        prompt, 
        options: {
          num_images: options.numImages || 1,
          output_format: options.outputFormat || 'jpeg'
        }
      }),
    });

    if (!response.ok) {
      let errorMessage = 'Unknown error';
      try {
        const errorBody = await response.json();
        errorMessage = errorBody.error || `Status ${response.status}`;
        console.error('Backend API error:', errorBody);
      } catch (e) {
        errorMessage = `Backend request failed with status ${response.status}`;
        console.error('Backend API error: Failed to parse response body', e);
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();

    if (!data.url) {
      console.error('Backend API response missing url:', data);
      throw new Error('Backend response did not contain the generated image URL.');
    }
    
    console.log("Received generated image URL from backend:", data.url);
    return data.url;
  },

  /**
   * Edits an image using the GPT-Image-1 model via our backend proxy.
   * 
   * @param prompt The editing instruction.
   * @param imageUrl The URL of the image to edit (must be publicly accessible).
   * @param options Optional editing parameters.
   * @returns A promise that resolves to the URL of the edited image.
   */
  async editImage(prompt: string, imageUrl: string, options: GptImageEditOptions = {}): Promise<string> {
    console.log(`Calling backend for GPT-Image-1 edit: Prompt="${prompt}", ImageURL="${imageUrl.substring(0, 50)}..."`);

    const response = await fetch('/api/gpt/edit-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        prompt, 
        imageUrl,
        options: {
          image_size: options.imageSize || 'auto',
          quality: options.quality || 'auto',
          num_images: options.numImages || 1
        }
      }),
    });

    if (!response.ok) {
      let errorMessage = 'Unknown error';
      try {
        const errorBody = await response.json();
        errorMessage = errorBody.error || `Status ${response.status}`;
        console.error('Backend API error:', errorBody);
      } catch (e) {
        errorMessage = `Backend request failed with status ${response.status}`;
        console.error('Backend API error: Failed to parse response body', e);
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();

    if (!data.editedImageUrl) {
      console.error('Backend API response missing editedImageUrl:', data);
      throw new Error('Backend response did not contain the edited image URL.');
    }
    
    console.log("Received edited image URL from backend:", data.editedImageUrl);
    return data.editedImageUrl;
  },
}; 