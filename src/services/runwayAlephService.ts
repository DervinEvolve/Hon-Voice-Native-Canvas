/**
 * Dedicated Runway Aleph video-to-video service.
 * Keeps existing Runway services untouched.
 */

class RunwayAlephService {
  /**
   * Edit a video using Runway Aleph (video_to_video)
   * Returns the output video URL after polling /api/runway/status
   */
  async editVideo(options: {
    inputVideoUrl: string;
    promptText: string;
    duration?: number;
    resolution?: '720p' | '1080p';
    fps?: 24 | 25 | 30;
    seed?: number;
    camera_control?: any;
    motion_brush?: any;
    style?: any;
    lighting?: any;
  }): Promise<string> {
    const response = await fetch('/api/runway/video-to-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Runway Aleph video edit failed: ${response.status} - ${errorText}`);
    }

    const task = await response.json();
    if (!task.id) {
      throw new Error('No task ID returned from Runway video_to_video');
    }
    return await this.pollTaskCompletion(task.id);
  }

  private async pollTaskCompletion(taskId: string): Promise<string> {
    let attempts = 0;
    const maxAttempts = 120;
    while (attempts < maxAttempts) {
      const res = await fetch(`/api/runway/status?taskId=${encodeURIComponent(taskId)}`);
      if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
      const data = await res.json();
      if (data.status === 'completed' && Array.isArray(data.output) && data.output.length > 0) {
        return data.output[0];
      }
      if (data.status === 'failed') {
        throw new Error('Aleph video edit failed');
      }
      attempts++;
      await new Promise(r => setTimeout(r, 5000));
    }
    throw new Error('Aleph video edit timed out');
  }
}

export const runwayAlephService = new RunwayAlephService();

