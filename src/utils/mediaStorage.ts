import { set, get, del } from 'idb-keyval';
import { nanoid } from 'nanoid';

interface CachedMedia {
  blob: Blob;
  type: string;
  timestamp: number;
  id: string;
}

const TTL = 24 * 60 * 60 * 1000; // 24 hours

export class MediaStorage {
  private objectUrls = new Map<string, string>();
  private fetchPromises = new Map<string, Promise<string>>();

  async store(key: string, blob: Blob): Promise<string> {
    const cached: CachedMedia = {
      blob,
      type: blob.type,
      timestamp: Date.now(),
      id: nanoid()
    };

    await set(key, cached);
    const objectUrl = URL.createObjectURL(blob);
    this.objectUrls.set(key, objectUrl);
    return objectUrl;
  }

  async load(key: string): Promise<string | null> {
    // If it's a blob URL, return it directly
    if (key.startsWith('blob:')) {
      return key;
    }

    try {
      // Check if we already have an object URL
      const existingUrl = this.objectUrls.get(key);
      if (existingUrl) return existingUrl;

      // Check if there's an ongoing fetch for this URL
      const existingPromise = this.fetchPromises.get(key);
      if (existingPromise) return existingPromise;

      // Try to get from IndexedDB
      const cached: CachedMedia | undefined = await get(key);
      
      if (!cached) return null;

      // Check if expired
      if (Date.now() - cached.timestamp > TTL) {
        await this.remove(key);
        return null;
      }

      // Create and store new object URL
      const objectUrl = URL.createObjectURL(cached.blob);
      this.objectUrls.set(key, objectUrl);
      return objectUrl;

    } catch (error) {
      console.error('Error loading media:', error);
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    const objectUrl = this.objectUrls.get(key);
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      this.objectUrls.delete(key);
    }
    this.fetchPromises.delete(key);
    await del(key);
  }

  async getCachedMedia(key: string): Promise<CachedMedia | null> {
    try {
      const cached: CachedMedia | undefined = await get(key);
      if (!cached) return null;
      
      if (Date.now() - cached.timestamp > TTL) {
        await this.remove(key);
        return null;
      }
      
      return cached;
    } catch (error) {
      console.error('Error getting cached media:', error);
      return null;
    }
  }

  async fetchAndStore(url: string): Promise<string> {
    // If it's already a blob URL, return it directly
    if (url.startsWith('blob:')) {
      return url;
    }

    // Check if we already have an object URL
    const existingUrl = this.objectUrls.get(url);
    if (existingUrl) return existingUrl;

    // Check if there's an ongoing fetch
    const existingPromise = this.fetchPromises.get(url);
    if (existingPromise) return existingPromise;

    const fetchPromise = (async () => {
      try {
        const response = await fetch(url, {
          cache: 'force-cache',
          credentials: 'omit',
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        
        await this.store(url, blob);
        this.objectUrls.set(url, objectUrl);
        return objectUrl;
      } finally {
        this.fetchPromises.delete(url);
      }
    })();

    this.fetchPromises.set(url, fetchPromise);
    return fetchPromise;
  }

  revokeAll(): void {
    for (const objectUrl of this.objectUrls.values()) {
      URL.revokeObjectURL(objectUrl);
    }
    this.objectUrls.clear();
    this.fetchPromises.clear();
  }
}

export const mediaStorage = new MediaStorage();