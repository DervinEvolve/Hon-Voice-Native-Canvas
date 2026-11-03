import { mediaService } from './mediaService';

const SUPPORTED_IMAGE_TYPES = ['image/jpg', 'image/jpeg', 'image/png', 'image/webp'];

interface GenerateVideoOptions {
  referenceImageUrl: string;
  prompt: string;
}

export class MinimaxVideoService {
  constructor() {
    // No longer configuring FAL client - using secure backend endpoints
  }

  async generateVideo({ referenceImageUrl, prompt }: GenerateVideoOptions) {
    if (!prompt) {
      throw new Error('Prompt is required for video generation');
    }

    try {
      console.log('[MinimaxVideoService] Starting video generation via secure backend');
      
      const response = await fetch('/api/minimax/character-reference', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          referenceImageUrl,
          prompt
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
        throw new Error(`Minimax character reference failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
      }

      const result = await response.json();
      console.log('[MinimaxVideoService] Request submitted with ID:', result.request_id);

      // Poll for completion using secure status endpoint
      return this._pollForCompletion(result.request_id);
    } catch (error) {
      console.error('[MinimaxVideoService] Generation error:', error);
      throw new Error(`API Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _pollForCompletion(requestId: string): Promise<{ status: string; videoUrl: string }> {
    const maxAttempts = 60; // 5 minutes at 5-second intervals
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;
      
      try {
        const statusResponse = await fetch(`/api/minimax/character-status?requestId=${encodeURIComponent(requestId)}`);
        
        if (!statusResponse.ok) {
          console.warn(`Failed to check status: ${statusResponse.status}`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }

        const status = await statusResponse.json();
        console.log('[MinimaxVideoService] Status:', status.status);

        if (status.status === 'COMPLETED' && status.videoUrl) {
          console.log('[MinimaxVideoService] Generation completed:', status.videoUrl);
          return {
            status: 'succeeded',
            videoUrl: status.videoUrl
          };
        }

        if (status.status === 'FAILED') {
          throw new Error(`Video generation failed: ${status.error || 'Unknown error'}`);
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error('[MinimaxVideoService] Status check error:', error);
        if (attempts >= maxAttempts) {
          throw new Error('Video generation timed out');
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    throw new Error('Video generation timed out');
  }

  async uploadImage(file: File): Promise<string> {
    try {
      if (!file.type || !SUPPORTED_IMAGE_TYPES.includes(file.type)) {
        throw new Error('Unsupported image type. Please use JPG, JPEG, PNG, or WebP.');
      }

      console.log('[MinimaxVideoService] Uploading image to Cloudinary...');
      const imageUrl = await mediaService.upload(file);
      console.log('[MinimaxVideoService] Image uploaded successfully:', imageUrl);
      
      // If we get a blob URL (fallback from failed Cloudinary upload), convert to Data URI
      if (imageUrl.startsWith('blob:')) {
        console.log('[MinimaxVideoService] Cloudinary failed, converting to Data URI for fal.ai compatibility...');
        
        // Check file size - warn if very large
        const fileSizeMB = file.size / (1024 * 1024);
        if (fileSizeMB > 10) {
          console.warn(`[MinimaxVideoService] Large image file: ${fileSizeMB.toFixed(1)}MB - this may cause performance issues`);
        }
        
        // Convert to Data URI
        const dataUri = await this.fileToDataUri(file);
        console.log(`[MinimaxVideoService] Converted to Data URI (${dataUri.length} characters)`);
        return dataUri;
      }
      
      return imageUrl;
    } catch (error) {
      console.error('[MinimaxVideoService] Upload error:', error);
      throw new Error('Failed to upload image. Please try again.');
    }
  }

  // Helper method to convert File to Data URI
  private async fileToDataUri(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('Failed to convert file to Data URI'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }
}

export const minimaxVideoService = new MinimaxVideoService(); 