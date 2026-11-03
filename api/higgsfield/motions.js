import { withApiAccess } from "../_lib/api-access.js";
 async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.HIGGSFIELD_API_KEY;
  const apiSecret = process.env.HIGGSFIELD_SECRET;
  if (!apiKey || !apiSecret) {
    return res.status(500).json({ error: 'Missing HIGGSFIELD_API_KEY or HIGGSFIELD_SECRET' });
  }

  try {
    const resp = await fetch('https://platform.higgsfield.ai/v1/motions', {
      method: 'GET',
      headers: {
        'hf-api-key': apiKey,
        'hf-secret': apiSecret,
      },
    });

    const data = await resp.json().catch(() => ([]));
    if (!resp.ok) {
      const message = (data && data.error) || (data && data.message) || 'Failed to fetch motions';
      return res.status(resp.status).json({ error: message, details: data });
    }

    // Cache at the edge/CDN with revalidation
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json(Array.isArray(data) ? data : []);
  } catch (err) {
    console.error('[Higgsfield] motions error', err);
    return res.status(500).json({ error: 'Internal error', details: String(err) });
  }
}

export default withApiAccess(handler, "/api/higgsfield/motions");
