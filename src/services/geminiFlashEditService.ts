export interface GeminiFlashEditOptions {
  seed?: number;
  strength?: number;
  num_inference_steps?: number;
  guidance_scale?: number;
}

export const geminiFlashEditService = {
  async editImage(prompt: string, imageUrl: string, options: GeminiFlashEditOptions = {}): Promise<string> {
    try {
      console.log('Editing image with Gemini Flash Edit via secure backend, prompt:', prompt);
      console.log('Source image URL:', imageUrl);

      // Check if the image URL is valid
      if (!imageUrl || !imageUrl.trim()) {
        throw new Error('Invalid image URL provided');
      }

      // Call the secure backend endpoint
      const response = await fetch('/api/gemini/flash-edit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          image_url: imageUrl
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
        throw new Error(`Gemini Flash Edit failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
      }

      const result = await response.json();
      console.log('Gemini Flash Edit completed via backend:', result);

      if (!result.imageUrl) {
        throw new Error('Could not find image URL in the API response');
      }

      return result.imageUrl;
    } catch (error) {
      console.error('Gemini Flash Edit API error:', error);
      throw error;
    }
  }
}; 