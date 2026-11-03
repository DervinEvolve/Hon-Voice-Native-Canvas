// Secure backend-based Imagen 4 service
export interface Imagen4Options {
  negativePrompt?: string;
  aspectRatio?: '1:1' | '16:9' | '9:16' | '3:4' | '4:3';
  numImages?: number;
  seed?: number;
}

export const imagen4Service = {
  async generateImage(prompt: string, options: Imagen4Options = {}): Promise<string> {
    try {
      console.log('Generating image with Imagen 4 (via backend) - Prompt:', prompt);

      const response = await fetch('/api/imagen4/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          negativePrompt: options.negativePrompt || '',
          aspectRatio: options.aspectRatio || '1:1',
          numImages: options.numImages || 1,
          ...(options.seed !== undefined && { seed: options.seed })
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
        throw new Error(`Image generation failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
      }

      const result = await response.json();
      
      if (!result.imageUrl) {
        throw new Error('No image URL in response');
      }

      console.log('Imagen 4 generation completed (via backend):', result.imageUrl);
      return result.imageUrl;

    } catch (error) {
      console.error('Imagen 4 API error (backend):', error);
      throw error;
    }
  }
}; 