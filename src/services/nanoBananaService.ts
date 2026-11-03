export interface NanoBananaOptions {
  num_images?: number;
}

export const nanoBananaService = {
  async generateImage(prompt: string, options: NanoBananaOptions = {}): Promise<string> {
    const response = await fetch('/api/fal/nano-banana', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...(options.num_images ? { num_images: options.num_images } : {}) })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({} as any));
      throw new Error(err.error || `Nano Banana Pro failed: ${response.status}`);
    }
    const data = await response.json();
    const first = Array.isArray(data.images) && data.images[0];
    const url = first?.url || first?.image?.url || null;
    if (!url) throw new Error('Nano Banana Pro returned no image URL');
    return url;
  }
};


