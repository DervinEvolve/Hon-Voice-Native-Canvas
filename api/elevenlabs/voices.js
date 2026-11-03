import { withApiAccess } from "../_lib/api-access.js";
import { sendNotAvailable } from "../_lib/not-available.js";

// Listing ElevenLabs voices is not implemented. This route used to return three
// made-up voices; it now says so. Speech synthesis itself is api/elevenlabs/tts.js.
function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed, use GET' });
  }
  return sendNotAvailable(res, 'elevenlabs_voices', 'Listing ElevenLabs voices is not available in this build.');
}

export default withApiAccess(handler, "/api/elevenlabs/voices");
