export interface HunyuanImageOptions {
  negative_prompt?: string;
  image_size?: 'square_hd' | 'square' | 'portrait_4_3' | 'portrait_16_9' | 'landscape_4_3' | 'landscape_16_9' | { width: number; height: number };
  num_images?: number;
  num_inference_steps?: number;
  guidance_scale?: number;
  seed?: number;
  enable_safety_checker?: boolean;
  output_format?: 'jpeg' | 'png';
  enable_prompt_expansion?: boolean;
}

export const hunyuanImageService = {
  async generateImage(prompt: string, options: HunyuanImageOptions = {}): Promise<string> {
    const response = await fetch('/api/hunyuan-image/text-to-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...options })
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Hunyuan Image v3 t2i failed: ${response.status} ${errorData.error || ''}`);
    }
    const data = await response.json();
    const first = Array.isArray(data.images) ? data.images[0] : undefined;
    if (!first) throw new Error('No image returned');
    return first;
  }
};

