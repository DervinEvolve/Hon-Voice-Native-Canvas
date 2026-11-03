// Secure backend-based Flux-1 Dev service
export const fluxDevService = {
  async generateImage(prompt: string): Promise<string> {
    try {
      console.log('Generating image with Flux-1 Dev (via backend) - Prompt:', prompt);

      const response = await fetch('/api/flux/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          image_size: 'landscape_4_3',
          num_inference_steps: 28,
          guidance_scale: 3.5,
          num_images: 1,
          enable_safety_checker: true,
          output_format: 'jpeg'
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

      console.log('Flux-1 Dev generation completed (via backend):', result.imageUrl);
      return result.imageUrl;

    } catch (error) {
      console.error('Flux-1 Dev API error (backend):', error);
      throw error;
    }
  }
}; 