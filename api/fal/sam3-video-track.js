import { withApiAccess } from "../_lib/api-access.js";
/**
 * FAL.ai SAM3 Video Object Tracking API
 * Tracks objects across video frames using SAM3 via FAL.ai
 * 
 * Endpoint: POST /api/fal/sam3-video-track
 * Body: { videoUrl: string, text_prompt: string, detection_threshold?: number }
 * Returns: { success: true, tracked_objects: array, frames: array }
 * 
 * Documentation: https://fal.ai/models/fal-ai/sam-3/video-rle
 * Cost: $0.005 per 16 frames of video
 */

 async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed, use POST' });
  }

  try {
    const { videoUrl, text_prompt, detection_threshold = 0.3 } = req.body || {};
    
    if (!videoUrl) {
      return res.status(400).json({ error: 'Missing videoUrl parameter' });
    }

    if (!text_prompt) {
      return res.status(400).json({ error: 'Missing text_prompt parameter (e.g., "person", "car")' });
    }

    const falApiKey = process.env.FAL_API_KEY;
    if (!falApiKey) {
      console.warn('[SAM3] FAL_API_KEY not configured');
      return res.status(500).json({ error: 'FAL_API_KEY not configured' });
    }

    // FAL.ai SAM3 Video to RLE endpoint
    // Model: fal-ai/sam-3/video-rle
    // Documentation: https://fal.ai/models/fal-ai/sam-3/video-rle
    // Cost: $0.005 per 16 frames
    // 
    // Input: video_url, text_prompt, detection_threshold
    // Output: metadata array with tracked objects across frames
    
    console.log('[SAM3] Tracking object in video:', text_prompt, 'video:', videoUrl.substring(0, 50) + '...');

    const response = await fetch('https://fal.run/fal-ai/sam-3/video-rle', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Key ${falApiKey}`
      },
      body: JSON.stringify({
        video_url: videoUrl,
        text_prompt: text_prompt,
        detection_threshold: detection_threshold
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[SAM3] FAL.ai video tracking error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `SAM3 video tracking failed: ${errorText}`,
        success: false
      });
    }

    const data = await response.json();
    
    // FAL SAM3 video-rle response format:
    // Returns metadata array with tracked objects across frames:
    // - Each frame contains object detections
    // - Objects are tracked across frames (same object ID)
    // - Includes RLE masks, bounding boxes, confidence scores
    
    if (!data.metadata || !Array.isArray(data.metadata) || data.metadata.length === 0) {
      console.warn('[SAM3] No objects tracked in video for prompt:', text_prompt);
      return res.status(200).json({ 
        success: false,
        error: `No objects tracked matching "${text_prompt}"`,
        tracked_objects: [],
        frames: []
      });
    }

    // Process tracked objects across frames
    const trackedObjects = new Map(); // object_id -> { frames: [], total_frames: 0 }
    const frames = [];
    
    // Group detections by object ID (tracking ID)
    data.metadata.forEach((frameData, frameIndex) => {
      if (frameData.objects && Array.isArray(frameData.objects)) {
        frameData.objects.forEach(obj => {
          const objId = obj.id || obj.index || `obj-${frameIndex}`;
          if (!trackedObjects.has(objId)) {
            trackedObjects.set(objId, {
              id: objId,
              frames: [],
              total_frames: 0,
              first_frame: frameIndex,
              last_frame: frameIndex,
              confidence_scores: []
            });
          }
          
          const tracked = trackedObjects.get(objId);
          tracked.frames.push({
            frame: frameIndex,
            box: obj.box,
            score: obj.score,
            rle: obj.rle
          });
          tracked.total_frames++;
          tracked.last_frame = frameIndex;
          if (obj.score) tracked.confidence_scores.push(obj.score);
        });
      }
      
      frames.push({
        frame: frameIndex,
        objects: frameData.objects || []
      });
    });

    // Convert to array and calculate average confidence
    const trackedObjectsArray = Array.from(trackedObjects.values()).map(obj => ({
      ...obj,
      average_confidence: obj.confidence_scores.length > 0
        ? obj.confidence_scores.reduce((a, b) => a + b, 0) / obj.confidence_scores.length
        : 0
    }));

    // Sort by total frames tracked (most consistent objects first)
    trackedObjectsArray.sort((a, b) => b.total_frames - a.total_frames);

    console.log('[SAM3] Tracked', trackedObjectsArray.length, 'objects across', frames.length, 'frames');

    return res.status(200).json({ 
      success: true,
      tracked_objects: trackedObjectsArray,
      frames: frames,
      total_frames: frames.length,
      object_count: trackedObjectsArray.length,
      prompt: text_prompt
    });

  } catch (error) {
    console.error('[SAM3] Video tracking error:', error);
    return res.status(500).json({ 
      success: false,
      error: error?.message || 'Unknown error',
      tracked_objects: [],
      frames: []
    });
  }
}

export default withApiAccess(handler, "/api/fal/sam3-video-track");
