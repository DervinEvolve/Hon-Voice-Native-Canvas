import { humeEviService } from './humeEviService';
import { useComicStore } from '../store/useComicStore';

export interface SfxOptions {
  text_prompt?: string;
  num_samples?: number;
  seed?: number;
  panelId?: string; // optional panel to show overlay on
}

export const sfxService = {
  async addSoundtrack(videoUrl: string, durationSeconds?: number, opts: SfxOptions = {}): Promise<string> {
    const { panelId, ...submitOpts } = opts || {};
    // Signal UI activity immediately
    if (panelId) {
      try { useComicStore.getState().setPanelGenerationProgress(panelId, true, 'Adding sound effects...'); } catch {}
    }
    // Only affect Hon indicator if a collab session is active
    if (humeEviService.isSessionActive()) {
      humeEviService.beginExternalTask('processing');
    }
    // Submit job
    const submitRes = await fetch('/api/sfx/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_url: videoUrl, duration: durationSeconds, ...submitOpts })
    });
    if (submitRes.status !== 202) {
      const err = await submitRes.json().catch(() => ({}));
      throw new Error(err.error || 'SFX submit failed');
    }
    const { request_id } = await submitRes.json();

    // Poll for completion
    let attempts = 0;
    while (attempts < 120) { // up to 10 minutes
      attempts++;
      await new Promise(r => setTimeout(r, 5000));
      const statusRes = await fetch(`/api/sfx/status?requestId=${encodeURIComponent(request_id)}`);
      if (!statusRes.ok) continue;
      const status = await statusRes.json();
      if (status.status === 'FAILED' || status.error) {
        // Clear overlay and indicator on failure
        if (panelId) {
          try { useComicStore.getState().clearPanelGenerationProgress(panelId); } catch {}
        }
        if (humeEviService.isSessionActive()) {
          humeEviService.completeExternalTask();
        }
        throw new Error(status.error || 'SFX job failed upstream');
      }
      if (status.status === 'COMPLETED') {
        // Prefer direct video output if present (video-to-video)
        const videoOut = status.result?.video?.[0]?.url;
        if (videoOut) {
          if (panelId) {
            try { useComicStore.getState().clearPanelGenerationProgress(panelId); } catch {}
          }
          if (humeEviService.isSessionActive()) {
            humeEviService.completeExternalTask();
          }
          return videoOut;
        }
        // Otherwise mux audio to existing video
        if (status.result?.audio?.length) {
          const audioUrl: string = status.result.audio[0].url;
          const muxRes = await fetch('/api/sfx/mux', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_url: videoUrl, audio_url: audioUrl, duration: durationSeconds, persist: true })
          });
          if (!muxRes.ok) {
            const err = await muxRes.json().catch(() => ({}));
            throw new Error(err.error || 'SFX mux failed');
          }
          const { videoUrl: muxed } = await muxRes.json();
          if (panelId) {
            try { useComicStore.getState().clearPanelGenerationProgress(panelId); } catch {}
          }
          if (humeEviService.isSessionActive()) {
            humeEviService.completeExternalTask();
          }
          return muxed;
        }
      }
    }
    // Timeout fallback
    if (panelId) {
      try { useComicStore.getState().clearPanelGenerationProgress(panelId); } catch {}
    }
    if (humeEviService.isSessionActive()) {
      humeEviService.completeExternalTask();
    }
    throw new Error('SFX generation timed out');
  }
};


