export interface DreaminaOptions {
  image_size?: 'square_hd' | 'square' | 'portrait_4_3' | 'portrait_16_9' | 'landscape_4_3' | 'landscape_16_9' | { width: number; height: number };
  num_images?: number;
  seed?: number;
  enhance_prompt?: boolean;
}

export const dreaminaImageService = {
  async generateImage(prompt: string, options: DreaminaOptions = {}): Promise<string> {
    const response = await fetch('/api/dreamina/text-to-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...options })
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Dreamina t2i failed: ${response.status} ${errorData.error || ''}`);
    }
    const data = await response.json();
    const first = Array.isArray(data.images) ? data.images[0] : undefined;
    if (!first) throw new Error('No image returned');
    return first;
  }
};


