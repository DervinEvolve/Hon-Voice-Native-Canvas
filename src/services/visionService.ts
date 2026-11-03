import { useComicStore } from '../store/useComicStore';

export interface IsaacOptions {
  prompt?: string;
  response_style?: 'text' | 'box' | 'point' | 'polygon';
}

export interface IsaacResultPartial {
  output?: string;
  partial?: boolean;
  response_style?: string;
  boxes?: any[];
  points?: any[];
  polygons?: any[];
  error?: string;
}

// Simple in-memory cache keyed by imageUrl+prompt+style
const cache = new Map<string, IsaacResultPartial>();

export async function analyzeWithIsaacStreaming(imageUrl: string, opts: IsaacOptions, onPartial: (p: IsaacResultPartial) => void): Promise<IsaacResultPartial> {
  const key = `${imageUrl}|${opts?.prompt || ''}|${opts?.response_style || ''}`;
  if (cache.has(key)) {
    const cached = cache.get(key)!;
    onPartial({ ...cached, partial: false });
    return cached;
  }

  const resp = await fetch('/api/fal/isaac-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl, ...opts })
  });

  if (!resp.ok) {
    const error = await resp.text().catch(() => 'isaac stream failed');
    const fail = { error } as IsaacResultPartial;
    onPartial(fail);
    return fail;
  }

  return new Promise<IsaacResultPartial>((resolve) => {
    const reader = (resp as any).body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const final: IsaacResultPartial = {};

    const feed = () => reader.read().then(({ value, done }: any) => {
      if (done) {
        resolve(final);
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const chunk of parts) {
        const lines = chunk.split('\n');
        const eventLine = lines.find(l => l.startsWith('event:')) || '';
        const dataLine = lines.find(l => l.startsWith('data:')) || '';
        const evt = eventLine.replace('event: ', '').trim();
        const dataStr = dataLine.replace('data: ', '');
        try {
          const data = JSON.parse(dataStr);
          if (evt === 'isaac-partial') {
            onPartial({ ...data, partial: true });
          } else if (evt === 'isaac-final') {
            Object.assign(final, data, { partial: false });
            cache.set(key, final);
          } else if (evt === 'isaac-error') {
            onPartial({ error: data?.error || 'isaac error' });
          }
        } catch {}
      }
      feed();
    });

    feed();
  });
}

export async function analyzePanelWithIsaac(panelId: string, options: IsaacOptions, onPartial: (p: IsaacResultPartial) => void) {
  const state = useComicStore.getState();
  const page = state.currentPageIndex;
  const panel = state.currentComic?.pages[page]?.find(p => p.id === panelId);
  const imageUrl = panel?.url;
  if (!imageUrl) {
    onPartial({ error: 'panel has no imageUrl' });
    return { error: 'panel has no imageUrl' } as IsaacResultPartial;
  }
  return analyzeWithIsaacStreaming(imageUrl, options, onPartial);
}


