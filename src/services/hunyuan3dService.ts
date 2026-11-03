export interface Hunyuan3DOptions {
  seed?: number;
  numInferenceSteps?: number;
  guidanceScale?: number;
  octreeResolution?: number;
  texturedMesh?: boolean;
  removeBackground?: boolean;
  num_chunks?: number;
  max_facenum?: number;
}

export interface Hunyuan3DResult {
  modelGlbUrl: string;
  modelMeshUrl?: string;
  seed?: number;
}

export const hunyuan3dService = {
  async generate3DModel(inputImageUrl: string, options: Hunyuan3DOptions = {}): Promise<Hunyuan3DResult> {
    try {
      // Validate inputs
      if (!inputImageUrl) {
        throw new Error('Input image URL is required');
      }

      // Submit queued job for reliability
      const submit = await fetch('/api/hunyuan3d/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputImageUrl, options })
      });
      if (!submit.ok) {
        const t = await submit.text();
        throw new Error(`Submit failed: ${submit.status} ${t}`);
      }
      const { request_id } = await submit.json();
      if (!request_id) throw new Error('No request_id from submit');

      // Poll status with adaptive backoff
      const start = Date.now();
      const timeoutMs = 9 * 60 * 1000; // keep under server limits
      let attempt = 0;
      while (true) {
        const statusRes = await fetch(`/api/hunyuan3d/status?request_id=${encodeURIComponent(request_id)}`);
        if (!statusRes.ok) {
          const t = await statusRes.text();
          throw new Error(`Status failed: ${statusRes.status} ${t}`);
        }
        const status = await statusRes.json();
        if (status.status === 'COMPLETED' && status.modelGlbUrl) {
          return {
            modelGlbUrl: status.modelGlbUrl,
            modelMeshUrl: status.modelMeshUrl,
            seed: status.seed
          };
        }
        if (status.status === 'FAILED' || status.error) {
          throw new Error(status.error || 'Generation failed');
        }
        if (Date.now() - start > timeoutMs) {
          throw new Error('Timed out waiting for 3D generation');
        }
        attempt += 1;
        const delay = Math.min(8000, 1000 * Math.pow(1.5, attempt));
        await new Promise(r => setTimeout(r, delay));
      }
    } catch (error) {
      console.error('Hunyuan 3D API error:', error);
      throw error instanceof Error ? error : new Error('Failed to generate 3D model. Please try again later.');
    }
  }
}; 