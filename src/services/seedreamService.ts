export const seedreamService = {
  async textToImage(
    prompt: string,
    options: { image_size?: string; aspect_ratio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'; negative_prompt?: string; seed?: number; refs?: string[] } = {}
  ): Promise<string> {
    // Prefer image_size per FAL docs; map aspect_ratio when provided
    const image_size = (() => {
      if (options.image_size) return options.image_size;
      switch (options.aspect_ratio) {
        case '1:1': return 'square';
        case '16:9': return 'landscape_16_9';
        case '9:16': return 'portrait_16_9';
        case '4:3': return 'landscape_4_3';
        case '3:4': return 'portrait_4_3';
        default: return 'landscape_4_3';
      }
    })();
    const submitResp = await fetch('/api/fal/seedream-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, image_size, negative_prompt: options.negative_prompt, seed: options.seed, refs: Array.isArray(options.refs) ? options.refs : undefined })
    });
    if (submitResp.status !== 202) throw new Error(await submitResp.text());
    const { request_id } = await submitResp.json();
    // Poll status endpoint until completed
    const maxAttempts = 60; // up to ~5 minutes
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const s = await fetch(`/api/fal/seedream-status?requestId=${encodeURIComponent(request_id)}`);
      if (!s.ok) continue;
      const status = await s.json();
      if (status.status === 'COMPLETED') {
        const url = status?.result?.data?.images?.[0]?.url || status?.result?.images?.[0]?.url;
        if (!url) throw new Error('No image URL in Seedream result');
        return url as string;
      }
    }
    throw new Error('Seedream generation timed out');
  },

  async editImage(
    prompt: string,
    imageUrlOrRefs: { image_url?: string; image_urls?: string[]; refs?: string[]; mask_url?: string; negative_prompt?: string; strength?: number; seed?: number }
  ): Promise<string> {
    const resp = await fetch('/api/fal/seedream-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...imageUrlOrRefs })
    });
    if (!resp.ok) throw new Error(await resp.text());
    const data = await resp.json();
    return data.imageUrl as string;
  }
};


