/**
 * Flux 2 Pro Text-to-Image Service
 * https://fal.ai/models/fal-ai/flux-2-pro
 * 
 * Next generation of Flux with improved quality and speed.
 */

export type Flux2ProImageSize =
  | 'square_hd'
  | 'square'
  | 'portrait_4_3'
  | 'portrait_16_9'
  | 'landscape_4_3'
  | 'landscape_16_9'
  | { width: number; height: number };

export interface Flux2ProOptions {
  image_size?: Flux2ProImageSize;
  seed?: number;
  safety_tolerance?: '1' | '2' | '3' | '4' | '5' | '6';
  enable_safety_checker?: boolean;
  output_format?: 'jpeg' | 'png';
}

class Flux2ProService {
  async generateImage(prompt: string, options: Flux2ProOptions = {}): Promise<string> {
    const response = await fetch('/api/fal/flux-2-pro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...options })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Flux 2 Pro generation failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const imageUrl = result?.imageUrl || result?.images?.[0]?.url;
    if (!imageUrl) {
      throw new Error('Flux 2 Pro returned no images');
    }
    return imageUrl;
  }
}

export const flux2ProService = new Flux2ProService();

