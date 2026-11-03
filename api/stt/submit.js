import { withApiAccess } from "../_lib/api-access.js";
import { jobTokenIssuer, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from '@fal-ai/client';

export const config = {
  api: {
    bodyParser: false,
  }
};

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    try {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try {
          const buff = Buffer.concat(chunks);
          resolve(buff);
        } catch (e) { reject(e); }
      });
      req.on('error', reject);
    } catch (e) { reject(e); }
  });
}

 async function handler(req, res, context) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  // Check job ownership signing before the upload or any provider call.
  let issueJobToken;
  try { issueJobToken = jobTokenIssuer(context?.actor, 'stt'); }
  catch (error) { return sendJobOwnershipError(res, error); }
  try {
    if (!process.env.FAL_API_KEY) {
      return res.status(500).json({ error: 'Missing FAL_API_KEY' });
    }
    fal.config({ credentials: process.env.FAL_API_KEY });

    const buffer = await parseMultipart(req);
    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: 'Audio file required' });
    }

    // Create a File from the buffer for fal.storage.upload
    const file = new File([buffer], 'audio.webm', { type: 'audio/webm' });
    const url = await fal.storage.upload(file);

    const result = await fal.queue.submit('fal-ai/speech-to-text/turbo/stream', {
      input: { audio_url: url, use_pnc: true },
      webhookUrl: null,
    });

    return res.status(202).json({ request_id: issueJobToken(result.request_id) });
  } catch (e) {
    console.error('STT submit error:', e);
    return res.status(500).json({ error: 'stt_submit_failed', details: e?.message || String(e) });
  }
}

export default withApiAccess(handler, "/api/stt/submit");
