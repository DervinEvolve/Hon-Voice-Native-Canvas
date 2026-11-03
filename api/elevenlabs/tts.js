import { withApiAccess } from '../_lib/api-access.js';
import { readBoundedResponse } from '../_lib/splat-security.js';
async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  const { text, voiceId } = req.body || {};
  if (typeof text !== 'string' || !text.trim() || text.length > 5000 || typeof voiceId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(voiceId)) return res.status(400).json({ error: 'A valid voice and 1 to 5000 characters are required' });
  if (!process.env.ELEVENLABS_API_KEY) return res.status(503).json({ error: 'Speech is not configured' });
  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: 'eleven_monolingual_v1', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
    });
    const bytes = await readBoundedResponse(response, 32 * 1024 * 1024);
    res.setHeader('Content-Type', 'audio/mpeg');res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).end(bytes);
  } catch { return res.status(502).json({ error: 'Speech generation failed' }); }
}
export default withApiAccess(handler, '/api/elevenlabs/tts');
