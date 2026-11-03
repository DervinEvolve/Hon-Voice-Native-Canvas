// Secure backend-based Flux Kontext Max service
export const fluxKontextService = {
  async editImage(prompt: string, imageUrl: string): Promise<string> {
    try {
      console.log('Editing image with Flux Kontext Max (via backend) - Prompt:', prompt, 'Image:', imageUrl);

      const response = await fetch('/api/flux/edit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          image_url: imageUrl,
          guidance_scale: 3.5,
          num_images: 1,
          safety_tolerance: "2",
          output_format: "jpeg"
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
        throw new Error(`Image editing failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
      }

      const result = await response.json();
      
      if (!result.imageUrl) {
        throw new Error('No image URL in response');
      }

      console.log('Flux Kontext Max edit completed (via backend):', result.imageUrl);
      return result.imageUrl;

    } catch (error) {
      console.error('Flux Kontext Max API error (backend):', error);
      throw error;
    }
  }
}; 