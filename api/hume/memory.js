import { withApiAccess } from "../_lib/api-access.js";
import { putMemory, getMemory, searchMemories, deleteMemory, upsertSession, getSession } from './memoryHandlers.js';

 async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'POST') {
      const { action, payload } = req.body || {};
      switch (action) {
        case 'put': {
          const result = await putMemory(payload);
          return res.status(200).json({ success: !!result });
        }
        case 'get': {
          const result = await getMemory(payload?.key);
          return res.status(200).json({ memory: result || null });
        }
        case 'search': {
          const result = await searchMemories(payload || {});
          return res.status(200).json({ memories: result });
        }
        case 'delete': {
          const ok = await deleteMemory(payload?.key);
          return res.status(200).json({ success: ok });
        }
        case 'upsert_session': {
          await upsertSession(payload?.snapshot || {});
          return res.status(200).json({ success: true });
        }
        case 'get_session': {
          const snap = await getSession();
          return res.status(200).json({ snapshot: snap });
        }
        default:
          return res.status(400).json({ error: 'Unknown action' });
      }
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('Memory API error:', e);
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
}

export default withApiAccess(handler, "/api/hume/memory");
