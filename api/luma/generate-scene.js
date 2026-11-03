import { withApiAccess } from "../_lib/api-access.js";
import { sendNotAvailable, WORLD_SCENE_NOT_AVAILABLE } from "../_lib/not-available.js";

// The voice tool generate_world_scene is defined, but prompt-to-world
// generation is not implemented. This route used to answer with one of a few
// fixed captures made by other people; it now says plainly that the feature
// is not available.
async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  return sendNotAvailable(res, 'generate_world_scene', WORLD_SCENE_NOT_AVAILABLE);
}

export default withApiAccess(handler, "/api/luma/generate-scene");
