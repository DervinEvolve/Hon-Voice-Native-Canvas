export interface ReveImageOptions {
  aspect_ratio?: '16:9' | '9:16' | '3:2' | '2:3' | '4:3' | '3:4' | '1:1';
  num_images?: number;
  output_format?: 'png' | 'jpeg' | 'webp';
}

export const reveImageService = {
  async generateImage(prompt: string, options: ReveImageOptions = {}): Promise<string> {
    const response = await fetch('/api/reve/text-to-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...options })
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Reve t2i failed: ${response.status} ${errorData.error || ''}`);
    }
    const data = await response.json();
    const first = Array.isArray(data.images) ? data.images[0] : undefined;
    if (!first) throw new Error('No image returned');
    return first;
  }
};

