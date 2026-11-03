export interface HiggsfieldSubmitResponse {
  request_id: string;
  status: 'IN_QUEUE' | string;
}

export interface HiggsfieldStatusResponse {
  status: 'PROCESSING' | 'COMPLETED';
  result?: { url?: string; soul_id?: string; raw?: any };
}

async function submit(endpoint: string, body: any): Promise<string> {
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (resp.status !== 202) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error || `Submit failed: ${resp.status}`);
  }
  const data: HiggsfieldSubmitResponse = await resp.json();
  if (!data?.request_id) throw new Error('Missing request_id');
  return data.request_id;
}

async function poll(requestId: string, timeoutMs = 5 * 60 * 1000, intervalMs = 4000): Promise<HiggsfieldStatusResponse> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`/api/higgsfield/status?requestId=${encodeURIComponent(requestId)}`);
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Status error: ${res.status} ${t}`);
    }
    const data: HiggsfieldStatusResponse = await res.json();
    if (data.status === 'COMPLETED') return data;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('Higgsfield job timed out');
}

export const higgsfieldService = {
  async soulTextToImage(
    prompt: string,
    options?: { aspect_ratio?: string; soul_id?: string; style_id?: string }
  ): Promise<string> {
    const requestId = await submit('/api/higgsfield/text-to-image', { prompt, ...(options || {}) });
    const status = await poll(requestId);
    const url = status?.result?.url;
    if (!url) throw new Error('No image URL in Higgsfield result');
    return url;
  },

  async imageToVideo(image_url: string, params: { prompt?: string; motion_id?: string }): Promise<string> {
    const requestId = await submit('/api/higgsfield/image-to-video', { image_url, ...params });
    const status = await poll(requestId, 10 * 60 * 1000, 5000);
    const url = status?.result?.url;
    if (!url) throw new Error('No video URL in Higgsfield result');
    return url;
  },

  async createSoulId(prompt: string, reference_images?: string[]): Promise<{ url?: string; soul_id?: string; raw?: any }> {
    const requestId = await submit('/api/higgsfield/create-soul-id', { prompt, reference_images });
    const status = await poll(requestId);
    return status.result || {};
  },

  async speak(options: {
    imageUrl: string;
    audioUrl: string;
    prompt?: string;
    quality?: 'high' | 'standard';
    enhance_prompt?: boolean;
    seed?: number;
    duration?: number;
  }): Promise<string> {
    const requestId = await submit('/api/higgsfield/speak', {
      params: {
        input_image: { type: 'image_url', image_url: options.imageUrl },
        input_audio: { type: 'audio_url', audio_url: options.audioUrl },
        prompt: options.prompt,
        quality: options.quality || 'high',
        enhance_prompt: options.enhance_prompt || false,
        seed: options.seed,
        duration: options.duration || 5,
      }
    });
    const status = await poll(requestId, 10 * 60 * 1000, 5000);
    const url = status?.result?.url;
    if (!url) throw new Error('No video URL in Higgsfield speak result');
    return url;
  }
};


