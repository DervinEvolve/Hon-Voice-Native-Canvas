export interface MeshySubmitOptions {
  mode?: 'preview' | 'full';
  topology?: 'quad' | 'triangle';
  enable_pbr?: boolean;
  texture_prompt?: string;
  texture_image_url?: string;
}

// Track active Meshy generations so they survive session disconnects
const activeGenerations = new Map<string, {
  requestId: string;
  prompt: string;
  startTime: number;
  placeholderId?: string;
  resolve?: (result: any) => void;
  reject?: (error: Error) => void;
}>();

export const meshyService = {
  async submit(prompt: string, options: MeshySubmitOptions = {}): Promise<string> {
    const resp = await fetch('/api/fal/meshy-text-to-3d', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...options })
    });
    if (!resp.ok) throw new Error(await resp.text());
    const js = await resp.json();
    const requestId = js.requestId as string;
    
    // Track this generation
    activeGenerations.set(requestId, {
      requestId,
      prompt,
      startTime: Date.now(),
    });
    
    console.log('[meshyService] Submitted generation:', requestId, 'Active generations:', activeGenerations.size);
    return requestId;
  },

  // Check if a generation is still active (for reconnection scenarios)
  isGenerationActive(requestId: string): boolean {
    return activeGenerations.has(requestId);
  },

  // Get all active generation IDs
  getActiveGenerations(): string[] {
    return Array.from(activeGenerations.keys());
  },

  // Set placeholder ID for a generation (so we can update it when done)
  setPlaceholderId(requestId: string, placeholderId: string) {
    const gen = activeGenerations.get(requestId);
    if (gen) {
      gen.placeholderId = placeholderId;
    }
  },

  // Get placeholder ID for a generation
  getPlaceholderId(requestId: string): string | undefined {
    return activeGenerations.get(requestId)?.placeholderId;
  },

  async waitForResult(requestId: string, timeoutMs = 5 * 60 * 1000, onProgress?: (msg: string) => void) {
    const start = Date.now();
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    let attempt = 0;
    let completedSeenAt: number | null = null;
    let lastProgressTime = Date.now();
    
    console.log('[meshyService] Starting to poll for:', requestId, 'timeout:', timeoutMs / 1000, 's');
    
    while (Date.now() - start < timeoutMs) {
      attempt++;
      
      try {
        const st = await fetch(`/api/fal/meshy-status?requestId=${encodeURIComponent(requestId)}`);
        if (st.ok) {
          const js = await st.json();
          const logs: string[] = js?.status?.logs?.map((l: any) => l?.message).filter(Boolean) || [];
          
          // Report progress
          if (logs.length > 0) {
            lastProgressTime = Date.now();
            logs.slice(-3).forEach(m => {
              console.log('[meshyService] Progress:', m);
              onProgress?.(String(m));
            });
          }
          
          const s: string = (js?.status?.status || js?.status) as string;
          console.log('[meshyService] Status:', s, 'Attempt:', attempt);
          
          if (s === 'COMPLETED' || s === 'SUCCEEDED' || s === 'SUCCESS' || s === 'COMPLETED_WITH_ERRORS') {
            if (!completedSeenAt) completedSeenAt = Date.now();
            // Give the backend a small window to finalize artifact links
            if (Date.now() - completedSeenAt < 2000) {
              await sleep(500);
              continue;
            }
            // Try to fetch the result
            const rs = await fetch(`/api/fal/meshy-result?requestId=${encodeURIComponent(requestId)}`);
            if (rs.ok) {
              const jr = await rs.json();
              // Clean up tracking
              activeGenerations.delete(requestId);
              console.log('[meshyService] Generation complete:', requestId);
              return jr?.result?.data;
            } else {
              // If backend reports still in progress (400), keep polling until timeout
              try {
                const txt = await rs.text();
                if (rs.status === 400 || rs.status === 422 || /in progress|still\sin\sprogress/i.test(txt)) {
                  // keep polling
                  console.log('[meshyService] Result not ready yet, continuing to poll...');
                } else {
                  activeGenerations.delete(requestId);
                  throw new Error(txt);
                }
              } catch (e) {
                if ((e as Error).message !== txt) throw e;
              }
            }
          }
          if (s === 'FAILED' || s === 'ERROR') {
            activeGenerations.delete(requestId);
            throw new Error('meshy_failed');
          }
          
          // Check if we're making progress - if no progress for 2 minutes, something is wrong
          if (Date.now() - lastProgressTime > 2 * 60 * 1000 && attempt > 10) {
            console.warn('[meshyService] No progress for 2 minutes, but continuing to poll...');
          }
        } else {
          console.warn('[meshyService] Status check failed:', st.status);
        }
      } catch (fetchError) {
        // Network error - don't give up, keep trying
        console.warn('[meshyService] Network error during poll, retrying...', fetchError);
      }
      
      // Exponential backoff with cap
      const backoff = Math.min(5000, 2000 + attempt * 200);
      await sleep(backoff);
    }
    
    // Timeout - but don't delete from tracking, the generation might still complete
    console.error('[meshyService] Timeout waiting for:', requestId);
    throw new Error('meshy_timeout');
  },

  // Resume polling for a generation (after session reconnect)
  async resumeGeneration(requestId: string, onProgress?: (msg: string) => void): Promise<any> {
    const gen = activeGenerations.get(requestId);
    if (!gen) {
      console.warn('[meshyService] Cannot resume unknown generation:', requestId);
      return null;
    }
    
    // Calculate remaining timeout
    const elapsed = Date.now() - gen.startTime;
    const remainingTimeout = Math.max(60000, 5 * 60 * 1000 - elapsed); // At least 1 minute
    
    console.log('[meshyService] Resuming generation:', requestId, 'Remaining timeout:', remainingTimeout / 1000, 's');
    
    return this.waitForResult(requestId, remainingTimeout, onProgress);
  },

  // Clean up stale generations (older than 10 minutes)
  cleanupStale() {
    const now = Date.now();
    const staleThreshold = 10 * 60 * 1000;
    
    for (const [requestId, gen] of activeGenerations.entries()) {
      if (now - gen.startTime > staleThreshold) {
        console.log('[meshyService] Cleaning up stale generation:', requestId);
        activeGenerations.delete(requestId);
      }
    }
  }
};


