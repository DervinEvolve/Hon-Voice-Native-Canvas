/**
 * Longcat Image Text-to-Image Service
 * https://fal.ai/models/fal-ai/longcat-image
 * 
 * High-quality image generation with excellent prompt adherence.
 */

export type LongcatImageSize =
  | 'square_hd'
  | 'square'
  | 'portrait_4_3'
  | 'portrait_16_9'
  | 'landscape_4_3'
  | 'landscape_16_9'
  | { width: number; height: number };

export interface LongcatImageOptions {
  image_size?: LongcatImageSize;
  num_inference_steps?: number; // Default: 28
  seed?: number;
  num_images?: number;
  enable_safety_checker?: boolean;
  output_format?: 'jpeg' | 'png';
  guidance_scale?: number; // Default: 3.5
}

class LongcatImageService {
  async generateImage(prompt: string, options: LongcatImageOptions = {}): Promise<string> {
    const response = await fetch('/api/fal/longcat-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...options })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Longcat Image generation failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const imageUrl = result?.imageUrl || result?.images?.[0]?.url;
    if (!imageUrl) {
      throw new Error('Longcat Image returned no images');
    }
    return imageUrl;
  }
}

export const longcatImageService = new LongcatImageService();

