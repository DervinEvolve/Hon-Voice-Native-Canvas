import { withApiAccess } from "../_lib/api-access.js";
import { createClient } from '@supabase/supabase-js';
import { authorizeSplatRequest, validJobId } from '../_lib/splat-security.js';
export const config = { maxDuration: 30 };
 async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });
  try {
    const context = await authorizeSplatRequest(req, res, createClient);
    if (!context) return;
    const id = req.query?.request_id;
    if (!validJobId(id)) return res.status(400).json({ error: 'Invalid request_id' });
    const { data: job, error } = await context.client.from('sharp_jobs')
      .select('status,created_at,filename,size_bytes').eq('id', id).eq('owner_id', context.userId).single();
    if (error || !job) return res.status(404).json({ error: 'Job not found' });
    return res.status(200).json({ success: true, request_id: id, status: job.status,
      elapsed_seconds: Math.max(0, Math.round((Date.now() - new Date(job.created_at).getTime()) / 1000)),
      ...(job.status === 'completed' ? { filename: job.filename, size_bytes: job.size_bytes } : {}),
      ...(job.status === 'failed' ? { error: 'Conversion failed' } : {}),
    });
  } catch { return res.status(500).json({ error: 'Unable to read job status' }); }
}

export default withApiAccess(handler, "/api/sharp/status");
