import { withApiAccess } from "../_lib/api-access.js";
import { createClient } from '@supabase/supabase-js';
import { authorizeSplatRequest, allowedImageUrl, newJobId, requirePrivateBucket, PRIVATE_SPLAT_BUCKET, MAX_SPLAT_BYTES, readBoundedResponse } from '../_lib/splat-security.js';

export const config = { maxDuration: 300, api: { bodyParser: { sizeLimit: '16kb' } } };

 async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  let context;
  let requestId;
  try {
    context = await authorizeSplatRequest(req, res, createClient);
    if (!context) return;
    const { client, userId, storageOrigin } = context;
    let imageUrl;
    try { imageUrl = allowedImageUrl(req.body?.imageUrl, storageOrigin); }
    catch { return res.status(400).json({ error: 'Image URL is not allowed' }); }
    let endpoint;
    try {
      endpoint = new URL(process.env.MODAL_SHARP_ENDPOINT || '');
      if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.modal.run') || endpoint.username || endpoint.password || endpoint.port || endpoint.search || endpoint.hash) throw new Error('Invalid URL');
    } catch { return res.status(503).json({ error: 'SHARP worker access is not configured' }); }
    // Dedicated Modal web-proxy credentials, never workspace/account tokens.
    const proxyKey = process.env.MODAL_SHARP_PROXY_KEY;
    const proxySecret = process.env.MODAL_SHARP_PROXY_SECRET;
    if (!proxyKey || !proxySecret) return res.status(503).json({ error: 'SHARP worker access is not configured' });
    await requirePrivateBucket(client);
    requestId = newJobId();
    const { error: insertError } = await client.from('sharp_jobs').insert({
      id: requestId, owner_id: userId, image_url: imageUrl, status: 'processing',
    });
    if (insertError) throw new Error('Job could not be created');
    const modalRes = await fetch(endpoint.href, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(250000),
      headers: { 'Content-Type': 'application/json', 'Modal-Key': proxyKey, 'Modal-Secret': proxySecret },
      body: JSON.stringify({ image_url: imageUrl }),
    });
    if (!modalRes.ok) throw new Error('SHARP worker failed');
    // Bound the base64 JSON response before parsing or decoding it.
    const raw = await readBoundedResponse(modalRes, Math.ceil(MAX_SPLAT_BYTES / 3) * 4 + 65536);
    const result = JSON.parse(raw.toString('utf8'));
    if (typeof result.ply_data !== 'string' || !result.ply_data.length || result.ply_data.length > Math.ceil(MAX_SPLAT_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.ply_data)) {
      throw new Error('Invalid worker result');
    }
    const ply = Buffer.from(result.ply_data, 'base64');
    if (!ply.length || ply.length > MAX_SPLAT_BYTES || ply.subarray(0, 3).toString() !== 'ply') throw new Error('Invalid PLY file');
    const storagePath = `${userId}/${requestId}/output.ply`;
    const { error: uploadError } = await client.storage.from(PRIVATE_SPLAT_BUCKET).upload(storagePath, ply, {
      upsert: false, contentType: 'application/octet-stream', cacheControl: 'private, no-store',
    });
    if (uploadError) throw new Error('Result upload failed');
    const { error: updateError } = await client.from('sharp_jobs').update({
      status: 'completed', storage_path: storagePath, filename: 'output.ply', size_bytes: ply.length, completed_at: new Date().toISOString(),
    }).eq('id', requestId).eq('owner_id', userId);
    if (updateError) throw new Error('Result could not be recorded');
    return res.status(200).json({ success: true, request_id: requestId });
  } catch {
    if (context && requestId) {
      try {
        await context.client.from('sharp_jobs').update({ status: 'failed', error: 'Conversion failed' })
          .eq('id', requestId).eq('owner_id', context.userId);
      } catch { /* The error response must not expose database/provider diagnostics. */ }
    }
    return res.status(502).json({ error: 'Splat conversion failed' });
  }
}

export default withApiAccess(handler, "/api/sharp/submit");
