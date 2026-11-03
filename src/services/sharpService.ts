import { accessHeaders } from './apiAccess';

/**
 * Sharp Service - Image to Gaussian Splat conversion
 *
 * Calls the Sharp API endpoints to convert images into 3D Gaussian splats.
 * Uses Modal for GPU inference and returns a .ply file URL.
 */

export interface SharpOptions {
  // Future options can be added here
  quality?: 'fast' | 'high';
}

export interface SharpResult {
  plyUrl: string;
  filename: string;
  sizeBytes: number;
}

// Track active generations for session recovery
const activeGenerations = new Map<
  string,
  {
    requestId: string;
    imageUrl: string;
    startTime: number;
    placeholderId?: string;
  }
>();

export const sharpService = {
  async refreshResultUrl(requestId: string): Promise<string> {
    if (!/^sharp_[0-9a-f-]{36}$/.test(requestId)) throw new Error('Invalid splat job');
    const response = await fetch(`/api/sharp/result?request_id=${encodeURIComponent(requestId)}`, { headers: await accessHeaders(), cache: 'no-store' });
    if (!response.ok) throw new Error('This private scene could not be opened. Sign in as its owner.');
    const result = await response.json();
    if (typeof result.ply_url !== 'string' || !result.ply_url.startsWith('https://')) throw new Error('Invalid private scene result');
    return result.ply_url;
  },
  /**
   * Submit an image for Gaussian splat generation
   */
  async submit(imageUrl: string, _options: SharpOptions = {}): Promise<string> {
    const response = await fetch('/api/sharp/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...await accessHeaders() },
      body: JSON.stringify({ imageUrl }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Sharp submit failed: ${text}`);
    }

    const json = await response.json();
    const requestId = json.request_id as string;

    // Track this generation
    activeGenerations.set(requestId, {
      requestId,
      imageUrl,
      startTime: Date.now(),
    });

    console.log('[sharpService] Submitted generation:', requestId);
    return requestId;
  },

  /**
   * Check if a generation is still active
   */
  isGenerationActive(requestId: string): boolean {
    return activeGenerations.has(requestId);
  },

  /**
   * Get all active generation IDs
   */
  getActiveGenerations(): string[] {
    return Array.from(activeGenerations.keys());
  },

  /**
   * Set placeholder ID for a generation
   */
  setPlaceholderId(requestId: string, placeholderId: string): void {
    const gen = activeGenerations.get(requestId);
    if (gen) {
      gen.placeholderId = placeholderId;
    }
  },

  /**
   * Get placeholder ID for a generation
   */
  getPlaceholderId(requestId: string): string | undefined {
    return activeGenerations.get(requestId)?.placeholderId;
  },

  /**
   * Wait for a Sharp generation to complete
   */
  async waitForResult(
    requestId: string,
    timeoutMs = 3 * 60 * 1000, // 3 minutes default
    onProgress?: (msg: string) => void
  ): Promise<SharpResult> {
    const start = Date.now();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let attempt = 0;

    console.log('[sharpService] Polling for:', requestId, 'timeout:', timeoutMs / 1000, 's');

    while (Date.now() - start < timeoutMs) {
      attempt++;
      const elapsed = Math.round((Date.now() - start) / 1000);

      try {
        const statusRes = await fetch(`/api/sharp/status?request_id=${encodeURIComponent(requestId)}`, {
          cache: 'no-store',
          headers: await accessHeaders(),
        });

        if (statusRes.ok) {
          const status = await statusRes.json();
          const serverElapsed = status.elapsed_seconds || elapsed;

          console.log(`[sharpService] Status check ${attempt}:`, status.status, 'Elapsed:', serverElapsed, 's', 'Client elapsed:', elapsed, 's');

          // Report progress
          if (onProgress) {
            if (status.status === 'pending') {
              onProgress(`Generating splat... (${elapsed}s)`);
            } else if (status.status === 'processing') {
              onProgress(`Processing image... (${elapsed}s)`);
            }
          }

          if (status.status === 'completed') {
            // Fetch the result
            const resultRes = await fetch(`/api/sharp/result?request_id=${encodeURIComponent(requestId)}`, { headers: await accessHeaders(), cache: 'no-store' });

            if (!resultRes.ok) {
              const text = await resultRes.text();
              throw new Error(`Failed to get result: ${text}`);
            }

            const result = await resultRes.json();

            // Clean up tracking
            activeGenerations.delete(requestId);
            console.log('[sharpService] Generation complete:', requestId);

            return {
              plyUrl: result.ply_url,
              filename: result.filename,
              sizeBytes: result.size_bytes,
            };
          }

          if (status.status === 'failed') {
            activeGenerations.delete(requestId);
            throw new Error(status.error || 'Generation failed');
          }
        } else {
          const errorText = await statusRes.text().catch(() => 'Unknown error');
          console.warn(`[sharpService] Status check failed (${statusRes.status}):`, errorText);
        }
      } catch (fetchError) {
        console.warn(`[sharpService] Network error during poll (attempt ${attempt}), retrying...`, fetchError);
      }

      // Exponential backoff with cap (start at 1s, max 5s)
      const backoff = Math.min(5000, 1000 + attempt * 200);
      await sleep(backoff);
    }

    // Timeout
    const finalElapsed = Math.round((Date.now() - start) / 1000);
    console.error(`[sharpService] Timeout waiting for ${requestId} after ${finalElapsed}s (${attempt} attempts)`);
    throw new Error('sharp_timeout');
  },

  /**
   * Generate a Gaussian splat from an image (convenience method)
   */
  async generateSplat(
    imageUrl: string,
    options: SharpOptions = {},
    onProgress?: (msg: string) => void
  ): Promise<SharpResult> {
    const requestId = await this.submit(imageUrl, options);
    return this.waitForResult(requestId, 3 * 60 * 1000, onProgress);
  },

  /**
   * Clean up stale generations (older than 5 minutes)
   */
  cleanupStale(): void {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000;

    for (const [requestId, gen] of activeGenerations.entries()) {
      if (now - gen.startTime > staleThreshold) {
        console.log('[sharpService] Cleaning up stale generation:', requestId);
        activeGenerations.delete(requestId);
      }
    }
  },
};

