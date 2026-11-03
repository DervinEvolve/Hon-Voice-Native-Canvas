/**
 * Materialize Effect - Simple scale + opacity fade for object appearance
 * 
 * Objects fade in with a gentle scale animation when added to the scene.
 * Uses PlayCanvas's built-in systems (no custom shaders) for WebGPU compatibility.
 * 
 * Animation:
 * - Scale: 0% → 105% → 100% (gentle overshoot)
 * - Opacity: 0% → 100%
 * - Staggered timing for multiple objects
 */

export interface MaterializeEffectOptions {
  duration?: number;           // Total effect duration in seconds
  onComplete?: () => void;     // Callback when effect finishes
}

const DEFAULT_OPTIONS: Required<Omit<MaterializeEffectOptions, 'onComplete'>> & { onComplete?: () => void } = {
  duration: 0.8, // Shorter duration per object for snappier feel
  onComplete: undefined,
};

/**
 * Animation state for a single entity
 */
interface MaterializeAnimationState {
  entity: any;
  targetScale: { x: number; y: number; z: number };
  targetPosition: { x: number; y: number; z: number };
  startPosition: { x: number; y: number; z: number };
  startTime: number;
  duration: number;
  options: Required<Omit<MaterializeEffectOptions, 'onComplete'>> & { onComplete?: () => void };
  completed: boolean;
}

/**
 * Materialize Effect Manager - handles queuing and animating multiple objects
 * Uses simple scale + opacity animation (no custom shaders)
 */
export class MaterializeEffectManager {
  private pc: any;
  private app: any;
  private activeAnimations: Map<string, MaterializeAnimationState> = new Map();
  private queue: Array<{ entity: any; options: MaterializeEffectOptions }> = [];
  private maxConcurrent: number = 2; // Fewer concurrent for more visible stagger
  private staggerDelay: number = 0.35; // Longer delay between each object start
  private lastSpawnTime: number = 0;
  private updateHandler: (() => void) | null = null;
  private isRunning: boolean = false;
  
  constructor(pc: any, app: any, options?: { maxConcurrent?: number; staggerDelay?: number }) {
    this.pc = pc;
    this.app = app;
    this.maxConcurrent = options?.maxConcurrent ?? 2;
    this.staggerDelay = options?.staggerDelay ?? 0.35;
  }
  
  /**
   * Adds an entity to the materialize effect queue
   */
  materialize(entity: any, options: MaterializeEffectOptions = {}): void {
    if (!entity) {
      console.warn('[MaterializeEffect] materialize called with null entity');
      return;
    }
    
    // Add to queue
    this.queue.push({ entity, options });
    
    // Start processing if not already running
    if (!this.isRunning) {
      this.startProcessing();
    }
  }
  
  /**
   * Starts the animation loop
   */
  private startProcessing(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    
    this.updateHandler = () => this.update();
    this.app.on('update', this.updateHandler);
  }
  
  /**
   * Stops the animation loop
   */
  private stopProcessing(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    
    if (this.updateHandler) {
      this.app.off('update', this.updateHandler);
      this.updateHandler = null;
    }
  }
  
  /**
   * Easing function - ease out cubic for smooth deceleration
   */
  private easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }
  
  /**
   * Easing function - ease out back for slight overshoot
   */
  private easeOutBack(t: number): number {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
  
  /**
   * Main update loop
   */
  private update(): void {
    const currentTime = performance.now() / 1000;
    
    // Process queue with stagger
    while (
      this.queue.length > 0 &&
      this.activeAnimations.size < this.maxConcurrent &&
      currentTime - this.lastSpawnTime >= this.staggerDelay
    ) {
      const next = this.queue.shift();
      if (next) {
        this.startEntityAnimation(next.entity, next.options);
        this.lastSpawnTime = currentTime;
      }
    }
    
    // Update active animations
    const toRemove: string[] = [];
    
    this.activeAnimations.forEach((state, id) => {
      const elapsed = currentTime - state.startTime;
      const rawProgress = Math.min(elapsed / state.duration, 1);
      
      // Apply easing - ease out back gives gentle overshoot for scale
      const scaleProgress = this.easeOutBack(rawProgress);
      
      // Calculate current scale (0 → target with overshoot)
      state.entity.setLocalScale(
        state.targetScale.x * scaleProgress,
        state.targetScale.y * scaleProgress,
        state.targetScale.z * scaleProgress
      );
      
      // Animate position (rise up from below) with smooth easing
      const posProgress = this.easeOutCubic(rawProgress);
      state.entity.setPosition(
        state.startPosition.x + (state.targetPosition.x - state.startPosition.x) * posProgress,
        state.startPosition.y + (state.targetPosition.y - state.startPosition.y) * posProgress,
        state.startPosition.z + (state.targetPosition.z - state.startPosition.z) * posProgress
      );
      
      // Update opacity on materials
      const opacityProgress = this.easeOutCubic(rawProgress);
      this.setEntityOpacity(state.entity, opacityProgress);
      
      // Check if complete
      if (rawProgress >= 1 && !state.completed) {
        state.completed = true;
        // Ensure final state is exact
        state.entity.setLocalScale(
          state.targetScale.x,
          state.targetScale.y,
          state.targetScale.z
        );
        state.entity.setPosition(
          state.targetPosition.x,
          state.targetPosition.y,
          state.targetPosition.z
        );
        this.setEntityOpacity(state.entity, 1);
        state.options.onComplete?.();
        toRemove.push(id);
      }
    });
    
    // Remove completed animations
    toRemove.forEach(id => this.activeAnimations.delete(id));
    
    // Stop processing if nothing left
    if (this.activeAnimations.size === 0 && this.queue.length === 0) {
      this.stopProcessing();
    }
  }
  
  /**
   * Sets opacity on all materials of an entity
   */
  private setEntityOpacity(entity: any, opacity: number): void {
    const traverse = (e: any) => {
      if (e.render?.meshInstances) {
        e.render.meshInstances.forEach((mi: any) => {
          if (mi.material) {
            mi.material.opacity = opacity;
            if (opacity < 1) {
              mi.material.blendType = this.pc.BLEND_NORMAL;
            } else {
              mi.material.blendType = this.pc.BLEND_NONE;
            }
            mi.material.update();
          }
        });
      }
      e.children?.forEach(traverse);
    };
    traverse(entity);
  }
  
  /**
   * Starts animation for a single entity
   */
  private startEntityAnimation(entity: any, options: MaterializeEffectOptions): void {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const id = entity._guid || `entity_${Date.now()}_${Math.random()}`;
    
    // Store the target scale (what the entity should end up at)
    const currentScale = entity.getLocalScale();
    const targetScale = {
      x: currentScale.x,
      y: currentScale.y,
      z: currentScale.z,
    };
    
    // Store target position and calculate start position (slightly below)
    const currentPos = entity.getPosition();
    const targetPosition = {
      x: currentPos.x,
      y: currentPos.y,
      z: currentPos.z,
    };
    
    // Start 0.5 units below target position for "pop up" effect
    const startPosition = {
      x: currentPos.x,
      y: currentPos.y - 0.5,
      z: currentPos.z,
    };
    
    // Start at scale 0 and below target position
    entity.setLocalScale(0, 0, 0);
    entity.setPosition(startPosition.x, startPosition.y, startPosition.z);
    
    // Start at opacity 0
    this.setEntityOpacity(entity, 0);
    
    // Store animation state
    const state: MaterializeAnimationState = {
      entity,
      targetScale,
      targetPosition,
      startPosition,
      startTime: performance.now() / 1000,
      duration: opts.duration,
      options: opts,
      completed: false,
    };
    
    this.activeAnimations.set(id, state);
  }
  
  /**
   * Cancels all active animations and clears queue
   */
  clear(): void {
    // Complete all animations immediately
    this.activeAnimations.forEach(state => {
      state.entity.setLocalScale(
        state.targetScale.x,
        state.targetScale.y,
        state.targetScale.z
      );
      state.entity.setPosition(
        state.targetPosition.x,
        state.targetPosition.y,
        state.targetPosition.z
      );
      this.setEntityOpacity(state.entity, 1);
    });
    
    this.activeAnimations.clear();
    this.queue = [];
    this.stopProcessing();
  }
  
  /**
   * Destroys the manager
   */
  destroy(): void {
    this.clear();
  }
}

// Export singleton factory
let managerInstance: MaterializeEffectManager | null = null;

export function getMaterializeEffectManager(pc: any, app: any): MaterializeEffectManager {
  if (!managerInstance || (managerInstance as any).app !== app) {
    managerInstance?.destroy();
    managerInstance = new MaterializeEffectManager(pc, app);
  }
  return managerInstance;
}

export function destroyMaterializeEffectManager(): void {
  managerInstance?.destroy();
  managerInstance = null;
}

// Keep old exports for compatibility (they now point to new implementation)
export { MaterializeEffectManager as ForgeEffectManager };
export { getMaterializeEffectManager as getForgeEffectManager };
export { destroyMaterializeEffectManager as destroyForgeEffectManager };

