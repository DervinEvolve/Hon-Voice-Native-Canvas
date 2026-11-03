/**
 * SAM3 Video Object Tracking Service
 * Tracks objects across video frames for consistent editing
 */

export interface TrackedObject {
  id: string;
  frames: Array<{
    frame: number;
    box?: number[];
    score?: number;
    rle?: any;
  }>;
  total_frames: number;
  first_frame: number;
  last_frame: number;
  average_confidence: number;
}

export interface SAM3VideoTrackingResult {
  success: boolean;
  tracked_objects?: TrackedObject[];
  frames?: Array<{
    frame: number;
    objects: any[];
  }>;
  total_frames?: number;
  object_count?: number;
  error?: string;
}

/**
 * Track an object across video frames
 * @param videoUrl - URL of the video
 * @param textPrompt - Object to track (e.g., "person", "car")
 * @param detectionThreshold - Confidence threshold (0.0-1.0)
 * @returns Tracking result with objects tracked across frames
 */
export async function trackObjectInVideo(
  videoUrl: string,
  textPrompt: string,
  detectionThreshold: number = 0.3
): Promise<SAM3VideoTrackingResult> {
  try {
    const response = await fetch('/api/fal/sam3-video-track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoUrl,
        text_prompt: textPrompt,
        detection_threshold: detectionThreshold
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn('[SAM3] Video tracking failed:', response.status, errorText);
      return {
        success: false,
        error: errorText || 'Video tracking failed'
      };
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('[SAM3] Video tracking error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get the best tracked object (most consistent across frames)
 */
export function getBestTrackedObject(trackedObjects: TrackedObject[]): TrackedObject | null {
  if (!trackedObjects || trackedObjects.length === 0) return null;
  
  // Sort by total frames tracked and average confidence
  const sorted = [...trackedObjects].sort((a, b) => {
    const scoreA = a.total_frames * a.average_confidence;
    const scoreB = b.total_frames * b.average_confidence;
    return scoreB - scoreA;
  });
  
  return sorted[0];
}

/**
 * Get object position at a specific frame
 */
export function getObjectAtFrame(
  trackedObject: TrackedObject,
  frameNumber: number
): TrackedObject['frames'][0] | null {
  return trackedObject.frames.find(f => f.frame === frameNumber) || null;
}

