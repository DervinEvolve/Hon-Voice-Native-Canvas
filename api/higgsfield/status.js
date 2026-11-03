import { withApiAccess } from "../_lib/api-access.js";
import { ownedProviderId, sendJobOwnershipError } from "../_lib/job-ownership.js";
 async function handler(req, res, context) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.HIGGSFIELD_API_KEY;
  const apiSecret = process.env.HIGGSFIELD_SECRET;
  if (!apiKey || !apiSecret) {
    return res.status(500).json({ error: 'Missing HIGGSFIELD_API_KEY or HIGGSFIELD_SECRET' });
  }

  const token = req.query.requestId || req.query.jobSetId;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'requestId (job_set_id) is required' });
  }
  // Only this user's Higgsfield jobs reach the provider.
  let jobSetId;
  try { jobSetId = ownedProviderId(context?.actor, 'higgsfield', token); }
  catch (error) { return sendJobOwnershipError(res, error); }

  try {
    const resp = await fetch(`https://platform.higgsfield.ai/v1/job-sets/${encodeURIComponent(jobSetId)}`, {
      method: 'GET',
      headers: {
        'hf-api-key': apiKey,
        'hf-secret': apiSecret,
      },
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const message = data?.error || data?.message || 'Higgsfield status fetch failed';
      return res.status(resp.status).json({ error: message, details: data });
    }

    // Try to infer completion by checking job statuses and presence of result URLs
    let isDone = false;
    let resultUrl = null;
    let soulId = null;

    try {
      const jobs = data?.jobs || data?.result?.jobs || [];
      for (const job of jobs) {
        // Prefer raw URL if available, otherwise min
        const rawUrl = job?.results?.raw?.url || job?.result?.raw?.url;
        const minUrl = job?.results?.min?.url || job?.result?.min?.url;
        const flatUrl = job?.result?.url || job?.result?.image_url || job?.result?.video_url || job?.result?.output_url;
        resultUrl = rawUrl || minUrl || flatUrl || resultUrl;

        const st = (job?.status || '').toString().toLowerCase();
        if (st.includes('succeed') || st.includes('complete') || st.includes('done')) {
          isDone = true;
        }

        if (job?.result?.soul_id && typeof job.result.soul_id === 'string') {
          soulId = job.result.soul_id;
        }
      }
    } catch {}

    // If we have a URL, consider it completed even if job-set lacks a top-level status
    if (resultUrl) isDone = true;

    return res.status(200).json({
      status: isDone ? 'COMPLETED' : 'PROCESSING',
      result: { url: resultUrl, soul_id: soulId, raw: data },
    });
  } catch (err) {
    console.error('[Higgsfield] status error', err);
    return res.status(500).json({ error: 'Internal error', details: String(err) });
  }
}

export default withApiAccess(handler, "/api/higgsfield/status");
