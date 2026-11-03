import { withApiAccess } from "../_lib/api-access.js";
import { beginOAuthState, AccessError } from '../_lib/oauth-state.js';

 async function handler(req, res, context) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) throw new AccessError(503, 'Google integration is not configured');
    const proof = beginOAuthState(res, 'google', context.actor);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for (const [key, value] of Object.entries({ client_id: clientId, redirect_uri: proof.redirect, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'https://www.googleapis.com/auth/drive.file', state: proof.nonce })) url.searchParams.set(key, value);
    return res.status(200).json({ url: url.href });
  } catch (error) { return res.status(error instanceof AccessError ? error.status : 503).json({ error: 'Google connection could not be started' }); }
}

export default withApiAccess(handler, "/api/google/auth");
