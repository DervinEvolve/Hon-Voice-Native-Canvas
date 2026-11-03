export const wanImageService = {
  async textToImage(prompt: string, options: { image_size?: string; negative_prompt?: string; seed?: number; num_images?: number } = {}): Promise<string> {
    const submit = await fetch('/api/wan/text-to-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...options })
    });
    if (submit.status !== 202) throw new Error(await submit.text());
    const { request_id } = await submit.json();
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const s = await fetch(`/api/wan/image-status?requestId=${encodeURIComponent(request_id)}`);
      if (!s.ok) continue;
      const status = await s.json();
      if (status.status === 'COMPLETED') {
        const url = status?.result?.data?.images?.[0]?.url || status?.result?.images?.[0]?.url;
        if (!url) throw new Error('No WAN image URL in result');
        return url as string;
      }
    }
    throw new Error('WAN text-to-image timed out');
  }
};


