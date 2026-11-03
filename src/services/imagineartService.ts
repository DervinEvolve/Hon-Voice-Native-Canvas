/**
 * ImagineArt 1.5 Preview Text-to-Image Service
 * https://fal.ai/models/imagineart/imagineart-1.5-preview/text-to-image/api
 * 
 * ImagineArt 1.5 generates high-fidelity professional-grade visuals with 
 * lifelike realism, strong aesthetics, and text that actually reads correctly.
 */

export type ImagineartImageSize =
  | 'square_hd'
  | 'square'
  | 'portrait_4_3'
  | 'portrait_16_9'
  | 'landscape_4_3'
  | 'landscape_16_9'
  | { width: number; height: number };

export type ImagineartOutputFormat = 'jpeg' | 'png' | 'webp';

export interface ImagineartOptions {
  negative_prompt?: string;
  image_size?: ImagineartImageSize;
  num_images?: number;
  seed?: number;
  guidance_scale?: number;
  num_inference_steps?: number;
  enable_safety_checker?: boolean;
  output_format?: ImagineartOutputFormat;
}

export interface ImagineartResult {
  url: string;
  width: number;
  height: number;
  content_type?: string;
}

class ImagineartService {
  async generateImage(prompt: string, options: ImagineartOptions = {}): Promise<string> {
    const response = await fetch('/api/fal/imagineart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...options })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ImagineArt generation failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const images = result?.images;
    if (!Array.isArray(images) || images.length === 0 || !images[0]?.url) {
      throw new Error('ImagineArt returned no images');
    }
    return images[0].url as string;
  }

  async generateMultiple(prompt: string, options: ImagineartOptions & { num_images: number }): Promise<ImagineartResult[]> {
    const response = await fetch('/api/fal/imagineart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...options })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ImagineArt generation failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const images = result?.images;
    if (!Array.isArray(images) || images.length === 0) {
      throw new Error('ImagineArt returned no images');
    }
    return images;
  }
}

export const imagineartService = new ImagineartService();

