export interface RecraftUpscaleOptions {
  syncMode?: boolean;
  enableSafetyChecker?: boolean;
}

export interface RecraftUpscaleResponse {
  upscaledImageUrl: string;
  requestId: string;
  data: any;
}

class RecraftUpscaleService {
  async upscaleImage(imageUrl: string, options: RecraftUpscaleOptions = {}): Promise<string> {
    try {
      console.log('Recraft Crisp Upscale request:', { imageUrl, options });

      const response = await fetch('/api/recraft/upscale', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_url: imageUrl.trim(),
          sync_mode: options.syncMode || false,
          enable_safety_checker: options.enableSafetyChecker !== false
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Network error' }));
        throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const result: RecraftUpscaleResponse = await response.json();
      console.log('Recraft Crisp Upscale successful:', result);

      if (!result.upscaledImageUrl) {
        throw new Error('No upscaled image URL received from Recraft Upscale service');
      }

      return result.upscaledImageUrl;
    } catch (error) {
      console.error('Recraft Upscale service error:', error);
      throw error;
    }
  }
}

export const recraftUpscaleService = new RecraftUpscaleService(); 