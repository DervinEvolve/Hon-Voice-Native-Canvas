import { mediaService } from './mediaService';
import { pollJob, falQueueVideoUrl } from './jobPolling';

const SUPPORTED_IMAGE_TYPES = ['image/jpg', 'image/jpeg', 'image/png', 'image/webp'];

// Define common input interface
interface BaseVideoInput {
  imageUrl: string;
  prompt?: string;
}

// Define specific input types if models require different params
interface MinimaxInput extends BaseVideoInput {}
interface Veo2Input extends BaseVideoInput {
  aspect_ratio?: 'auto' | 'auto_prefer_portrait' | '16:9' | '9:16';
  duration?: '5s' | '6s' | '7s' | '8s';
}
interface Kling2Input extends BaseVideoInput {
  aspect_ratio?: '16:9' | '9:16' | '1:1';
  duration?: '5' | '10'; // Note: Kling uses numbers as strings here
  cfg_scale?: number;
  negative_prompt?: string;
}

export class VideoService {
  constructor() {
    // No longer configuring FAL client - using secure backend endpoints
  }

  // WAN 2.2-5B Fast Text-to-Video (secure backend)
  async generateWanVideo({ prompt, fps, num_frames, resolution }: { prompt: string; fps?: number; num_frames?: number; resolution?: '480p' | '580p' | '720p' }) {
    const response = await fetch('/api/wan/text-to-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, fps, num_frames, resolution })
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`WAN t2v failed: ${response.status} ${errorData.error || ''}`);
    }
    const data = await response.json();
    return { videoUrl: data.videoUrl as string };
  }

  // Marey Realism v1.5 Text-to-Video (secure backend)
  async generateMareyVideo({ prompt, aspect_ratio, duration, negative_prompt, seed, image_url }: {
    prompt: string;
    aspect_ratio?: '1920x1080' | '1080x1920' | '1152x1152' | '1536x1152' | '1152x1536';
    duration?: '5s' | '10s';
    negative_prompt?: string;
    seed?: number;
    image_url?: string;
  }) {
    const response = await fetch('/api/marey/text-to-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, aspect_ratio, duration, negative_prompt, seed, image_url })
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Marey t2v failed: ${response.status} ${errorData.error || ''}`);
    }
    // The submit route answers 202 with a job token; the video comes from the status route.
    const data = await response.json();
    const videoUrl = await pollJob({ url: '/api/marey/status?requestId=', token: data.request_id, isDone: falQueueVideoUrl });
    return { videoUrl };
  }
  // Specific function for Minimax (via backend)
  async generateMinimaxVideo(input: MinimaxInput) {
    try {
      console.log('[VideoService] Generating Minimax video via secure backend');
      
      // Note: This uses the existing minimax endpoint
      const response = await fetch('/api/minimax/image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_url: input.imageUrl,
          prompt: input.prompt || ''
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
        throw new Error(`Minimax video generation failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
      }

      // The submit route answers 202 with a job token; the video comes from the status route.
      const result = await response.json();
      const videoUrl = await pollJob({ url: '/api/minimax/image-status?requestId=', token: result.request_id, isDone: falQueueVideoUrl });
      return { videoUrl };
    } catch (error) {
      console.error('[VideoService] Minimax generation error:', error);
      throw error;
    }
  }

  // Specific function for Veo 2 (via backend)
  async generateFalVeo2Video(input: Veo2Input) {
    try {
      console.log('[VideoService] Generating Veo2 video via secure backend');
      
      const response = await fetch('/api/video/veo2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageUrl: input.imageUrl,
          prompt: input.prompt || '',
          aspect_ratio: input.aspect_ratio || 'auto',
          duration: input.duration || '5s'
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
        throw new Error(`Veo2 video generation failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
      }

      const result = await response.json();
      return { videoUrl: result.videoUrl };
    } catch (error) {
      console.error('[VideoService] Veo2 generation error:', error);
      throw error;
    }
  }

  // Specific function for Kling 2.0 (via backend)
  async generateFalKling2Video(input: Kling2Input) {
    try {
      console.log('[VideoService] Generating Kling2 video via secure backend');
      
      const response = await fetch('/api/video/kling2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageUrl: input.imageUrl,
          prompt: input.prompt || '',
          aspect_ratio: input.aspect_ratio || '16:9',
          duration: input.duration || '5',
          cfg_scale: input.cfg_scale || 0.5,
          negative_prompt: input.negative_prompt || 'blur, distort, and low quality'
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
        throw new Error(`Kling2 video generation failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
      }

      const result = await response.json();
      return { videoUrl: result.videoUrl };
    } catch (error) {
      console.error('[VideoService] Kling2 generation error:', error);
      throw error;
    }
  }

  // Seedance image-to-video - Updated to use secure backend
  async generateSeedanceImageToVideo({ imageUrl, prompt = '', duration = '5', resolution = '720p', cameraFixed = false, seed }: {
    imageUrl: string;
    prompt?: string;
    duration?: '5' | '10';
    resolution?: '480p' | '720p';
    cameraFixed?: boolean;
    seed?: number;
  }) {
    console.log('🎬 Starting secure Seedance image-to-video generation...');
    
    // Use secure backend endpoint instead of fal.ai directly
    const response = await fetch('/api/seedance/image-to-video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        image_url: imageUrl,
        duration,
        resolution,
        camera_fixed: cameraFixed,
        ...(typeof seed === 'number' && { seed })
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
      throw new Error(`Seedance image-to-video failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
    }

    const result = await response.json();
    console.log('Seedance image-to-video job submitted:', result.request_id);

    // Poll for completion using our secure status endpoint
    return this._pollSeedanceCompletion(result.request_id, 'image-to-video');
  }

  // --- Enhanced uploadImage function with Data URI fallback --- 
  async uploadImage(file: File): Promise<string> {
    try {
      if (!file.type || !SUPPORTED_IMAGE_TYPES.includes(file.type)) {
        throw new Error('Unsupported image type. Please use JPG, JPEG, PNG, or WebP.');
      }

      console.log('[VideoService] Uploading image to Cloudinary...');
      const imageUrl = await mediaService.upload(file);
      console.log('[VideoService] Image uploaded successfully:', imageUrl);
      
      // If we get a blob URL (fallback from failed Cloudinary upload), convert to Data URI
      if (imageUrl.startsWith('blob:')) {
        console.log('[VideoService] Cloudinary failed, converting to Data URI for fal.ai compatibility...');
        
        // Check file size - warn if very large
        const fileSizeMB = file.size / (1024 * 1024);
        if (fileSizeMB > 10) {
          console.warn(`[VideoService] Large image file: ${fileSizeMB.toFixed(1)}MB - this may cause performance issues`);
        }
        
        // Convert to Data URI
        const dataUri = await this.fileToDataUri(file);
        console.log(`[VideoService] Converted to Data URI (${dataUri.length} characters)`);
        return dataUri;
      }
      
      return imageUrl;
    } catch (error) {
      console.error('[VideoService] Upload error:', error);
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

  // New secure polling method for Seedance
  private async _pollSeedanceCompletion(requestId: string, modelType: 'text-to-video' | 'image-to-video'): Promise<string> {
    const maxAttempts = 60; // 5 minutes at 5-second intervals
    let attempts = 0;

    console.log(`Starting Seedance polling for request ${requestId} (${modelType})`);

    while (attempts < maxAttempts) {
      attempts++;
      
      try {
        const statusResponse = await fetch(`/api/seedance/status?request_id=${encodeURIComponent(requestId)}&model_type=${modelType}`);
        
        if (!statusResponse.ok) {
          console.warn(`Failed to check Seedance status: ${statusResponse.status}`);
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }

        const statusResult = await statusResponse.json();
        console.log(`Seedance status check ${attempts}/${maxAttempts}:`, {
          request_id: requestId,
          status: statusResult.status
        });

        if (statusResult.status === 'COMPLETED' && statusResult.video_url) {
          console.log(`✅ Seedance video completed! Video URL: ${statusResult.video_url.substring(0, 50)}...`);
          return statusResult.video_url;
        } else if (statusResult.status === 'FAILED') {
          throw new Error(`Seedance generation failed: ${statusResult.error || 'Unknown error'}`);
        }

        // Still processing, wait and continue
        await new Promise(resolve => setTimeout(resolve, 5000));
        
      } catch (error) {
        console.error(`Error checking Seedance status:`, error);
        if (attempts >= maxAttempts) {
          throw new Error('Failed to check Seedance generation status');
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    throw new Error('Seedance generation timed out');
  }
}

export const videoService = new VideoService(); 