// Secure backend-based Bria service
export const briaService = {
  async eraseObjectFromImage(imageUrl: string, maskDataUrl: string): Promise<string> {
    try {
      console.log('Erasing object from image (via backend)...');

      const response = await fetch('/api/bria/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageUrl,
          maskDataUrl
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
        throw new Error(`Object erasing failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
      }

      const result = await response.json();
      
      if (!result.imageUrl) {
        throw new Error('No image URL in response');
      }

      console.log('Eraser completed (via backend):', result.imageUrl);
      return result.imageUrl;

    } catch (error) {
      console.error('Bria Eraser API error (backend):', error);
      throw error;
    }
  }
}; 