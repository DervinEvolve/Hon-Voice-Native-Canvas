export interface NanoBananaEditOptions {
  num_images?: number;
}

export const nanoBananaEditService = {
  async editImage(prompt: string, imageUrls: string[], options: NanoBananaEditOptions = {}): Promise<string> {
    const response = await fetch('/api/fal/nano-banana-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, image_urls: imageUrls, ...(options.num_images ? { num_images: options.num_images } : {}) })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({} as any));
      throw new Error(err.error || `Nano Banana Pro edit failed: ${response.status}`);
    }
    const data = await response.json();
    const first = Array.isArray(data.images) && data.images[0];
    const url = first?.url || first?.image?.url || null;
    if (!url) throw new Error('Nano Banana Pro edit returned no image URL');
    return url;
  }
};


