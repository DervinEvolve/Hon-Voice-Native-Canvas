// Server half of the scene-code switch (see src/config/sceneCodeExecution.ts).
// The routes that generate PlayCanvas code for the browser to run refuse to
// work unless the operator sets HON_ENABLE_SCENE_CODE_EXECUTION=true.
export function sceneCodeGenerationEnabled(res) {
  if (process.env.HON_ENABLE_SCENE_CODE_EXECUTION === 'true') return true;
  res.status(403).json({ error: 'Scene code generation is turned off on this server', code: 'scene_code_disabled' });
  return false;
}
