interface CacheEntry {
  url: string;
  blob: Blob;
  timestamp: number;
}

class MediaCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly maxAge = 1000 * 60 * 60; // 1 hour

  async get(url: string): Promise<string | null> {
    const entry = this.cache.get(url);
    
    if (!entry) return null;
    
    // Check if cached entry is still valid
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(url);
      return null;
    }

    return URL.createObjectURL(entry.blob);
  }

  async set(url: string, blob: Blob): Promise<string> {
    this.cache.set(url, {
      url,
      blob,
      timestamp: Date.now(),
    });

    return URL.createObjectURL(blob);
  }

  async preload(url: string): Promise<string> {
    const cached = await this.get(url);
    if (cached) return cached;

    try {
      const response = await fetch(url);
      const blob = await response.blob();
      return this.set(url, blob);
    } catch (error) {
      console.error('Failed to preload media:', error);
      throw error;
    }
  }

  clear() {
    this.cache.forEach((entry) => {
      URL.revokeObjectURL(entry.url);
    });
    this.cache.clear();
  }
}

export const mediaCache = new MediaCache(); 