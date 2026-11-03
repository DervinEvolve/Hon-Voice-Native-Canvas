/**
 * Bytedance Seedream v4.5 Text-to-Image Service
 * https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/text-to-image
 * 
 * Seedream 4.5 integrates image generation and image editing capabilities 
 * into a single, unified architecture. Delivers up to 4 megapixels (2048x2048)
 * at $0.04 per image.
 */

export type SeedreamV45ImageSize =
  | 'square_hd'
  | 'square'
  | 'portrait_4_3'
  | 'portrait_16_9'
  | 'landscape_4_3'
  | 'landscape_16_9'
  | { width: number; height: number };

export interface SeedreamV45Options {
  negative_prompt?: string;
  image_size?: SeedreamV45ImageSize;
  num_images?: number; // 1-6 images per call
  seed?: number;
  enable_safety_checker?: boolean;
  sync_mode?: boolean; // If true, returns data URI instead of URL
}

export interface SeedreamV45Result {
  url: string;
  width?: number;
  height?: number;
}

class SeedreamV45Service {
  async generateImage(prompt: string, options: SeedreamV45Options = {}): Promise<string> {
    const response = await fetch('/api/fal/seedream-v45', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...options })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Seedream v4.5 generation failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const images = result?.images;
    if (!Array.isArray(images) || images.length === 0 || !images[0]?.url) {
      throw new Error('Seedream v4.5 returned no images');
    }
    return images[0].url as string;
  }

  async generateMultiple(prompt: string, options: SeedreamV45Options & { num_images: number }): Promise<SeedreamV45Result[]> {
    const response = await fetch('/api/fal/seedream-v45', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...options })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Seedream v4.5 generation failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const images = result?.images;
    if (!Array.isArray(images) || images.length === 0) {
      throw new Error('Seedream v4.5 returned no images');
    }
    return images;
  }
}

export const seedreamV45Service = new SeedreamV45Service();

