// Secure backend-based Easel service
export const easelService = {
  async swapFaces(
    faceImage0: string,
    targetImage: string,
    options: {
      gender0?: '' | 'male' | 'female' | 'non-binary';
      faceImage1?: string;
      gender1?: '' | 'male' | 'female' | 'non-binary';
      workflowType: 'user_hair' | 'target_hair';
      upscale?: boolean;
    }
  ): Promise<string> {
    try {
      console.log('Starting face swap with Easel AI (via backend)...');

      const response = await fetch('/api/easel/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          faceImage0,
          targetImage,
          options
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
        
        // Provide more specific error messages based on the response status
        if (response.status === 429) {
          throw new Error('Too many requests. Please try again later.');
        } else if (response.status === 403) {
          throw new Error('Access denied. Please check your API key.');
        } else if (response.status === 413) {
          throw new Error('Image file too large. Please use a smaller image.');
        } else if (response.status === 400) {
          throw new Error('Invalid request. Please check your inputs.');
        } else if (response.status === 500) {
          throw new Error('Server error. The face swap service is currently experiencing issues.');
        }
        
        throw new Error(`Face swap failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
      }

      const result = await response.json();
      
      if (!result.imageUrl) {
        throw new Error('No image URL in response');
      }

      console.log('Face swap completed (via backend):', result.imageUrl);
      return result.imageUrl;

    } catch (error) {
      console.error('Easel AI Face Swap error (backend):', error);
      throw error;
    }
  }
}; 