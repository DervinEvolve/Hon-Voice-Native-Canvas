import { mediaService } from '../utils/mediaService';

export interface KlingProI2VOptions {
  tailImageUrl?: string;
  duration?: '5' | '10';
  negative_prompt?: string;
  cfg_scale?: number; // default 0.5
  prompt?: string;
}

class KlingProService {
  async uploadImage(file: File): Promise<string> {
    // Reuse shared upload logic with direct unsigned Cloudinary + proxy fallbacks
    return mediaService.upload(file);
  }

  async submitImageToVideo(imageUrl: string, opts: KlingProI2VOptions) {
    const res = await fetch('/api/kling/pro-image-to-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        tail_image_url: opts.tailImageUrl,
        duration: opts.duration || '5',
        negative_prompt: opts.negative_prompt,
        cfg_scale: typeof opts.cfg_scale === 'number' ? opts.cfg_scale : 0.5,
        prompt: opts.prompt,
      })
    });
    if (res.status !== 202) {
      const t = await res.text();
      throw new Error(`Submit failed: ${t}`);
    }
    return res.json();
  }

  async pollStatus(requestId: string): Promise<string> {
    const maxMs = 10 * 60 * 1000;
    const start = Date.now();
    let attempt = 0;
    while (Date.now() - start < maxMs) {
      const res = await fetch(`/api/kling/pro-image-status?requestId=${encodeURIComponent(requestId)}`);
      if (!res.ok) throw new Error(`Status failed: ${res.status}`);
      const json = await res.json();
      if (json.status === 'COMPLETED') {
        if (json.videoUrl) return json.videoUrl as string;
        // Best-effort nesting scan
        const findUrl = (o: any): string | null => {
          if (!o || typeof o !== 'object') return null;
          for (const k of Object.keys(o)) {
            const v = (o as any)[k];
            if (typeof v === 'string' && /https?:\/\/.+\.(mp4|webm)/i.test(v)) return v;
            if (v && typeof v === 'object') { const r = findUrl(v); if (r) return r; }
          }
          return null;
        };
        const url = findUrl(json.result);
        if (!url) throw new Error('No video URL in result');
        return url;
      }
      if (json.status === 'FAILED' || json.error) throw new Error(json.error || 'Generation failed');
      attempt++;
      const delay = Math.min(15000, 1000 * Math.pow(1.5, attempt));
      await new Promise(r => setTimeout(r, delay));
    }
    throw new Error('Timed out waiting for Kling Pro video');
  }
}

export const klingProService = new KlingProService();


