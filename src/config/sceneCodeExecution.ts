/**
 * The voice scene builder (pc_execute and the legacy pc_* script tools) runs
 * model-generated PlayCanvas code directly in this page, with the signed-in
 * session. It is not sandboxed. It stays off unless the build sets
 * VITE_ENABLE_SCENE_CODE_EXECUTION=true, and the server must also set
 * HON_ENABLE_SCENE_CODE_EXECUTION=true before it generates the code.
 * Only enable both for a private, trusted workspace.
 */
export const SCENE_CODE_EXECUTION_ENABLED = import.meta.env.VITE_ENABLE_SCENE_CODE_EXECUTION === 'true';

export const SCENE_CODE_EXECUTION_DISABLED_MESSAGE =
  'Scene code execution is turned off in this build. It runs model-written code in the signed-in page, so it is only enabled for a private, trusted workspace.';

/** Compiles model-written scene code, or throws when the feature is off. */
export type CompiledSceneCode = (...args: unknown[]) => unknown;

export function compileSceneCode(...args: string[]): CompiledSceneCode {
  if (!SCENE_CODE_EXECUTION_ENABLED) throw new Error(SCENE_CODE_EXECUTION_DISABLED_MESSAGE);
  return new Function(...args) as CompiledSceneCode;
}
