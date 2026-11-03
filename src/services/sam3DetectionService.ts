/**
 * SAM3 Object Detection Service
 * Uses FAL.ai SAM3 API to detect objects in images
 */

export interface SAM3DetectionResult {
  success: boolean;
  objects: string[];
  count?: number;
  error?: string;
}

/**
 * Detect objects in an image using SAM3 via FAL.ai
 * @param imageUrl - URL of the image to analyze
 * @returns Array of detected object names
 */
const detectionCache = new Map<string, { objects: string[]; timestamp: number }>();
const inflightDetections = new Map<string, Promise<string[]>>();
const DETECTION_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export async function detectObjects(imageUrl: string, options: { force?: boolean } = {}): Promise<string[]> {
  const { force = false } = options;
  const cacheEntry = detectionCache.get(imageUrl);
  if (!force && cacheEntry && Date.now() - cacheEntry.timestamp < DETECTION_CACHE_TTL) {
    return cacheEntry.objects;
  }

  if (!force) {
    const inflight = inflightDetections.get(imageUrl);
    if (inflight) {
      return inflight;
    }
  }

  const requestPromise = (async () => {
    try {
      const response = await fetch('/api/fal/sam3-detect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ imageUrl }),
      });
  
      if (!response.ok) {
        console.warn('[SAM3] Detection request failed:', response.status);
        return [];
      }
  
      const data: SAM3DetectionResult = await response.json();
      
      if (data.success && Array.isArray(data.objects)) {
        detectionCache.set(imageUrl, { objects: data.objects, timestamp: Date.now() });
        return data.objects;
      }
  
      return [];
    } catch (error) {
      console.error('[SAM3] Detection error:', error);
      return [];
    } finally {
      inflightDetections.delete(imageUrl);
    }
  })();

  inflightDetections.set(imageUrl, requestPromise);
  return requestPromise;
}

/**
 * Detect objects with error handling and retry logic
 * @param imageUrl - URL of the image to analyze
 * @param retries - Number of retry attempts (default: 1)
 * @returns Array of detected object names
 */
export async function detectObjectsWithRetry(
  imageUrl: string,
  retries: number = 1
): Promise<string[]> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const objects = await detectObjects(imageUrl, { force: attempt > 0 });
      if (objects.length > 0 || attempt === retries) {
        return objects;
      }
      // Wait before retry (exponential backoff)
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    } catch (error) {
      console.error(`[SAM3] Detection attempt ${attempt + 1} failed:`, error);
      if (attempt === retries) {
        return [];
      }
    }
  }
  return [];
}

export function clearDetectionCache(imageUrl?: string) {
  if (imageUrl) {
    detectionCache.delete(imageUrl);
    inflightDetections.delete(imageUrl);
  } else {
    detectionCache.clear();
    inflightDetections.clear();
  }
}


