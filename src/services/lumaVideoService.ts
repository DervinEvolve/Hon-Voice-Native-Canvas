import { pollJob } from './jobPolling';

// luma/status relays the Dream Machine generation: state is queued, dreaming,
// completed or failed, and the video URL sits in assets.video.
interface LumaStatusReply { state?: string; failure_reason?: string; assets?: { video?: unknown } }

function lumaVideoUrl(body: unknown): string | undefined {
  const reply = (body ?? {}) as LumaStatusReply;
  if (reply.state === 'failed') throw new Error(reply.failure_reason || 'Luma generation failed');
  if (reply.state !== 'completed') return undefined;
  const url = reply.assets?.video;
  if (typeof url !== 'string' || !url) throw new Error('No video URL in response');
  return url;
}

export interface VideoGenerationOptions {
  quality?: 'standard' | 'high' | 'ultra';
  duration?: '2s' | '3s' | '4s' | '5s' | '6s' | '7s' | '8s';
  aspectRatio?: '1:1' | '4:3' | '16:9' | '9:16' | 'portrait' | 'landscape' | 'square'; 
  motion?: 'normal' | 'gentle' | 'intense'; // Control motion intensity
  maxRetries?: number;
}

export const lumaVideoService = {
  generateVideo: async (
    prompt: string | null | undefined, 
    referenceImage: string, 
    options?: VideoGenerationOptions
  ): Promise<string> => {
    console.log('🎥 LUMA Ray-2 Image-to-Video generation request via secure backend:', { 
      referenceImageUrl: referenceImage.substring(0, 50) + '...',
      options 
    });
    
    try {
      // Map from our API to actual resolution values
      const qualityToResolution = {
        'standard': '540p',
        'high': '720p',
        'ultra': '1080p'
      };
      
      // Map aspect ratios
      const aspectRatioMap = {
        '1:1': '1:1',
        'square': '1:1', 
        '4:3': '4:3',
        '16:9': '16:9',
        'landscape': '16:9',
        '9:16': '9:16',
        'portrait': '9:16'
      };
      
      // Get quality level from options, default to high
      const qualityLevel = options?.quality || 'high';
      const resolution = qualityToResolution[qualityLevel];
      
      // Get aspect ratio from options, default to 16:9
      const aspectRatio = aspectRatioMap[options?.aspectRatio || '16:9'];
      
      // Call the secure backend endpoint
      const response = await fetch('/api/luma/video-generation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: prompt || '',
          operation_type: 'image_to_video',
          model: 'ray-flash-2',
          start_image_url: referenceImage,
          resolution,
          duration: options?.duration || '5s',
          aspect_ratio: aspectRatio,
          motion_intensity: options?.motion || 'normal'
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
        throw new Error(`Luma image-to-video failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
      }

      // The route answers with the generation's job token; the video comes from luma/status.
      const result = await response.json();
      return await pollJob({ url: '/api/luma/status?id=', token: result.id, isDone: lumaVideoUrl });
    } catch (error) {
      console.error('Luma image-to-video API error:', error);
      throw error;
    }
  }
}; 