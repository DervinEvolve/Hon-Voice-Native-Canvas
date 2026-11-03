/**
 * fal.ai Lucy Edit video editing service.
 * Replaces Runway Aleph for video-to-video editing.
 */

class LucyEditService {
  /**
   * Edit a video using fal.ai Lucy Edit (video_to_video)
   * Returns the output video URL after polling /api/fal/lucy-edit-status
   */
  async editVideo(options: {
    inputVideoUrl: string;
    promptText: string;
  }): Promise<string> {
    const response = await fetch('/api/fal/lucy-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_url: options.inputVideoUrl,
        prompt: options.promptText
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Lucy Edit video edit failed: ${response.status} - ${errorText}`);
    }

    const task = await response.json();
    if (!task.id) {
      throw new Error('No request ID returned from Lucy Edit');
    }
    return await this.pollTaskCompletion(task.id);
  }

  private async pollTaskCompletion(requestId: string): Promise<string> {
    let attempts = 0;
    const maxAttempts = 60; // Lucy Edit is faster (~10 seconds), but allow up to 5 minutes
    while (attempts < maxAttempts) {
      const res = await fetch(`/api/fal/lucy-edit-status?requestId=${encodeURIComponent(requestId)}`);
      if (!res.ok) {
        attempts++;
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      const data = await res.json();
      if (data.status === 'completed' && Array.isArray(data.output) && data.output.length > 0) {
        return data.output[0];
      }
      if (data.status === 'failed') {
        throw new Error(data.error || 'Lucy Edit video edit failed');
      }
      attempts++;
      await new Promise(r => setTimeout(r, 5000));
    }
    throw new Error('Lucy Edit video edit timed out');
  }
}

export const lucyEditService = new LucyEditService();
