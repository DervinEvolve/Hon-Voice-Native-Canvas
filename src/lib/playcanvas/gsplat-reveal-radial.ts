/**
 * Radial Reveal Effect for Gaussian Splats
 * 
 * Adapted from PlayCanvas Engine:
 * https://github.com/playcanvas/engine/blob/main/scripts/esm/gsplat/reveal-radial.mjs
 * https://developer.playcanvas.com/user-manual/gaussian-splatting/building/streaming-lod-editor/#reveal-effect-example
 * 
 * Creates two waves emanating from a center point:
 * 1. Dot wave: Small colored dots appear progressively
 * 2. Lift wave: Particles lift up, get highlighted, then settle to original state
 */

// GLSL shader for the radial reveal effect
export const revealRadialShaderGLSL = /* glsl */`
uniform float uTime;
uniform vec3 uCenter;
uniform float uSpeed;
uniform float uAcceleration;
uniform float uDelay;
uniform vec3 uDotTint;
uniform vec3 uWaveTint;
uniform float uOscillationIntensity;
uniform float uEndRadius;

// Shared globals (initialized once per vertex)
float g_dist;
float g_dotWavePos;
float g_liftTime;
float g_liftWavePos;

void initShared(vec3 center) {
    g_dist = length(center - uCenter);
    g_dotWavePos = uSpeed * uTime + 0.5 * uAcceleration * uTime * uTime;
    g_liftTime = max(0.0, uTime - uDelay);
    g_liftWavePos = uSpeed * g_liftTime + 0.5 * uAcceleration * g_liftTime * g_liftTime;
}

// Hash function for per-splat randomization
float hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

void modifyCenter(inout vec3 center) {
    initShared(center);
    
    // Early exit optimization
    if (g_dist > uEndRadius) return;
    
    // Only apply oscillation if lift wave hasn't fully passed
    bool wavesActive = g_liftTime <= 0.0 || g_dist > g_liftWavePos - 1.5;
    if (wavesActive) {
        // Apply oscillation with per-splat phase offset
        float phase = hash(center) * 6.28318;
        center.y += sin(uTime * 3.0 + phase) * uOscillationIntensity * 0.25;
    }
    
    // Apply lift effect near the wave edge
    float distToLiftWave = abs(g_dist - g_liftWavePos);
    if (distToLiftWave < 1.0 && g_liftTime > 0.0) {
        // Create a smooth lift curve (peaks at wave edge)
        float liftAmount = (1.0 - distToLiftWave) * sin(distToLiftWave * 3.14159);
        center.y += liftAmount * uOscillationIntensity * 0.9;
    }
}

void modifyCovariance(vec3 originalCenter, vec3 modifiedCenter, inout vec3 covA, inout vec3 covB) {
    // Early exit for distant splats - hide them
    if (g_dist > uEndRadius) {
        gsplatMakeRound(covA, covB, 0.0);
        return;
    }
    
    // Determine scale and phase
    float scale;
    bool isLiftWave = g_liftTime > 0.0 && g_liftWavePos > g_dist;
    
    if (isLiftWave) {
        // Lift wave: transition from dots to full size
        scale = (g_liftWavePos >= g_dist + 2.0) ? 1.0 : mix(0.1, 1.0, (g_liftWavePos - g_dist) * 0.5);
    } else if (g_dist > g_dotWavePos + 1.0) {
        // Before dot wave: invisible
        gsplatMakeRound(covA, covB, 0.0);
        return;
    } else if (g_dist > g_dotWavePos - 1.0) {
        // Dot wave front: scale from 0 to 0.1 with 2x peak at center
        float distToWave = abs(g_dist - g_dotWavePos);
        scale = (distToWave < 0.5) 
            ? mix(0.1, 0.2, 1.0 - distToWave * 2.0)
            : mix(0.0, 0.1, smoothstep(g_dotWavePos + 1.0, g_dotWavePos - 1.0, g_dist));
    } else {
        // After dot wave, before lift: small dots
        scale = 0.1;
    }
    
    // Apply scale to covariance
    if (scale >= 1.0) {
        // Fully revealed: original shape and size (no-op)
        return;
    } else if (isLiftWave) {
        // Lift wave: lerp from round dots to original shape
        float t = (scale - 0.1) * 1.111111; // normalize [0.1, 1.0] to [0, 1]
        float dotSize = scale * 0.05;
        float originalSize = gsplatExtractSize(covA, covB);
        float finalSize = mix(dotSize, originalSize, t);
        
        // Lerp between round and scaled original
        vec3 origCovA = covA * (scale * scale);
        vec3 origCovB = covB * (scale * scale);
        gsplatMakeRound(covA, covB, finalSize);
        covA = mix(covA, origCovA, t);
        covB = mix(covB, origCovB, t);
    } else {
        // Dot phase: round with absolute size, but don't make small splats larger
        float originalSize = gsplatExtractSize(covA, covB);
        gsplatMakeRound(covA, covB, min(scale * 0.05, originalSize));
    }
}

void modifyColor(vec3 center, inout vec4 color) {
    // Use shared globals
    if (g_dist > uEndRadius) return;
    
    // Lift wave tint takes priority (active during lift)
    if (g_liftTime > 0.0 && g_dist >= g_liftWavePos - 1.5 && g_dist <= g_liftWavePos + 0.5) {
        float distToLift = abs(g_dist - g_liftWavePos);
        float liftIntensity = smoothstep(1.5, 0.0, distToLift);
        color.rgb += uWaveTint * liftIntensity;
    }
    // Dot wave tint (active in dot phase, but not where lift wave is active)
    else if (g_dist <= g_dotWavePos && (g_liftTime <= 0.0 || g_dist > g_liftWavePos + 0.5)) {
        float distToDot = abs(g_dist - g_dotWavePos);
        float dotIntensity = smoothstep(1.0, 0.0, distToDot);
        color.rgb += uDotTint * dotIntensity;
    }
}
`;

// WGSL shader for WebGPU (if needed)
export const revealRadialShaderWGSL = /* wgsl */`
uniform uTime: f32;
uniform uCenter: vec3f;
uniform uSpeed: f32;
uniform uAcceleration: f32;
uniform uDelay: f32;
uniform uDotTint: vec3f;
uniform uWaveTint: vec3f;
uniform uOscillationIntensity: f32;
uniform uEndRadius: f32;

var<private> g_dist: f32;
var<private> g_dotWavePos: f32;
var<private> g_liftTime: f32;
var<private> g_liftWavePos: f32;

fn initShared(center: vec3f) {
    g_dist = length(center - uniform.uCenter);
    g_dotWavePos = uniform.uSpeed * uniform.uTime + 0.5 * uniform.uAcceleration * uniform.uTime * uniform.uTime;
    g_liftTime = max(0.0, uniform.uTime - uniform.uDelay);
    g_liftWavePos = uniform.uSpeed * g_liftTime + 0.5 * uniform.uAcceleration * g_liftTime * g_liftTime;
}

fn hash(p: vec3f) -> f32 {
    return fract(sin(dot(p, vec3f(127.1, 311.7, 74.7))) * 43758.5453);
}

fn modifyCenter(center: ptr<function, vec3f>) {
    initShared(*center);
    
    if (g_dist > uniform.uEndRadius) {
        return;
    }
    
    let wavesActive = g_liftTime <= 0.0 || g_dist > g_liftWavePos - 1.5;
    if (wavesActive) {
        let phase = hash(*center) * 6.28318;
        (*center).y += sin(uniform.uTime * 3.0 + phase) * uniform.uOscillationIntensity * 0.25;
    }
    
    let distToLiftWave = abs(g_dist - g_liftWavePos);
    if (distToLiftWave < 1.0 && g_liftTime > 0.0) {
        let liftAmount = (1.0 - distToLiftWave) * sin(distToLiftWave * 3.14159);
        (*center).y += liftAmount * uniform.uOscillationIntensity * 0.9;
    }
}

fn modifyCovariance(originalCenter: vec3f, modifiedCenter: vec3f, covA: ptr<function, vec3f>, covB: ptr<function, vec3f>) {
    if (g_dist > uniform.uEndRadius) {
        gsplatMakeRound(covA, covB, 0.0);
        return;
    }
    
    var scale: f32;
    let isLiftWave = g_liftTime > 0.0 && g_liftWavePos > g_dist;
    
    if (isLiftWave) {
        scale = select(mix(0.1, 1.0, (g_liftWavePos - g_dist) * 0.5), 1.0, g_liftWavePos >= g_dist + 2.0);
    } else if (g_dist > g_dotWavePos + 1.0) {
        gsplatMakeRound(covA, covB, 0.0);
        return;
    } else if (g_dist > g_dotWavePos - 1.0) {
        let distToWave = abs(g_dist - g_dotWavePos);
        scale = select(
            mix(0.0, 0.1, smoothstep(g_dotWavePos + 1.0, g_dotWavePos - 1.0, g_dist)),
            mix(0.1, 0.2, 1.0 - distToWave * 2.0),
            distToWave < 0.5
        );
    } else {
        scale = 0.1;
    }
    
    if (scale >= 1.0) {
        return;
    } else if (isLiftWave) {
        let t = (scale - 0.1) * 1.111111;
        let dotSize = scale * 0.05;
        let originalSize = gsplatExtractSize(*covA, *covB);
        let finalSize = mix(dotSize, originalSize, t);
        
        let origCovA = *covA * (scale * scale);
        let origCovB = *covB * (scale * scale);
        gsplatMakeRound(covA, covB, finalSize);
        *covA = mix(*covA, origCovA, t);
        *covB = mix(*covB, origCovB, t);
    } else {
        let originalSize = gsplatExtractSize(*covA, *covB);
        gsplatMakeRound(covA, covB, min(scale * 0.05, originalSize));
    }
}

fn modifyColor(center: vec3f, color: ptr<function, vec4f>) {
    if (g_dist > uniform.uEndRadius) {
        return;
    }
    
    if (g_liftTime > 0.0 && g_dist >= g_liftWavePos - 1.5 && g_dist <= g_liftWavePos + 0.5) {
        let distToLift = abs(g_dist - g_liftWavePos);
        let liftIntensity = smoothstep(1.5, 0.0, distToLift);
        (*color) = vec4f((*color).rgb + uniform.uWaveTint * liftIntensity, (*color).a);
    }
    else if (g_dist <= g_dotWavePos && (g_liftTime <= 0.0 || g_dist > g_liftWavePos + 0.5)) {
        let distToDot = abs(g_dist - g_dotWavePos);
        let dotIntensity = smoothstep(1.0, 0.0, distToDot);
        (*color) = vec4f((*color).rgb + uniform.uDotTint * dotIntensity, (*color).a);
    }
}
`;

/**
 * Configuration options for the radial reveal effect
 */
export interface RevealRadialConfig {
  /** Origin point for radial waves (default: camera position) */
  center?: { x: number; y: number; z: number };
  /** Base wave speed in units/second (default: 2) */
  speed?: number;
  /** Speed increase over time (default: 5) */
  acceleration?: number;
  /** Time offset before lift wave starts in seconds (default: 1) */
  delay?: number;
  /** Additive color for initial dots [r, g, b] (default: [0, 1, 1] cyan) */
  dotTint?: [number, number, number];
  /** Additive color for lift wave highlight [r, g, b] (default: [5, 0, 0] red) */
  waveTint?: [number, number, number];
  /** Position oscillation strength (default: 0.1) */
  oscillationIntensity?: number;
  /** Distance at which to disable effect for performance (default: 50) */
  endRadius?: number;
}

/**
 * Creates and manages a radial reveal effect for a gsplat entity
 */
export class GsplatRevealRadialEffect {
  private app: any;
  private entity: any;
  private material: any = null;
  private effectTime: number = 0;
  private enabled: boolean = true;
  private config: Required<RevealRadialConfig>;
  private updateHandler: ((dt: number) => void) | null = null;

  constructor(app: any, entity: any, config: RevealRadialConfig = {}) {
    this.app = app;
    this.entity = entity;
    this.config = {
      center: config.center || { x: 0, y: 0, z: 0 },
      speed: config.speed ?? 2,
      acceleration: config.acceleration ?? 5,
      delay: config.delay ?? 1,
      dotTint: config.dotTint || [0, 1, 1],
      waveTint: config.waveTint || [5, 0, 0],
      oscillationIntensity: config.oscillationIntensity ?? 0.1,
      endRadius: config.endRadius ?? 50,
    };
  }

  /**
   * Initialize and start the reveal effect
   */
  start(): void {
    this.effectTime = 0;
    this.enabled = true;

    // Get the material from the gsplat component
    const gsplat = this.entity.gsplat;
    if (!gsplat) {
      console.warn('[GsplatRevealRadial] No gsplat component found on entity');
      return;
    }

    // Wait for material to be available
    if (gsplat.material) {
      this.applyShader(gsplat.material);
    } else {
      gsplat.once('load', () => {
        if (gsplat.material) {
          this.applyShader(gsplat.material);
        }
      });
    }

    // Set up update loop
    this.updateHandler = (dt: number) => this.update(dt);
    this.app.on('update', this.updateHandler);
  }

  /**
   * Apply the reveal shader to the material
   */
  private applyShader(material: any): void {
    this.material = material;
    
    const device = this.app.graphicsDevice;
    const shaderLanguage = device?.isWebGPU ? 'wgsl' : 'glsl';
    const shaderCode = shaderLanguage === 'wgsl' ? revealRadialShaderWGSL : revealRadialShaderGLSL;

    try {
      material.getShaderChunks(shaderLanguage).set('gsplatCustomizeVS', shaderCode);
      material.update();
      console.log('[GsplatRevealRadial] Shader applied successfully');
    } catch (err) {
      console.error('[GsplatRevealRadial] Failed to apply shader:', err);
    }
  }

  /**
   * Update the effect each frame
   */
  private update(dt: number): void {
    if (!this.enabled || !this.material) return;

    this.effectTime += dt;

    // Check if effect is complete
    if (this.isComplete()) {
      this.stop();
      return;
    }

    // Update uniforms
    this.material.setParameter('uTime', this.effectTime);
    this.material.setParameter('uCenter', [
      this.config.center.x,
      this.config.center.y,
      this.config.center.z,
    ]);
    this.material.setParameter('uSpeed', this.config.speed);
    this.material.setParameter('uAcceleration', this.config.acceleration);
    this.material.setParameter('uDelay', this.config.delay);
    this.material.setParameter('uDotTint', this.config.dotTint);
    this.material.setParameter('uWaveTint', this.config.waveTint);
    this.material.setParameter('uOscillationIntensity', this.config.oscillationIntensity);
    this.material.setParameter('uEndRadius', this.config.endRadius);
  }

  /**
   * Calculate when the effect completes
   */
  private getCompletionTime(): number {
    const { speed, acceleration, delay, endRadius } = this.config;
    const liftStartTime = delay;

    if (acceleration === 0) {
      return liftStartTime + (endRadius / speed);
    }

    // Quadratic formula: t = (-v + sqrt(v² + 2ad)) / a
    const discriminant = speed * speed + 2 * acceleration * endRadius;
    if (discriminant < 0) return Infinity;
    
    const t = (-speed + Math.sqrt(discriminant)) / acceleration;
    return liftStartTime + t;
  }

  /**
   * Check if the effect has completed
   */
  isComplete(): boolean {
    return this.effectTime >= this.getCompletionTime();
  }

  /**
   * Stop the effect and remove the shader
   */
  stop(): void {
    this.enabled = false;

    if (this.updateHandler) {
      this.app.off('update', this.updateHandler);
      this.updateHandler = null;
    }

    if (this.material) {
      const device = this.app.graphicsDevice;
      const shaderLanguage = device?.isWebGPU ? 'wgsl' : 'glsl';
      
      try {
        this.material.getShaderChunks(shaderLanguage).delete('gsplatCustomizeVS');
        this.material.update();
        console.log('[GsplatRevealRadial] Effect complete, shader removed');
      } catch (err) {
        console.warn('[GsplatRevealRadial] Could not remove shader:', err);
      }
    }
  }

  /**
   * Update the center point (e.g., to camera position)
   */
  setCenter(x: number, y: number, z: number): void {
    this.config.center = { x, y, z };
  }

  /**
   * Destroy the effect and clean up
   */
  destroy(): void {
    this.stop();
    this.material = null;
  }
}

