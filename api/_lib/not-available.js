// One response shape for integrations that this build does not provide.
// Clients and the voice tools read `code: "not_available"` and pass `error`
// on to the user unchanged, instead of showing sample or placeholder output.

export const NOT_AVAILABLE_CODE = "not_available";

export const WORLD_SCENE_NOT_AVAILABLE =
  "Generating an explorable world from a prompt is not available in this build. " +
  "To get a scene you can walk through, generate an image on the canvas and turn it into a Gaussian splat, " +
  "or ask for a real place to open it in the map view.";

export function notAvailableBody(feature, message) {
  return { success: false, available: false, code: NOT_AVAILABLE_CODE, feature, error: message };
}

export function sendNotAvailable(res, feature, message) {
  return res.status(501).json(notAvailableBody(feature, message));
}
