import { withApiAccess } from "../_lib/api-access.js";
import { ownedProviderId, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from '@fal-ai/client';

 async function handler(req, res, context) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const apiKey = process.env.FAL_API_KEY || process.env.FAL_AI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Service configuration error' });
    fal.config({ credentials: apiKey });

    if (!req.query?.requestId) return res.status(400).json({ error: 'requestId is required' });
    // Only this user's Kling Pro jobs reach the provider.
    let requestId;
    try { requestId = ownedProviderId(context?.actor, 'kling/pro-image', req.query.requestId); }
    catch (error) { return sendJobOwnershipError(res, error); }

    const status = await fal.queue.status('fal-ai/kling-video/v2.5-turbo/pro/image-to-video', {
      requestId,
      logs: true,
    });

    if (status.status === 'COMPLETED' && status.response_url) {
      const resp = await fetch(status.response_url, {
        headers: {
          'Authorization': `Key ${process.env.FAL_API_KEY || process.env.FAL_AI_API_KEY}`,
          'Content-Type': 'application/json',
        }
      });
      const data = await resp.json();

      // Try to surface a direct video URL for the client
      const findVideoUrl = (obj) => {
        if (!obj || typeof obj !== 'object') return null;
        // Common shapes
        if (obj.url && typeof obj.url === 'string') {
          const u = obj.url;
          if (/https?:\/\//.test(u) && (/(\.mp4|\.webm)(\?|$)/i.test(u) || /video\//i.test(obj.content_type || ''))) return u;
        }
        for (const key of Object.keys(obj)) {
          const val = obj[key];
          if (typeof val === 'string') {
            if (/https?:\/\//.test(val) && /(\.mp4|\.webm)(\?|$)/i.test(val)) return val;
          } else if (val && typeof val === 'object') {
            const r = findVideoUrl(val);
            if (r) return r;
          }
        }
        return null;
      };
      const videoUrl = findVideoUrl(data);
      return res.status(200).json({ status: 'COMPLETED', result: data, videoUrl });
    }

    return res.status(200).json(status);
  } catch (err) {
    console.error('Kling Pro i2v status error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to fetch status' });
  }
}

export default withApiAccess(handler, "/api/kling/pro-image-status");
