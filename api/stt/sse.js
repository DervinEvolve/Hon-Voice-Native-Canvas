import { withApiAccess } from "../_lib/api-access.js";
import { ownedProviderId, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from '@fal-ai/client';

export const config = {
  api: {
    bodyParser: false
  }
};

 async function handler(req, res, context) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');

  const { request_id: token } = req.query || {};
  // Checked before the event stream starts so a refusal is a plain 404.
  let request_id;
  if (token) {
    try { request_id = ownedProviderId(context?.actor, 'stt', token); }
    catch (error) { return sendJobOwnershipError(res, error); }
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Connection', 'keep-alive');
  if (!request_id) {
    res.write(`data: ${JSON.stringify({ error: 'request_id required' })}\n\n`);
    return res.end();
  }
  fal.config({ credentials: process.env.FAL_API_KEY });

  let alive = true;
  req.on('close', () => { alive = false; });

  const model = 'fal-ai/speech-to-text/turbo/stream';

  try {
    const tick = async () => {
      if (!alive) return;
      try {
        const status = await fal.queue.status(model, { requestId: String(request_id), logs: true });
        if (!alive) return;
        if (status.status === 'COMPLETED') {
          try {
            const result = await fal.queue.result(model, { requestId: String(request_id) });
            const transcript = result?.data?.text || result?.data?.transcript || '';
            res.write(`data: ${JSON.stringify({ status: 'COMPLETED', transcript })}\n\n`);
          } catch {
            res.write(`data: ${JSON.stringify({ status: 'COMPLETED', transcript: '' })}\n\n`);
          }
          return res.end();
        } else if (status.status === 'FAILED') {
          res.write(`data: ${JSON.stringify({ status: 'FAILED' })}\n\n`);
          return res.end();
        } else {
          const last = status?.logs?.slice(-1)[0]?.message || '';
          res.write(`data: ${JSON.stringify({ status: status.status, progress: last })}\n\n`);
          setTimeout(tick, 1000);
        }
      } catch (e) {
        res.write(`data: ${JSON.stringify({ error: 'status_failed' })}\n\n`);
        return res.end();
      }
    };
    tick();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: 'sse_failed' })}\n\n`);
    res.end();
  }
}

export default withApiAccess(handler, "/api/stt/sse");
