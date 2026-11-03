/**
 * Radial Reveal Effect for GLB Models
 * 
 * Similar to the Gaussian Splat radial reveal, but adapted for standard mesh rendering.
 * Creates a wave effect that reveals meshes from a center point outward.
 * 
 * Effects:
 * 1. Scale wave: Meshes scale from 0 to full size as the wave passes
 * 2. Opacity wave: Meshes fade in with a colored tint
 * 3. Glow effect: Temporary highlight as the wave passes
 */

/**
 * Configuration options for the GLB radial reveal effect
 */
export interface GLBRevealConfig {
  /** Origin point for radial waves (default: { x: 0, y: 0, z: 0 }) */
  center?: { x: number; y: number; z: number };
  /** Wave speed in units/second (default: 8) */
  speed?: number;
  /** Speed increase over time (default: 4) */
  acceleration?: number;
  /** Tint color for the wave highlight [r, g, b] (default: [0.5, 0.3, 1.0] purple) */
  waveTint?: [number, number, number];
  /** Maximum radius to reveal (default: 200) */
  maxRadius?: number;
  /** Wave width (distance over which meshes transition) (default: 5) */
  waveWidth?: number;
  /** Duration of the glow effect on each mesh (default: 0.5s) */
  glowDuration?: number;
  /** Callback when reveal is complete */
  onComplete?: () => void;
}

interface MeshInstanceMaterialState {
  originalBlendType: number;
  originalOpacity: number;
  originalEmissiveR: number;
  originalEmissiveG: number;
  originalEmissiveB: number;
  originalEmissiveIntensity: number;
}

interface MeshRevealState {
  entity: any; // pc.Entity
  originalScale: { x: number; y: number; z: number };
  originalOpacity: number;
  distance: number;
  revealed: boolean;
  glowTime: number;
  materialStates: Map<any, MeshInstanceMaterialState>; // Store per-meshInstance material state
}

/**
 * Creates and manages a radial reveal effect for GLB model entities
 */
export class GLBRevealRadialEffect {
  private app: any;
  private rootEntity: any;
  private effectTime: number = 0;
  private enabled: boolean = true;
  private config: Required<GLBRevealConfig>;
  private updateHandler: ((dt: number) => void) | null = null;
  private meshStates: MeshRevealState[] = [];
  private completed: boolean = false;

  constructor(app: any, rootEntity: any, config: GLBRevealConfig = {}) {
    this.app = app;
    this.rootEntity = rootEntity;
    this.config = {
      center: config.center || { x: 0, y: 0, z: 0 },
      speed: config.speed ?? 8,
      acceleration: config.acceleration ?? 4,
      waveTint: config.waveTint || [0.5, 0.3, 1.0],
      maxRadius: config.maxRadius ?? 200,
      waveWidth: config.waveWidth ?? 5,
      glowDuration: config.glowDuration ?? 0.5,
      onComplete: config.onComplete || (() => {}),
    };
  }

  /**
   * Initialize and start the reveal effect
   */
  start(): void {
    this.effectTime = 0;
    this.enabled = true;
    this.completed = false;
    this.meshStates = [];

    console.log('[GLBReveal] Starting radial reveal effect from center:', this.config.center);

    // Collect all mesh entities and their distances from center
    this.collectMeshes(this.rootEntity);

    // Sort by distance for efficient processing
    this.meshStates.sort((a, b) => a.distance - b.distance);

    // Initially hide all meshes (pass materialStates for consistent handling)
    for (const state of this.meshStates) {
      state.entity.setLocalScale(0.001, 0.001, 0.001);
      this.setMeshOpacity(state.entity, 0, state.materialStates);
    }

    console.log(`[GLBReveal] Found ${this.meshStates.length} meshes to reveal`);

    // Set up update loop
    this.updateHandler = (dt: number) => this.update(dt);
    this.app.on('update', this.updateHandler);
  }

  /**
   * Recursively collect all entities with render components
   */
  private collectMeshes(entity: any, depth: number = 0): void {
    if (!entity || depth > 15) return;

    // Check if this entity has a render component (mesh)
    if (entity.render && entity.render.meshInstances?.length > 0) {
      const worldPos = entity.getPosition();
      const center = this.config.center;
      const distance = Math.sqrt(
        Math.pow(worldPos.x - center.x, 2) +
        Math.pow(worldPos.y - center.y, 2) +
        Math.pow(worldPos.z - center.z, 2)
      );

      const scale = entity.getLocalScale();
      
      // Collect material states for all mesh instances
      const materialStates = new Map<any, MeshInstanceMaterialState>();
      for (const mi of entity.render.meshInstances || []) {
        if (mi.material) {
          materialStates.set(mi, {
            originalBlendType: mi.material.blendType ?? 0,
            originalOpacity: mi.material.opacity ?? 1,
            originalEmissiveR: mi.material.emissive?.x ?? 0,
            originalEmissiveG: mi.material.emissive?.y ?? 0,
            originalEmissiveB: mi.material.emissive?.z ?? 0,
            originalEmissiveIntensity: mi.material.emissiveIntensity ?? 0,
          });
        }
      }

      this.meshStates.push({
        entity,
        originalScale: { x: scale.x, y: scale.y, z: scale.z },
        originalOpacity: 1,
        distance,
        revealed: false,
        glowTime: 0,
        materialStates,
      });
    }

    // Process children
    for (const child of entity.children || []) {
      this.collectMeshes(child, depth + 1);
    }
  }

  /**
   * Set opacity on a mesh entity, with proper material state restoration
   * @param entity The entity to modify
   * @param opacity Target opacity (0-1)
   * @param materialStates Optional map of original material states for restoration
   */
  private setMeshOpacity(entity: any, opacity: number, materialStates?: Map<any, MeshInstanceMaterialState>): void {
    if (!entity.render) return;

    for (const mi of entity.render.meshInstances || []) {
      if (mi.material) {
        // Clone material if needed to avoid affecting other instances
        if (!mi._revealMaterialCloned) {
          mi.material = mi.material.clone();
          mi._revealMaterialCloned = true;
        }

        mi.material.opacity = opacity;

        // Enable blending for transparency during reveal
        if (opacity < 1) {
          mi.material.blendType = 2; // pc.BLEND_NORMAL
        } else {
          // Restore original blend type when fully opaque
          const originalState = materialStates?.get(mi);
          if (originalState) {
            mi.material.blendType = originalState.originalBlendType;
          } else {
            // Fallback: most GLB materials are opaque
            mi.material.blendType = 0; // pc.BLEND_NONE
          }
        }

        mi.material.update();
      }
    }
  }

  /**
   * Apply glow tint to a mesh
   */
  private setMeshGlow(entity: any, intensity: number): void {
    if (!entity.render || intensity <= 0) return;

    const [r, g, b] = this.config.waveTint;

    for (const mi of entity.render.meshInstances || []) {
      if (mi.material) {
        // Add emissive glow
        if (mi.material.emissive) {
          mi.material.emissive.set(r * intensity, g * intensity, b * intensity);
          mi.material.emissiveIntensity = intensity;
          mi.material.update();
        }
      }
    }
  }

  /**
   * Remove glow from a mesh and restore original emissive values
   */
  private clearMeshGlow(entity: any, materialStates?: Map<any, MeshInstanceMaterialState>): void {
    if (!entity.render) return;

    for (const mi of entity.render.meshInstances || []) {
      if (mi.material && mi.material.emissive) {
        // Restore original emissive values if available
        const originalState = materialStates?.get(mi);
        if (originalState) {
          mi.material.emissive.set(
            originalState.originalEmissiveR,
            originalState.originalEmissiveG,
            originalState.originalEmissiveB
          );
          mi.material.emissiveIntensity = originalState.originalEmissiveIntensity;
        } else {
          // Fallback: set to zero
          mi.material.emissive.set(0, 0, 0);
          mi.material.emissiveIntensity = 0;
        }
        mi.material.update();
      }
    }
  }

  /**
   * Calculate the current wave radius
   */
  private getWaveRadius(): number {
    const { speed, acceleration } = this.config;
    // Quadratic motion: r = v*t + 0.5*a*t²
    return speed * this.effectTime + 0.5 * acceleration * this.effectTime * this.effectTime;
  }

  /**
   * Update the effect each frame
   */
  private update(dt: number): void {
    if (!this.enabled) return;

    this.effectTime += dt;
    const waveRadius = this.getWaveRadius();
    const { waveWidth, maxRadius, glowDuration } = this.config;

    let allRevealed = true;

    for (const state of this.meshStates) {
      // Calculate how much this mesh should be revealed (0 to 1)
      const distanceFromWave = state.distance - waveRadius;
      
      if (distanceFromWave > waveWidth) {
        // Wave hasn't reached this mesh yet
        allRevealed = false;
        continue;
      }

      if (distanceFromWave > 0) {
        // Wave is passing through this mesh - animate reveal
        const revealProgress = 1 - (distanceFromWave / waveWidth);
        
        // Scale in with slight overshoot
        const scaleMultiplier = this.easeOutBack(revealProgress);
        state.entity.setLocalScale(
          state.originalScale.x * scaleMultiplier,
          state.originalScale.y * scaleMultiplier,
          state.originalScale.z * scaleMultiplier
        );

        // Fade in opacity (don't need materialStates until final reveal)
        this.setMeshOpacity(state.entity, Math.min(1, revealProgress * 1.5), state.materialStates);

        // Apply glow at wave front
        const glowIntensity = Math.sin(revealProgress * Math.PI);
        this.setMeshGlow(state.entity, glowIntensity * 2);

        allRevealed = false;
        state.revealed = false;
        state.glowTime = glowDuration;
      } else if (!state.revealed) {
        // Wave has passed - finalize reveal
        state.entity.setLocalScale(
          state.originalScale.x,
          state.originalScale.y,
          state.originalScale.z
        );
        // Pass materialStates to restore original blend types
        this.setMeshOpacity(state.entity, 1, state.materialStates);

        // Start glow fadeout
        if (state.glowTime > 0) {
          state.glowTime -= dt;
          const glowIntensity = state.glowTime / glowDuration;
          this.setMeshGlow(state.entity, glowIntensity);
        } else {
          // Restore original emissive values
          this.clearMeshGlow(state.entity, state.materialStates);
          state.revealed = true;
        }
        
        if (state.glowTime > 0) {
          allRevealed = false;
        }
      }
    }

    // Check if effect is complete
    if (waveRadius > maxRadius && allRevealed && !this.completed) {
      this.completed = true;
      console.log('[GLBReveal] Reveal effect complete');
      this.config.onComplete();
      this.stop();
    }
  }

  /**
   * Easing function for scale animation (overshoot for bouncy feel)
   */
  private easeOutBack(t: number): number {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  /**
   * Check if the effect has completed
   */
  isComplete(): boolean {
    return this.completed;
  }

  /**
   * Stop the effect and clean up
   */
  stop(): void {
    this.enabled = false;

    if (this.updateHandler) {
      this.app.off('update', this.updateHandler);
      this.updateHandler = null;
    }

    // Ensure all meshes are fully revealed with proper material restoration
    for (const state of this.meshStates) {
      state.entity.setLocalScale(
        state.originalScale.x,
        state.originalScale.y,
        state.originalScale.z
      );
      // Restore original blend types and opacity
      this.setMeshOpacity(state.entity, 1, state.materialStates);
      // Restore original emissive values
      this.clearMeshGlow(state.entity, state.materialStates);
    }

    console.log('[GLBReveal] Effect stopped - materials restored');
  }

  /**
   * Update the center point
   */
  setCenter(x: number, y: number, z: number): void {
    this.config.center = { x, y, z };
  }

  /**
   * Destroy the effect and clean up
   */
  destroy(): void {
    this.stop();
    this.meshStates = [];
  }
}

/**
 * Convenience function to apply radial reveal to a newly loaded GLB entity
 */
export function applyRadialReveal(
  app: any,
  glbEntity: any,
  config?: GLBRevealConfig
): GLBRevealRadialEffect {
  const effect = new GLBRevealRadialEffect(app, glbEntity, config);
  effect.start();
  return effect;
}
