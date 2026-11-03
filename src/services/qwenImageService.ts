export type QwenImageSize =
  | 'square_hd'
  | 'square'
  | 'portrait_4_3'
  | 'portrait_16_9'
  | 'landscape_4_3'
  | 'landscape_16_9'
  | { width: number; height: number };

interface QwenImageOptions {
  image_size?: QwenImageSize;
  num_inference_steps?: number;
  seed?: number;
  guidance_scale?: number;
  negative_prompt?: string;
}

class QwenImageService {
  async generateImage(prompt: string, options: QwenImageOptions = {}): Promise<string> {
    const response = await fetch('/api/fal/qwen-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...options })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Qwen-Image generation failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const images = result?.images;
    if (!Array.isArray(images) || images.length === 0 || !images[0]?.url) {
      throw new Error('Qwen-Image returned no images');
    }
    return images[0].url as string;
  }
}

export const qwenImageService = new QwenImageService();

