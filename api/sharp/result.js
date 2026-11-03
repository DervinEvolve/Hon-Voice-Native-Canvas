import { withApiAccess } from "../_lib/api-access.js";
import { createClient } from '@supabase/supabase-js';
import { authorizeSplatRequest, validJobId, requirePrivateBucket, PRIVATE_SPLAT_BUCKET } from '../_lib/splat-security.js';
export const config = { maxDuration: 30 };
 async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });
  try {
    const context = await authorizeSplatRequest(req, res, createClient);
    if (!context) return;
    const id = req.query?.request_id;
    if (!validJobId(id)) return res.status(400).json({ error: 'Invalid request_id' });
    const { client, userId } = context;
    const { data: job, error } = await client.from('sharp_jobs')
      .select('status,storage_path,filename,size_bytes').eq('id', id).eq('owner_id', userId).single();
    if (error || !job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'completed') return res.status(409).json({ error: 'Job is not complete' });
    // Legacy public URLs/base64 rows are deliberately not served or migrated on GET.
    if (job.storage_path !== `${userId}/${id}/output.ply`) return res.status(409).json({ error: 'This result needs a private-storage migration' });
    await requirePrivateBucket(client);
    const { data, error: signError } = await client.storage.from(PRIVATE_SPLAT_BUCKET).createSignedUrl(job.storage_path, 300);
    if (signError || !data?.signedUrl) throw new Error('Signing failed');
    return res.status(200).json({ success: true, request_id: id, ply_url: data.signedUrl, expires_in: 300,
      filename: job.filename, size_bytes: job.size_bytes });
  } catch { return res.status(500).json({ error: 'Unable to read job result' }); }
}

export default withApiAccess(handler, "/api/sharp/result");
