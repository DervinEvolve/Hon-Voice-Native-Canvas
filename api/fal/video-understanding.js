import { withApiAccess } from "../_lib/api-access.js";
import { fal } from "@fal-ai/client";

 async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle OPTIONS method for preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed, use POST' });
  }

  try {
    const { videoUrl, prompt } = req.body;

    if (!videoUrl) {
      return res.status(400).json({ error: 'Missing videoUrl parameter' });
    }

    if (!prompt) {
      return res.status(400).json({ error: 'Missing prompt parameter' });
    }

    // Configure FAL client with server-side environment variable
    const falApiKey = process.env.FAL_API_KEY;
    if (!falApiKey) {
      console.error('FAL_API_KEY environment variable not set (server-side only)');
      return res.status(500).json({ error: 'Service configuration error' });
    }

    fal.config({
      credentials: falApiKey
    });

    // Simple memory cache for faster responses and to reduce API calls
    const VIDEO_ANALYSIS_CACHE = globalThis.VIDEO_ANALYSIS_CACHE || (globalThis.VIDEO_ANALYSIS_CACHE = new Map());
    const cacheKey = `${videoUrl}_${prompt}`;
    
    // Check cache first
    if (VIDEO_ANALYSIS_CACHE.has(cacheKey)) {
      const cachedResult = VIDEO_ANALYSIS_CACHE.get(cacheKey);
      console.log('🔍 Retrieved video analysis from cache for:', videoUrl.substring(0, 30) + '...');
      return res.json(cachedResult);
    }

    console.log('🔄 Video analysis request for:', videoUrl.substring(0, 30) + '...', 'with prompt:', prompt);

    // Submit and poll up to the function's time budget (maxDuration ~300s)
    console.log('[AI] video_analysis submit');
    const submit = await fal.queue.submit('fal-ai/video-understanding', {
      // Use lighter analysis to speed up completion and avoid 504s
      input: { video_url: videoUrl, prompt, detailed_analysis: false }
    });
    const requestId = submit?.request_id;
    if (!requestId) throw new Error('Submit failed: no request_id');

    let analysis = '';
    let lastStatus = 'QUEUED';
    const startedAt = Date.now();
    const maxMs = 280_000; // buffer below Vercel 300s
    const intervalMs = 1500; // lighter polling
    for (;;) {
      await new Promise(r => setTimeout(r, intervalMs));
      const status = await fal.queue.status('fal-ai/video-understanding', { requestId, logs: false });
      lastStatus = status?.status || lastStatus;
      if (status?.status === 'COMPLETED') {
        const result = await fal.queue.result('fal-ai/video-understanding', { requestId });
        analysis = (result?.data?.output || '').toString();
        break;
      }
      if (status?.status === 'FAILED') {
        console.warn('[AI] video_analysis failed', { id: requestId, error: status?.error || status?.message });
        return res.status(200).json({ success: false, error: status?.error || 'Video analysis failed' });
      }
      if (Date.now() - startedAt > maxMs) break;
    }

    if (!analysis) {
      console.warn('[AI] video_analysis timeout', { id: requestId, lastStatus });
      // Return 200 so callers can gracefully fallback without triggering error handlers
      return res.status(200).json({ success: false, error: 'timeout', lastStatus });
    }

    // Build response with success flag
    const response = { 
      success: true,
      analysis,
      videoUrl,
      prompt,
      timestamp: new Date().toISOString()
    };

    // Cache the result
    VIDEO_ANALYSIS_CACHE.set(cacheKey, response);
    console.log('💾 Cached video analysis for:', videoUrl.substring(0, 30) + '...');

    return res.json(response);
  } catch (error) {
    // Production-safe error log (no model names)
    console.error('[AI] video_analysis error:', error?.message || error);
    return res.status(500).json({ 
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      analysis: null
    });
  }
}

export default withApiAccess(handler, "/api/fal/video-understanding");
