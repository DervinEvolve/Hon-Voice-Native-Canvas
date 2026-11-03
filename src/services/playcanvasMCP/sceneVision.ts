/**
 * Scene Vision - Captures PlayCanvas canvas for Claude analysis
 * Scoped to immersive scene only (no browser navigation)
 * 
 * This gives Hon the ability to "see" what the user sees in the 3D scene,
 * enabling natural spatial commands like "delete that thing on the left"
 */

/**
 * Captures a screenshot of the PlayCanvas canvas
 * @returns Base64 data URL of the canvas, or null if capture fails
 */
export async function captureSceneScreenshot(): Promise<string | null> {
  // Find the PlayCanvas canvas - it's the one with specific classes in WorldImmersiveCanvas
  const canvas = document.querySelector('canvas.block.w-full.h-full') as HTMLCanvasElement;
  if (!canvas) {
    console.warn('[SceneVision] PlayCanvas canvas not found');
    return null;
  }
  
  try {
    // PlayCanvas renders to WebGL/WebGPU, so we need to capture after a frame
    // The canvas should already have content rendered
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    
    // Validate we got actual image data (not a blank canvas)
    if (dataUrl.length < 1000) {
      console.warn('[SceneVision] Canvas appears to be blank or too small');
      return null;
    }
    
    console.log('[SceneVision] Captured canvas screenshot:', dataUrl.length, 'bytes');
    return dataUrl;
  } catch (e) {
    console.warn('[SceneVision] Failed to capture canvas:', e);
    return null;
  }
}

/**
 * Analyzes the scene visually using Claude's vision capabilities
 * @param query The user's question or intent about the scene
 * @param screenshot Base64 data URL of the canvas
 * @returns Claude's analysis of what's visible in the scene
 */
export async function analyzeSceneVisual(
  query: string,
  screenshot: string
): Promise<string> {
  const response = await fetch('/api/playcanvas/analyze-scene', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent: query, screenshot })
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Vision analysis failed');
  }
  
  const data = await response.json();
  return data.analysis || 'Unable to analyze the scene';
}

/**
 * Combined function to capture and analyze in one call
 * @param query What to look for or analyze
 * @returns Analysis result or error message
 */
export async function lookAtScene(query: string = 'What do you see?'): Promise<{
  success: boolean;
  analysis?: string;
  error?: string;
}> {
  try {
    const screenshot = await captureSceneScreenshot();
    if (!screenshot) {
      return {
        success: false,
        error: 'Cannot capture scene - immersive mode may not be active'
      };
    }
    
    const analysis = await analyzeSceneVisual(query, screenshot);
    return {
      success: true,
      analysis
    };
  } catch (error: any) {
    console.error('[SceneVision] lookAtScene failed:', error);
    return {
      success: false,
      error: error.message || 'Failed to analyze scene'
    };
  }
}

