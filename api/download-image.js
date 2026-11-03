import { withApiAccess } from "./_lib/api-access.js";
import { createClient } from '@supabase/supabase-js';
import { authorizeSplatRequest } from './_lib/splat-security.js';
import { allowedMediaUrl, downloadMedia } from './_lib/media-download.js';

// The existing route name serves image and video downloads from the canvas.
 async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!await authorizeSplatRequest(req, res, createClient, 'HON_MEDIA_ALLOWED_USER_IDS')) return;
  let url;
  try { url = allowedMediaUrl(req.query?.url); }
  catch { return res.status(400).json({ error: 'Media URL is not allowed' }); }
  try {
    const { type, bytes } = await downloadMedia(url);
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', 'attachment');
    return res.status(200).send(bytes);
  } catch {
    return res.status(502).json({ error: 'Media download failed or exceeded its limits' });
  }
}

export default withApiAccess(handler, "/api/download-image");
