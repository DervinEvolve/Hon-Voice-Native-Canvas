/**
 * Z-Image Turbo Text-to-Image Service
 * https://fal.ai/models/fal-ai/z-image/turbo
 * 
 * Ultra-fast image generation with 8 inference steps.
 */

export type ZImageTurboImageSize =
  | 'square_hd'
  | 'square'
  | 'portrait_4_3'
  | 'portrait_16_9'
  | 'landscape_4_3'
  | 'landscape_16_9'
  | { width: number; height: number };

export interface ZImageTurboOptions {
  image_size?: ZImageTurboImageSize;
  num_inference_steps?: number; // Default: 8
  seed?: number;
  num_images?: number;
  enable_safety_checker?: boolean;
  enable_prompt_expansion?: boolean;
  output_format?: 'jpeg' | 'png';
  acceleration?: 'none' | 'regular' | 'high';
}

class ZImageTurboService {
  async generateImage(prompt: string, options: ZImageTurboOptions = {}): Promise<string> {
    const response = await fetch('/api/fal/z-image-turbo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...options })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Z-Image Turbo generation failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const imageUrl = result?.imageUrl || result?.images?.[0]?.url;
    if (!imageUrl) {
      throw new Error('Z-Image Turbo returned no images');
    }
    return imageUrl;
  }
}

export const zImageTurboService = new ZImageTurboService();

