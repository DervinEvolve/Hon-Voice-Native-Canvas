/**
 * Ovis Image Service
 * https://fal.ai/models/fal-ai/ovis-image/api
 * 
 * Ovis-Image is a 7B text-to-image model specifically optimized for 
 * quick, high quality text rendering.
 */

export type OvisImageSize =
  | 'square_hd'
  | 'square'
  | 'portrait_4_3'
  | 'portrait_16_9'
  | 'landscape_4_3'
  | 'landscape_16_9'
  | { width: number; height: number };

export type OvisOutputFormat = 'jpeg' | 'png' | 'webp';
export type OvisAcceleration = 'none' | 'regular' | 'high';

export interface OvisImageOptions {
  negative_prompt?: string;
  image_size?: OvisImageSize;
  num_inference_steps?: number; // Default: 28
  guidance_scale?: number; // Default: 5
  seed?: number;
  num_images?: number; // Default: 1
  enable_safety_checker?: boolean; // Default: true
  output_format?: OvisOutputFormat; // Default: 'png'
  acceleration?: OvisAcceleration; // Default: 'regular'
}

export interface OvisImageResult {
  url: string;
  width: number;
  height: number;
  content_type?: string;
}

class OvisImageService {
  async generateImage(prompt: string, options: OvisImageOptions = {}): Promise<string> {
    const response = await fetch('/api/fal/ovis-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...options })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ovis-Image generation failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const images = result?.images;
    if (!Array.isArray(images) || images.length === 0 || !images[0]?.url) {
      throw new Error('Ovis-Image returned no images');
    }
    return images[0].url as string;
  }

  async generateMultiple(prompt: string, options: OvisImageOptions & { num_images: number }): Promise<OvisImageResult[]> {
    const response = await fetch('/api/fal/ovis-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...options })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ovis-Image generation failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const images = result?.images;
    if (!Array.isArray(images) || images.length === 0) {
      throw new Error('Ovis-Image returned no images');
    }
    return images;
  }
}

export const ovisImageService = new OvisImageService();

