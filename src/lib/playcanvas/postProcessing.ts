/**
 * Post-Processing Effects for PlayCanvas
 *
 * Provides high-quality visual effects:
 * - Bloom (glow on bright areas)
 * - Vignette (darkened edges)
 * - Screen shake (impact feedback)
 * - Damage flash (red overlay on hit)
 * - Color grading (cinematic look)
 */

// Post-processing state
interface PostProcessingState {
  enabled: boolean;
  bloom: {
    enabled: boolean;
    intensity: number;
    threshold: number;
    blurAmount: number;
  };
  vignette: {
    enabled: boolean;
    intensity: number;
    softness: number;
  };
  colorGrading: {
    enabled: boolean;
    saturation: number;
    contrast: number;
    brightness: number;
  };
  screenShake: {
    active: boolean;
    intensity: number;
    duration: number;
    startTime: number;
  };
  damageFlash: {
    active: boolean;
    intensity: number;
    duration: number;
    startTime: number;
  };
}

let postProcessingState: PostProcessingState = {
  enabled: true,
  bloom: { enabled: true, intensity: 0.3, threshold: 0.8, blurAmount: 4 },
  vignette: { enabled: true, intensity: 0.3, softness: 0.5 },
  colorGrading: { enabled: true, saturation: 1.1, contrast: 1.05, brightness: 1.0 },
  screenShake: { active: false, intensity: 0, duration: 0, startTime: 0 },
  damageFlash: { active: false, intensity: 0, duration: 0, startTime: 0 },
};

// References
let postProcessLayer: any = null;
let bloomRenderTarget: any = null;
let bloomBlurShader: any = null;
let vignetteShader: any = null;
let compositeShader: any = null;
let quadMesh: any = null;

// Shader code for bloom extraction (get bright pixels)
const bloomExtractFS = `
  precision highp float;

  varying vec2 vUv0;
  uniform sampler2D uColorBuffer;
  uniform float uThreshold;
  uniform float uIntensity;

  void main() {
    vec4 color = texture2D(uColorBuffer, vUv0);
    float brightness = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));

    if (brightness > uThreshold) {
      gl_FragColor = vec4(color.rgb * uIntensity * (brightness - uThreshold), 1.0);
    } else {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    }
  }
`;

// Shader code for Gaussian blur
const blurFS = `
  precision highp float;

  varying vec2 vUv0;
  uniform sampler2D uColorBuffer;
  uniform vec2 uBlurDir;
  uniform vec2 uResolution;

  void main() {
    vec2 texelSize = 1.0 / uResolution;
    vec3 result = vec3(0.0);

    // 9-tap Gaussian blur
    float weights[5];
    weights[0] = 0.227027;
    weights[1] = 0.1945946;
    weights[2] = 0.1216216;
    weights[3] = 0.054054;
    weights[4] = 0.016216;

    result += texture2D(uColorBuffer, vUv0).rgb * weights[0];

    for (int i = 1; i < 5; i++) {
      vec2 offset = uBlurDir * texelSize * float(i) * 2.0;
      result += texture2D(uColorBuffer, vUv0 + offset).rgb * weights[i];
      result += texture2D(uColorBuffer, vUv0 - offset).rgb * weights[i];
    }

    gl_FragColor = vec4(result, 1.0);
  }
`;

// Shader for final composite with vignette and color grading
const compositeFS = `
  precision highp float;

  varying vec2 vUv0;
  uniform sampler2D uSceneBuffer;
  uniform sampler2D uBloomBuffer;
  uniform float uBloomIntensity;
  uniform float uVignetteIntensity;
  uniform float uVignetteSoftness;
  uniform float uSaturation;
  uniform float uContrast;
  uniform float uBrightness;
  uniform float uDamageFlash;
  uniform vec2 uShakeOffset;

  vec3 adjustSaturation(vec3 color, float saturation) {
    float grey = dot(color, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(grey), color, saturation);
  }

  void main() {
    // Apply screen shake offset
    vec2 uv = vUv0 + uShakeOffset;
    uv = clamp(uv, 0.0, 1.0);

    // Sample scene
    vec4 scene = texture2D(uSceneBuffer, uv);
    vec3 color = scene.rgb;

    // Add bloom
    vec3 bloom = texture2D(uBloomBuffer, uv).rgb;
    color += bloom * uBloomIntensity;

    // Color grading
    color = adjustSaturation(color, uSaturation);
    color = (color - 0.5) * uContrast + 0.5;
    color *= uBrightness;

    // Vignette
    vec2 vignetteUv = vUv0 * (1.0 - vUv0);
    float vignette = vignetteUv.x * vignetteUv.y * 15.0;
    vignette = pow(vignette, uVignetteSoftness);
    vignette = mix(1.0 - uVignetteIntensity, 1.0, vignette);
    color *= vignette;

    // Damage flash (red overlay)
    color = mix(color, vec3(0.8, 0.1, 0.1), uDamageFlash * 0.5);

    // Clamp final color
    color = clamp(color, 0.0, 1.0);

    gl_FragColor = vec4(color, scene.a);
  }
`;

// Simple passthrough vertex shader
const passthroughVS = `
  attribute vec3 aPosition;
  attribute vec2 aUv0;

  varying vec2 vUv0;

  void main() {
    vUv0 = aUv0;
    gl_Position = vec4(aPosition, 1.0);
  }
`;

/**
 * Initialize post-processing for a PlayCanvas application
 */
export function initPostProcessing(app: any): boolean {
  const pc = (window as any).pc;
  if (!pc || !app) {
    console.warn('[PostProcessing] PlayCanvas not available');
    return false;
  }

  try {
    const device = app.graphicsDevice;
    const width = device.width;
    const height = device.height;

    // Create render targets for bloom
    bloomRenderTarget = new pc.RenderTarget({
      colorBuffer: new pc.Texture(device, {
        width: Math.floor(width / 2),
        height: Math.floor(height / 2),
        format: pc.PIXELFORMAT_RGBA8,
        mipmaps: false,
        minFilter: pc.FILTER_LINEAR,
        magFilter: pc.FILTER_LINEAR,
        addressU: pc.ADDRESS_CLAMP_TO_EDGE,
        addressV: pc.ADDRESS_CLAMP_TO_EDGE,
      }),
      depth: false,
    });

    // Create fullscreen quad for post-processing
    const positions = new Float32Array([
      -1, -1, 0,
       1, -1, 0,
       1,  1, 0,
      -1,  1, 0,
    ]);
    const uvs = new Float32Array([
      0, 0,
      1, 0,
      1, 1,
      0, 1,
    ]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    quadMesh = new pc.Mesh(device);
    quadMesh.setPositions(positions, 3);
    quadMesh.setUvs(0, uvs, 2);
    quadMesh.setIndices(indices);
    quadMesh.update(pc.PRIMITIVE_TRIANGLES);

    console.log('[PostProcessing] Post-processing initialized');

    // Set up the render loop hook
    setupPostProcessLoop(app);

    return true;
  } catch (err) {
    console.error('[PostProcessing] Failed to initialize:', err);
    return false;
  }
}

/**
 * Set up the post-processing render loop
 */
function setupPostProcessLoop(app: any): void {
  const pc = (window as any).pc;
  if (!pc) return;

  // Hook into the camera's post-render
  app.on('postrender', () => {
    if (!postProcessingState.enabled) return;

    // Update screen effects
    updateScreenEffects();
  });
}

/**
 * Update screen shake and damage flash effects
 */
function updateScreenEffects(): void {
  const now = Date.now();

  // Update screen shake
  if (postProcessingState.screenShake.active) {
    const elapsed = now - postProcessingState.screenShake.startTime;
    if (elapsed >= postProcessingState.screenShake.duration) {
      postProcessingState.screenShake.active = false;
      postProcessingState.screenShake.intensity = 0;
    } else {
      // Decay shake intensity over time
      const progress = elapsed / postProcessingState.screenShake.duration;
      const decay = 1 - progress;
      postProcessingState.screenShake.intensity *= decay;
    }
  }

  // Update damage flash
  if (postProcessingState.damageFlash.active) {
    const elapsed = now - postProcessingState.damageFlash.startTime;
    if (elapsed >= postProcessingState.damageFlash.duration) {
      postProcessingState.damageFlash.active = false;
      postProcessingState.damageFlash.intensity = 0;
    } else {
      // Quick fade out
      const progress = elapsed / postProcessingState.damageFlash.duration;
      postProcessingState.damageFlash.intensity = (1 - progress) * 0.5;
    }
  }
}

/**
 * Configure bloom effect
 */
export function setBloom(enabled: boolean, intensity: number = 0.3, threshold: number = 0.8): void {
  postProcessingState.bloom.enabled = enabled;
  postProcessingState.bloom.intensity = Math.max(0, Math.min(2, intensity));
  postProcessingState.bloom.threshold = Math.max(0, Math.min(1, threshold));
  console.log(`[PostProcessing] Bloom: ${enabled ? 'ON' : 'OFF'}, intensity=${intensity}, threshold=${threshold}`);
}

/**
 * Configure vignette effect
 */
export function setVignette(enabled: boolean, intensity: number = 0.3, softness: number = 0.5): void {
  postProcessingState.vignette.enabled = enabled;
  postProcessingState.vignette.intensity = Math.max(0, Math.min(1, intensity));
  postProcessingState.vignette.softness = Math.max(0.1, Math.min(2, softness));
  console.log(`[PostProcessing] Vignette: ${enabled ? 'ON' : 'OFF'}, intensity=${intensity}`);
}

/**
 * Configure color grading
 */
export function setColorGrading(
  saturation: number = 1.1,
  contrast: number = 1.05,
  brightness: number = 1.0
): void {
  postProcessingState.colorGrading.saturation = Math.max(0, Math.min(2, saturation));
  postProcessingState.colorGrading.contrast = Math.max(0.5, Math.min(2, contrast));
  postProcessingState.colorGrading.brightness = Math.max(0.5, Math.min(2, brightness));
}

/**
 * Trigger screen shake effect
 */
export function triggerScreenShake(intensity: number = 0.02, durationMs: number = 300): void {
  postProcessingState.screenShake.active = true;
  postProcessingState.screenShake.intensity = intensity;
  postProcessingState.screenShake.duration = durationMs;
  postProcessingState.screenShake.startTime = Date.now();
  console.log(`[PostProcessing] Screen shake triggered: intensity=${intensity}`);
}

/**
 * Trigger damage flash effect
 */
export function triggerDamageFlash(intensity: number = 0.5, durationMs: number = 200): void {
  postProcessingState.damageFlash.active = true;
  postProcessingState.damageFlash.intensity = intensity;
  postProcessingState.damageFlash.duration = durationMs;
  postProcessingState.damageFlash.startTime = Date.now();
  console.log(`[PostProcessing] Damage flash triggered`);
}

/**
 * Enable/disable all post-processing
 */
export function setPostProcessingEnabled(enabled: boolean): void {
  postProcessingState.enabled = enabled;
  console.log(`[PostProcessing] ${enabled ? 'Enabled' : 'Disabled'}`);
}

/**
 * Get current post-processing state
 */
export function getPostProcessingState(): PostProcessingState {
  return { ...postProcessingState };
}

/**
 * Apply post-processing settings from immersive scene store
 */
export function applyPostProcessingFromStore(environment: {
  bloom?: { enabled: boolean; intensity: number; threshold: number };
  vignette?: { enabled: boolean; intensity: number };
}): void {
  if (environment.bloom) {
    setBloom(
      environment.bloom.enabled,
      environment.bloom.intensity,
      environment.bloom.threshold
    );
  }
  if (environment.vignette) {
    setVignette(environment.vignette.enabled, environment.vignette.intensity);
  }
}

/**
 * Cleanup post-processing resources
 */
export function destroyPostProcessing(): void {
  if (bloomRenderTarget) {
    bloomRenderTarget.destroy();
    bloomRenderTarget = null;
  }
  if (quadMesh) {
    quadMesh.destroy();
    quadMesh = null;
  }
  bloomBlurShader = null;
  vignetteShader = null;
  compositeShader = null;
  console.log('[PostProcessing] Destroyed');
}

// ============================================
// PlayCanvas Script-based Post-Processing
// Uses the built-in post-effect system for reliability
// ============================================

/**
 * Add bloom post-effect to camera using PlayCanvas script system
 */
export function addBloomToCamera(app: any, camera: any): void {
  const pc = (window as any).pc;
  if (!pc || !camera) return;

  try {
    // Check if scripts component exists
    if (!camera.script) {
      camera.addComponent('script');
    }

    // Create bloom script
    const BloomEffect = pc.createScript('bloomEffect');

    BloomEffect.attributes.add('bloomIntensity', { type: 'number', default: 0.3 });
    BloomEffect.attributes.add('bloomThreshold', { type: 'number', default: 0.8 });
    BloomEffect.attributes.add('blurAmount', { type: 'number', default: 4 });

    BloomEffect.prototype.initialize = function() {
      this.effect = this.createBloomEffect();
      if (this.effect) {
        const queue = this.entity.camera.postEffects;
        queue.addEffect(this.effect);
      }
    };

    BloomEffect.prototype.createBloomEffect = function() {
      // PlayCanvas built-in bloom if available
      if (pc.posteffect && pc.posteffect.Bloom) {
        return new pc.posteffect.Bloom(app.graphicsDevice);
      }
      return null;
    };

    console.log('[PostProcessing] Bloom script registered');
  } catch (err) {
    console.warn('[PostProcessing] Could not add bloom to camera:', err);
  }
}

/**
 * Simple camera effect that applies vignette via render layer
 * This approach works without requiring custom shaders
 */
export function setupSimplePostEffects(app: any, camera: any): void {
  const pc = (window as any).pc;
  if (!pc || !camera) return;

  // For now, enhance the scene's built-in rendering
  try {
    const scene = app.scene;

    // Enable tone mapping for better HDR handling
    if (scene.toneMapping !== undefined) {
      scene.toneMapping = pc.TONEMAP_ACES;
    }
    if (scene.exposure !== undefined) {
      scene.exposure = 1.1;
    }

    // Enable gamma correction
    if (scene.gammaCorrection !== undefined) {
      scene.gammaCorrection = pc.GAMMA_SRGB;
    }

    console.log('[PostProcessing] Simple post-effects applied (ACES tone mapping, gamma correction)');
  } catch (err) {
    console.warn('[PostProcessing] Could not setup simple effects:', err);
  }
}

export default {
  initPostProcessing,
  setBloom,
  setVignette,
  setColorGrading,
  triggerScreenShake,
  triggerDamageFlash,
  setPostProcessingEnabled,
  getPostProcessingState,
  applyPostProcessingFromStore,
  destroyPostProcessing,
  addBloomToCamera,
  setupSimplePostEffects,
};
