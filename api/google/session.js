import { withApiAccess } from "../_lib/api-access.js";
import { readProviderTokens } from '../_lib/oauth-state.js';
 async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (!readProviderTokens(req, 'gd_tokens')) return res.status(401).json({ ok: false });
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ ok: false });
  }
}

export default withApiAccess(handler, "/api/google/session");
