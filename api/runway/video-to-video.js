import { withApiAccess } from "../_lib/api-access.js";
import { jobTokenIssuer, sendJobOwnershipError } from "../_lib/job-ownership.js";
 async function handler(req, res, context) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check job signing before the provider is charged.
  let issueJobToken;
  try { issueJobToken = jobTokenIssuer(context?.actor, 'runway'); }
  catch (error) { return sendJobOwnershipError(res, error); }

  try {
    if (!process.env.RUNWAY_API_KEY) {
      console.error('Missing RUNWAY_API_KEY environment variable');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const {
      inputVideoUrl,
      promptText,
      model,
      duration,
      resolution,
      ratio,
      fps,
      seed,
      watermark,
      // pass-through optional advanced knobs without tight schema yet
      camera_control,
      motion_brush,
      style,
      lighting
    } = req.body || {};

    if (!inputVideoUrl) {
      return res.status(400).json({ error: 'inputVideoUrl is required' });
    }

    // Basic validation
    if (fps && ![24, 25, 30].includes(fps)) {
      return res.status(400).json({ error: 'fps must be one of 24, 25, 30' });
    }

    // Normalize ratio to pixel-pair values accepted by Aleph (e.g., 1280:720)
    const toPixelPairRatio = (val) => {
      if (!val || typeof val !== 'string') return null;
      const v = val.trim().toLowerCase();
      if (/^\d{3,4}:\d{3,4}$/.test(v)) {
        // Avoid 1920:1080 which has been rejected; map to 1280:720
        if (v === '1920:1080') return '1280:720';
        return v;
      }
      if (v === '16:9') return '1280:720';
      if (v === '9:16') return '768:1280';
      if (v === '1:1') return '1024:1024';
      if (v === '4:3') return '1024:768';
      if (v === '3:4') return '768:1024';
      return null;
    };

    let resolvedRatio = toPixelPairRatio(ratio);
    if (!resolvedRatio && typeof resolution === 'string') {
      const resLower = resolution.toLowerCase();
      if (resLower === '1080p' || resLower === '720p') resolvedRatio = '1280:720';
      else if (/^\d{2,4}:\d{2,4}$/.test(resolution)) resolvedRatio = toPixelPairRatio(resolution);
    }
    if (!resolvedRatio) resolvedRatio = '1280:720';

    // Clamp duration to supported values (5 or 10 seconds)
    const normalizeDuration = (val) => {
      if (val === undefined || val === null) return undefined;
      const n = Number(val);
      if (Number.isNaN(n)) return undefined;
      return n <= 7 ? 5 : 10;
    };
    const clampedDuration = normalizeDuration(duration);

    const requestBody = {
      model: model || 'gen4_aleph',
      // Per Runway video_to_video spec, the input video URL must be provided as `videoUri`
      videoUri: inputVideoUrl,
      ...(promptText && { promptText }),
      ...(clampedDuration && { duration: clampedDuration }),
      ...(resolvedRatio && { ratio: resolvedRatio }),
      ...(fps && { fps }),
      ...(seed !== undefined && { seed }),
      ...(watermark !== undefined && { watermark }),
      // Forward optional structured knobs if present (server will ignore unknowns)
      ...(camera_control && { camera_control }),
      ...(motion_brush && { motion_brush }),
      ...(style && { style }),
      ...(lighting && { lighting })
    };

    console.log('Runway video_to_video request body:', JSON.stringify(requestBody, null, 2));

    const response = await fetch('https://api.dev.runwayml.com/v1/video_to_video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RUNWAY_API_KEY}`,
        'X-Runway-Version': '2024-11-06'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`Runway video_to_video error ${response.status}: ${errorData}`);
      return res.status(response.status).json({ error: errorData });
    }

    const task = await response.json();
    console.log('Runway video_to_video task created:', task);

    return res.status(200).json({ id: issueJobToken(task.id), status: 'processing' });
  } catch (error) {
    console.error('Runway video_to_video handler error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}

export default withApiAccess(handler, "/api/runway/video-to-video");
