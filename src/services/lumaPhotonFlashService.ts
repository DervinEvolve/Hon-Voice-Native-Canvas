export interface LumaPhotonFlashOptions {
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '21:9' | '9:21';
}

export interface LumaPhotonFlashResponse {
  imageUrl: string;
  requestId: string;
  data: any;
}

class LumaPhotonFlashService {
  async generateImage(prompt: string, options: LumaPhotonFlashOptions = {}): Promise<string> {
    try {
      console.log('Luma Photon Flash generation request:', { prompt, options });

      const response = await fetch('/api/luma/photon-flash', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: prompt.trim(),
          aspect_ratio: options.aspectRatio || '1:1'
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Network error' }));
        throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const result: LumaPhotonFlashResponse = await response.json();
      console.log('Luma Photon Flash generation successful:', result);

      if (!result.imageUrl) {
        throw new Error('No image URL received from Luma Photon Flash service');
      }

      return result.imageUrl;
    } catch (error) {
      console.error('Luma Photon Flash service error:', error);
      throw error;
    }
  }
}

export const lumaPhotonFlashService = new LumaPhotonFlashService(); 