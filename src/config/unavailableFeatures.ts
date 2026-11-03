// Plain messages for integrations this build does not provide. The voice
// tools send these to the model as the tool result and say them to the user,
// instead of returning sample output. Server routes use the same wording
// (api/_lib/not-available.js); tests/unavailable-integrations.test.mjs keeps
// the two in step.

export const WORLD_SCENE_NOT_AVAILABLE =
  "Generating an explorable world from a prompt is not available in this build. " +
  "To get a scene you can walk through, generate an image on the canvas and turn it into a Gaussian splat, " +
  "or ask for a real place to open it in the map view.";

// place_3d_model_on_map: the Google Maps 3D view loads models through a
// same-origin model proxy (/api/proxy-model) that this build does not include,
// so a generated model could never appear on the map. The tool answers before
// starting a paid 3D job. text_to_3d (model onto the canvas) is unaffected.
export const MAP_MODEL_PLACEMENT_AVAILABLE = false;
export const PLACE_MODEL_ON_MAP_NOT_AVAILABLE =
  "Placing a generated 3D model on the map is not available in this build: the map view needs a model proxy route that is not included. " +
  "A 3D model can still be generated onto the canvas with text_to_3d.";

// Virtual try-on (panel editor) has no provider integration here.
export const VIRTUAL_TRY_ON_NOT_AVAILABLE =
  "Virtual try-on is not available in this build: no try-on provider is connected.";
