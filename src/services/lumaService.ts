// Secure backend-based Luma service
export interface LumaService {
  generateImage: (prompt: string, referenceImage?: string) => Promise<string>;
}

export const lumaService = {
  generateImage: async (prompt: string, referenceImage?: string): Promise<string> => {
    console.log('📤 Starting Luma generation (via backend):', { prompt, hasReference: !!referenceImage });
    try {
      const response = await fetch('/api/luma/photon', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          referenceImage
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

      console.log('📥 Received Luma URL (via backend):', result.imageUrl);
      return result.imageUrl;

    } catch (error) {
      console.error('❌ Luma generation failed (backend):', error);
      throw error;
    }
  }
}; 