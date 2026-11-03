export type QwenEditImageSize =
  | 'square_hd'
  | 'square'
  | 'portrait_4_3'
  | 'portrait_16_9'
  | 'landscape_4_3'
  | 'landscape_16_9'
  | { width: number; height: number };

export interface QwenImageEditOptions {
  image_size?: QwenEditImageSize;
  num_inference_steps?: number;
  seed?: number;
  guidance_scale?: number;
  negative_prompt?: string;
  output_format?: 'jpeg' | 'png';
  acceleration?: 'none' | 'regular' | 'high';
}

class QwenImageEditService {
  async editImage(
    prompt: string,
    imageUrl: string,
    options: QwenImageEditOptions = {}
  ): Promise<string> {
    const response = await fetch('/api/fal/qwen-image-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, image_url: imageUrl, ...options })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Qwen-Image-Edit failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const images = result?.images;
    if (!Array.isArray(images) || images.length === 0 || !images[0]?.url) {
      throw new Error('Qwen-Image-Edit returned no images');
    }
    return images[0].url as string;
  }
}

export const qwenImageEditService = new QwenImageEditService();


