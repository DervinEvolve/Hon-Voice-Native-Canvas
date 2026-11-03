/**
 * Animated Character Controller for PlayCanvas
 * 
 * Handles loading animated GLB characters from the character library
 * and managing their animations based on movement state.
 * 
 * Design inspired by:
 * - PlayCanvas React's <Anim> component pattern
 * - Smooth player movement from Tezumie's demo
 * 
 * @see https://playcanvas-react.vercel.app/docs/api/components/anim
 * @see https://codevre.com/editor?project=7kR8qQoxNCVu1AwDEoqetvzkVGC3
 */

import * as pc from 'playcanvas';
import { CharacterDefinition, getCharacter, matchCharacterToIntent } from './characterLibrary';
import { debug } from '../../utils/debug';
import { WEAPON_MODELS_AVAILABLE } from './assetAvailability';

// Asset cache to avoid reloading the same character multiple times
const assetCache = new Map<string, pc.Asset>();

export type CameraMode = 'first-person' | 'third-person';

export interface CharacterControllerConfig {
  characterId?: string;        // ID from character library
  characterIntent?: string;    // Natural language intent to match
  isPlayer?: boolean;          // Is this the player character?
  cameraMode?: CameraMode;     // 'first-person' for FPS, 'third-person' for RPG/platformer
  speed?: number;              // Movement speed override
  jumpForce?: number;          // Jump force override
  position?: { x: number; y: number; z: number };
  rotation?: number;           // Y rotation in degrees
}

export interface LoadedCharacter {
  entity: pc.Entity;
  definition: CharacterDefinition;
  animations: Map<string, pc.AnimTrack>;
  animComponent?: pc.AnimComponent;
  currentAnimation: string;
  // Methods for animation control (inspired by PlayCanvas React <Anim>)
  playAnimation: (name: string, blendTime?: number) => void;
  stopAnimation: () => void;
}

/**
 * Load an animated character from the library
 * Uses asset caching to avoid reloading the same GLB multiple times
 */
export async function loadAnimatedCharacter(
  app: pc.Application,
  config: CharacterControllerConfig
): Promise<LoadedCharacter | null> {
  // Resolve character definition
  let charDef: CharacterDefinition | undefined;
  
  if (config.characterId) {
    charDef = getCharacter(config.characterId);
  } else if (config.characterIntent) {
    charDef = matchCharacterToIntent(config.characterIntent);
  }
  
  if (!charDef) {
    console.error('[AnimatedCharacter] No character found for config:', config);
    return null;
  }
  
  debug.log('[AnimatedCharacter] Loading:', charDef.name, 'from', charDef.glbUrl);

  try {
    // Check cache first (inspired by PlayCanvas React useAsset hook)
    let asset = assetCache.get(charDef.id);

    if (!asset) {
      // Load GLB asset
      debug.log('[AnimatedCharacter] Fetching asset from URL:', charDef.glbUrl);
      asset = new pc.Asset(charDef.id, 'container', {
        url: charDef.glbUrl
      });

      // Wait for asset to load with timeout
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.error('[AnimatedCharacter] Asset load TIMEOUT after 30s:', charDef.glbUrl);
          reject(new Error('Asset load timeout'));
        }, 30000);

        asset!.on('load', () => {
          debug.log('[AnimatedCharacter] Asset load SUCCESS:', charDef.id);
          clearTimeout(timeout);
          resolve();
        });
        asset!.on('error', (err: Error) => {
          console.error('[AnimatedCharacter] Asset load ERROR:', charDef.glbUrl, err);
          clearTimeout(timeout);
          reject(err);
        });

        app.assets.add(asset!);
        app.assets.load(asset!);
      });

      // Cache the asset for future use
      assetCache.set(charDef.id, asset);
      debug.log('[AnimatedCharacter] Asset cached:', charDef.name);
    } else {
      debug.log('[AnimatedCharacter] Using cached asset:', charDef.name);
    }
    
    // Get the container resource
    const container = asset.resource;
    if (!container) {
      console.error('[AnimatedCharacter] No container resource');
      return null;
    }

    // DEBUG: Log what's in the container
    debug.log('[AnimatedCharacter] Container contents for', charDef.id, {
      hasAnimations: !!container.animations,
      animationCount: container.animations?.length || 0,
      animationNames: container.animations?.map((a: any) => a.name) || [],
      hasRender: !!container.renders,
      renderCount: container.renders?.length || 0,
    });
    
    // Create container entity
    const entity = new pc.Entity(charDef.name);
    
    // Instantiate the model
    const modelEntity = container.instantiateRenderEntity();
    if (!modelEntity) {
      console.error('[AnimatedCharacter] Failed to instantiate model');
      return null;
    }
    
    // Add model as child
    entity.addChild(modelEntity);
    
    // Store character definition on entity for later access (e.g., camera mode switching)
    (entity as any)._characterDefinition = charDef;
    
    // Apply scale
    entity.setLocalScale(charDef.scale, charDef.scale, charDef.scale);
    
    // Apply position
    if (config.position) {
      entity.setPosition(config.position.x, config.position.y, config.position.z);
    }
    
    // Apply rotation
    if (config.rotation !== undefined) {
      entity.setEulerAngles(0, config.rotation, 0);
    }
    
    // Set up animations if available
    const animations = new Map<string, pc.AnimTrack>();
    let animComponent: pc.AnimComponent | undefined;
    let currentAnimation = charDef.defaultAnimation;
    
    if (container.animations && container.animations.length > 0) {
      const animNames = container.animations.map((a: any) => a.name || 'unnamed');
      console.log('[AnimatedCharacter] Found animations:', container.animations.length, animNames);

      // Store animations by name for direct access (normalize names)
      for (const anim of container.animations) {
        if (anim.name) {
          // Store by various name formats for flexible lookup
          animations.set(anim.name.toLowerCase(), anim);
          animations.set(anim.name, anim);
          // Also extract short name (e.g., "Idle" from "Armature|Idle" or "mixamo.com|Idle")
          const shortName = anim.name.split('|').pop()?.toLowerCase() || '';
          if (shortName) {
            animations.set(shortName, anim);
          }
        }
      }

      // Store clips on model entity for playAnimation
      (modelEntity as any)._animClips = container.animations;
      (modelEntity as any)._animMap = animations;

      // Method 1: Try using the anim component (PlayCanvas 1.58+)
      // This is the modern approach for GLB animations
      try {
        if (!modelEntity.anim) {
          modelEntity.addComponent('anim', {
            activate: true,
            speed: 1
          });
        }

        // Assign each animation to the anim component
        for (const clip of container.animations) {
          if (clip.name && modelEntity.anim) {
            // Create animation track and assign it
            modelEntity.anim.assignAnimation(clip.name, clip);
            console.log('[AnimatedCharacter] Assigned animation:', clip.name);
          }
        }

        // Find and play default animation
        const defaultClip = container.animations.find((a: any) =>
          a.name?.toLowerCase().includes('idle') ||
          a.name?.toLowerCase().includes('stand') ||
          a.name?.toLowerCase().includes('tpose') === false
        ) || container.animations[0];

        if (defaultClip && modelEntity.anim) {
          modelEntity.anim.baseLayer?.play(defaultClip.name);
          currentAnimation = defaultClip.name;
          console.log('[AnimatedCharacter] Playing default animation via anim component:', defaultClip.name);
        }
      } catch (animErr) {
        console.warn('[AnimatedCharacter] Anim component failed, trying legacy animation:', animErr);

        // Method 2: Fallback to legacy animation component
        try {
          if (!modelEntity.animation) {
            modelEntity.addComponent('animation', {
              activate: true,
              speed: 1,
              loop: true
            });
          }

          // For legacy component, we need to set the animations property directly
          if (modelEntity.animation) {
            const animDict: Record<string, any> = {};
            for (const clip of container.animations) {
              if (clip.name) {
                animDict[clip.name] = clip;
              }
            }
            modelEntity.animation.animations = animDict;

            // Play default
            const defaultClip = container.animations.find((a: any) =>
              a.name?.toLowerCase().includes('idle') ||
              a.name?.toLowerCase().includes('stand')
            ) || container.animations[0];

            if (defaultClip) {
              modelEntity.animation.play(defaultClip.name, 0.3);
              currentAnimation = defaultClip.name;
              console.log('[AnimatedCharacter] Playing default animation via legacy component:', defaultClip.name);
            }
          }
        } catch (legacyErr) {
          console.error('[AnimatedCharacter] Legacy animation also failed:', legacyErr);
        }
      }
    } else {
      console.warn('[AnimatedCharacter] No animations found in model - check GLB file');
    }
    
    // Tag appropriately
    if (config.isPlayer) {
      entity.tags.add('player');
    }
    
    // Add to scene
    app.root.addChild(entity);
    
    debug.log('[AnimatedCharacter] Character loaded successfully:', charDef.name);
    
    // Track warned animations to avoid log spam
    const warnedAnimations = new Set<string>();

    // Create animation control methods
    const playAnimation = (name: string, blendTime: number = 0.2) => {
      const modelEnt = entity.children[0] as any;
      if (!modelEnt) return;

      // Find matching animation clip (flexible name matching)
      const clips = modelEnt._animClips || [];
      const animMap = modelEnt._animMap as Map<string, any> || new Map();

      // Try direct lookup first
      let matchingClip = animMap.get(name) || animMap.get(name.toLowerCase());

      // If not found, search by partial match
      if (!matchingClip) {
        matchingClip = clips.find((c: any) => {
          const clipName = c.name?.toLowerCase() || '';
          const searchName = name.toLowerCase();
          // Match "idle" to "Armature|Idle", "mixamo.com|Idle_Loop", etc.
          return clipName.includes(searchName) ||
                 clipName.split('|').pop()?.includes(searchName);
        });
      }

      // If still not found and there's only 1 clip, use it as fallback (common for embedded GLB animations)
      if (!matchingClip && clips.length === 1) {
        matchingClip = clips[0];
      }

      // If still not found but there are clips, use first one silently
      if (!matchingClip && clips.length > 0) {
        matchingClip = clips[0];
      }

      if (!matchingClip) {
        // Only warn once per animation name to avoid log spam
        if (!warnedAnimations.has(name)) {
          warnedAnimations.add(name);
          console.warn('[AnimatedCharacter] Animation not found:', name, 'Available:', clips.map((c: any) => c.name));
        }
        return;
      }

      const clipName = matchingClip.name || name;

      // Try anim component first (modern PlayCanvas)
      if (modelEnt.anim) {
        try {
          if (modelEnt.anim.baseLayer) {
            modelEnt.anim.baseLayer.play(clipName);
          } else {
            modelEnt.anim.playing = true;
          }
          currentAnimation = clipName;
          console.log('[AnimatedCharacter] Playing via anim:', clipName);
          return;
        } catch (e) {
          console.warn('[AnimatedCharacter] anim.play failed:', e);
        }
      }

      // Fallback to legacy animation component
      if (modelEnt.animation) {
        try {
          modelEnt.animation.play(clipName, blendTime);
          currentAnimation = clipName;
          console.log('[AnimatedCharacter] Playing via animation:', clipName);
          return;
        } catch (e) {
          console.warn('[AnimatedCharacter] animation.play failed:', e);
        }
      }

      console.warn('[AnimatedCharacter] No animation component available');
    };
    
    const stopAnimation = () => {
      if (animComponent) {
        try {
          animComponent.baseLayer?.pause();
        } catch (e) {
          // Ignore
        }
      }
    };
    
    return {
      entity,
      definition: charDef,
      animations,
      animComponent,
      currentAnimation,
      playAnimation,
      stopAnimation
    };
    
  } catch (error) {
    console.error('[AnimatedCharacter] Failed to load character:', charDef.id, charDef.glbUrl, error);
    return null;
  }
}

/**
 * Preload characters into cache (for faster spawning later)
 */
export async function preloadCharacters(app: pc.Application, characterIds: string[]): Promise<void> {
  debug.log('[AnimatedCharacter] Preloading characters:', characterIds);
  
  await Promise.all(
    characterIds.map(async (id) => {
      const charDef = getCharacter(id);
      if (!charDef) return;
      
      if (assetCache.has(id)) {
        debug.log('[AnimatedCharacter] Already cached:', id);
        return;
      }
      
      const asset = new pc.Asset(id, 'container', { url: charDef.glbUrl });
      
      await new Promise<void>((resolve) => {
        asset.on('load', () => resolve());
        asset.on('error', () => resolve()); // Don't fail preload on error
        app.assets.add(asset);
        app.assets.load(asset);
      });
      
      assetCache.set(id, asset);
      debug.log('[AnimatedCharacter] Preloaded:', id);
    })
  );
}

/**
 * Clear the asset cache (for cleanup)
 */
export function clearCharacterCache(): void {
  assetCache.clear();
  debug.log('[AnimatedCharacter] Cache cleared');
}

/**
 * Create a proper animation state graph with parameters for automatic transitions
 * Based on PlayCanvas Anim component best practices
 */
function createAnimationStateGraph(
  charDef: CharacterDefinition,
  clipAssets: pc.AnimTrack[]
): { stateGraph: any; availableStates: Set<string> } | null {
  if (!clipAssets || clipAssets.length === 0) {
    console.warn('[AnimatedCharacter] No clip assets provided for state graph');
    return null;
  }

  // Map animation names to clip names
  const animToClip = new Map<string, string>();
  const availableStates = new Set<string>();

  for (const anim of charDef.animations) {
    const matchingClip = clipAssets.find(clip => {
      const clipName = (clip.name || '').toLowerCase();
      const searchName = anim.clipName.toLowerCase();
      return clipName.includes(searchName) || clipName === searchName ||
             clipName.includes(anim.name.toLowerCase());
    });

    if (matchingClip) {
      animToClip.set(anim.name, matchingClip.name);
      availableStates.add(anim.name);
    }
  }

  // If no matching animations found, try to map raw clips
  if (animToClip.size === 0) {
    debug.log('[AnimatedCharacter] No matching animations, using raw clips');
    for (const clip of clipAssets) {
      if (clip.name) {
        const shortName = clip.name.split('|').pop()?.toLowerCase() || clip.name.toLowerCase();
        // Try to identify animation type from name
        if (shortName.includes('idle')) {
          animToClip.set('idle', clip.name);
          availableStates.add('idle');
        } else if (shortName.includes('walk')) {
          animToClip.set('walk', clip.name);
          availableStates.add('walk');
        } else if (shortName.includes('run')) {
          animToClip.set('run', clip.name);
          availableStates.add('run');
        } else if (shortName.includes('jump')) {
          animToClip.set('jump', clip.name);
          availableStates.add('jump');
        }
      }
    }
  }

  if (animToClip.size === 0) {
    return null;
  }

  // Build states with proper structure
  const states: any[] = [];

  // Add each available animation as a state
  for (const [animName, clipName] of animToClip) {
    states.push({
      name: animName,
      speed: animName === 'run' ? 1.2 : 1.0,
      loop: true
    });
  }

  // Build transitions with conditions based on parameters
  const transitions: any[] = [];

  // idle -> walk (when speed > 0.1)
  if (availableStates.has('idle') && availableStates.has('walk')) {
    transitions.push({
      from: 'idle',
      to: 'walk',
      time: 0.2,
      conditions: [{ parameterName: 'speed', predicate: 'GREATER_THAN', value: 0.1 }]
    });
  }

  // walk -> idle (when speed <= 0.1)
  if (availableStates.has('walk') && availableStates.has('idle')) {
    transitions.push({
      from: 'walk',
      to: 'idle',
      time: 0.2,
      conditions: [{ parameterName: 'speed', predicate: 'LESS_THAN_EQUAL', value: 0.1 }]
    });
  }

  // walk -> run (when speed > 5)
  if (availableStates.has('walk') && availableStates.has('run')) {
    transitions.push({
      from: 'walk',
      to: 'run',
      time: 0.15,
      conditions: [{ parameterName: 'speed', predicate: 'GREATER_THAN', value: 5 }]
    });
  }

  // run -> walk (when speed <= 5)
  if (availableStates.has('run') && availableStates.has('walk')) {
    transitions.push({
      from: 'run',
      to: 'walk',
      time: 0.15,
      conditions: [{ parameterName: 'speed', predicate: 'LESS_THAN_EQUAL', value: 5 }]
    });
  }

  // idle -> run (when speed > 5, direct transition)
  if (availableStates.has('idle') && availableStates.has('run')) {
    transitions.push({
      from: 'idle',
      to: 'run',
      time: 0.2,
      conditions: [{ parameterName: 'speed', predicate: 'GREATER_THAN', value: 5 }]
    });
  }

  // run -> idle (when speed <= 0.1, direct)
  if (availableStates.has('run') && availableStates.has('idle')) {
    transitions.push({
      from: 'run',
      to: 'idle',
      time: 0.25,
      conditions: [{ parameterName: 'speed', predicate: 'LESS_THAN_EQUAL', value: 0.1 }]
    });
  }

  // any -> jump (when grounded = false and velocity > 0)
  if (availableStates.has('jump')) {
    transitions.push({
      from: '*',
      to: 'jump',
      time: 0.1,
      conditions: [{ parameterName: 'isJumping', predicate: 'EQUAL', value: true }]
    });
  }

  const stateGraph = {
    layers: [{
      name: 'Base',
      states,
      transitions
    }],
    parameters: {
      speed: { type: 'FLOAT', value: 0 },
      isGrounded: { type: 'BOOLEAN', value: true },
      isJumping: { type: 'BOOLEAN', value: false },
      isCrouching: { type: 'BOOLEAN', value: false }
    }
  };

  return { stateGraph, availableStates };
}

/**
 * Helper to set animation parameter safely
 */
function setAnimParam(anim: any, name: string, value: number | boolean): void {
  if (!anim) return;
  try {
    if (typeof value === 'boolean') {
      anim.setBoolean(name, value);
    } else {
      anim.setFloat(name, value);
    }
  } catch (e) {
    // Parameter might not exist, ignore silently
  }
}

/**
 * Add capsule collision to player character for proper physics interaction
 * Uses kinematic rigidbody for character controller style movement
 */
function addPlayerCollision(entity: pc.Entity, scale: number = 1): void {
  // Skip if already has collision
  if (entity.collision) {
    debug.log('[PlayerCollision] Entity already has collision, skipping');
    return;
  }

  try {
    // Character dimensions (adjusted for scale)
    const capsuleRadius = 0.35 * scale;
    const capsuleHeight = 1.8 * scale;

    // Add collision component (capsule shape for characters)
    entity.addComponent('collision', {
      type: 'capsule',
      radius: capsuleRadius,
      height: capsuleHeight,
      axis: 1 // Y-axis aligned
    });

    // Add kinematic rigidbody (controlled by code, not physics simulation)
    entity.addComponent('rigidbody', {
      type: 'kinematic',
      mass: 75,
      friction: 0.5,
      restitution: 0.0,
      linearDamping: 0,
      angularDamping: 0
    });

    // Tag for identification
    entity.tags.add('player_collision');

    debug.log('[PlayerCollision] Added capsule collision:', {
      radius: capsuleRadius,
      height: capsuleHeight,
      scale
    });
  } catch (e) {
    console.warn('[PlayerCollision] Failed to add collision:', e);
  }
}

/**
 * Player controller script for animated characters
 *
 * Controls:
 * - WASD / Arrows: Move
 * - Space: Jump
 * - Shift: Sprint
 * - E or Left Click: Shoot
 * - R: Reload
 * - C: Crouch
 * - F: Interact
 * - V: Toggle camera mode (handled by camera controller)
 */
export function createPlayerControllerScript(app: pc.Application, character: LoadedCharacter) {
  const entity = character.entity;
  const speed = character.definition.speed || 5;
  const jumpForce = character.definition.jumpForce || 8;

  // Add capsule collision to player for proper physics interaction
  addPlayerCollision(entity, character.definition.scale);

  // Movement state
  const state = {
    velocity: new pc.Vec3(),
    isGrounded: true,
    isMoving: false,
    isRunning: false,
    isCrouching: false,
    isShooting: false,
    isReloading: false,
    currentAnim: character.currentAnimation
  };
  
  // Keyboard state
  const keys: Record<string, boolean> = {};
  
  // Shoot state (E key or mouse)
  let isShootKeyDown = false;
  let isMouseDown = false;
  let shootCooldown = 0;
  const shootRate = 0.15; // Seconds between shots
  
  // Key handlers
  const onKeyDown = (e: KeyboardEvent) => {
    keys[e.code] = true;
    
    // E key for shooting (laptop-friendly!)
    if (e.code === 'KeyE') {
      isShootKeyDown = true;
    }
    
    // F key for interact
    if (e.code === 'KeyF') {
      app.fire('hon:player-interact', { 
        entity: entity.name,
        position: entity.getPosition().clone()
      });
    }
    
    // Handle reload
    if (e.code === 'KeyR' && !state.isReloading) {
      state.isReloading = true;
      app.fire('hon:player-reload', { entity: entity.name });
      character.playAnimation('reload', 0.2);
      
      // Reset reload state after animation
      setTimeout(() => {
        state.isReloading = false;
        app.fire('hon:player-reload-complete', { entity: entity.name });
      }, 1500);
    }
    
    // Handle crouch toggle
    if (e.code === 'KeyC') {
      state.isCrouching = !state.isCrouching;
      app.fire('hon:player-crouch', { entity: entity.name, crouching: state.isCrouching });
      
      // Adjust character height when crouching
      const currentScale = entity.getLocalScale();
      if (state.isCrouching) {
        entity.setLocalScale(currentScale.x, currentScale.y * 0.6, currentScale.z);
      } else {
        entity.setLocalScale(currentScale.x, currentScale.y / 0.6, currentScale.z);
      }
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    keys[e.code] = false;
    
    if (e.code === 'KeyE') {
      isShootKeyDown = false;
      state.isShooting = false;
    }
  };
  
  // Mouse handlers for shooting (for users with mice)
  const onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) { // Left click
      isMouseDown = true;
    }
  };
  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) {
      isMouseDown = false;
      state.isShooting = false;
    }
  };
  
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  
  // Camera reference (find by common names or tag)
  let camera = app.root.findByName('camera') as pc.Entity;
  if (!camera) {
    camera = app.root.findByName('Camera') as pc.Entity;
  }
  if (!camera) {
    camera = app.root.findByTag('camera')[0] as pc.Entity;
  }
  if (!camera) {
    // Last resort: find any entity with a camera component
    const allEntities = app.root.findComponents('camera');
    if (allEntities.length > 0) {
      camera = allEntities[0].entity as pc.Entity;
    }
  }
  debug.log('[PlayerController] Camera found:', camera?.name || 'NOT FOUND');
  
  // Shooting function
  const shoot = () => {
    if (state.isReloading) return;
    
    state.isShooting = true;
    
    // Get shoot direction from camera
    const shootDir = camera ? camera.forward.clone() : entity.forward.clone();
    const shootOrigin = camera ? camera.getPosition().clone() : entity.getPosition().clone();
    shootOrigin.y += 1.5; // Eye level
    
    // Fire shoot event with raycast info
    app.fire('hon:player-shoot', {
      entity: entity.name,
      origin: { x: shootOrigin.x, y: shootOrigin.y, z: shootOrigin.z },
      direction: { x: shootDir.x, y: shootDir.y, z: shootDir.z }
    });
    
    // Play shoot animation if available
    if (character.definition.animations.some(a => a.name.includes('shoot'))) {
      character.playAnimation('shoot', 0.1);
    }
  };
  
  // Update function
  const update = (dt: number) => {
    // Handle shooting (E key or left click)
    if ((isShootKeyDown || isMouseDown) && shootCooldown <= 0) {
      shoot();
      shootCooldown = shootRate;
    }
    shootCooldown -= dt;
    
    // Get input
    const forward = (keys['KeyW'] || keys['ArrowUp']) ? 1 : (keys['KeyS'] || keys['ArrowDown']) ? -1 : 0;
    const right = (keys['KeyD'] || keys['ArrowRight']) ? 1 : (keys['KeyA'] || keys['ArrowLeft']) ? -1 : 0;
    const sprint = keys['ShiftLeft'] || keys['ShiftRight'];
    const jump = keys['Space'];
    
    state.isMoving = forward !== 0 || right !== 0;
    state.isRunning = sprint && state.isMoving;
    
    // Calculate movement direction relative to camera
    const moveSpeed = state.isRunning ? speed * 1.8 : speed;
    
    if (state.isMoving && camera) {
      // Get camera forward/right (flattened to XZ plane)
      const camForward = camera.forward.clone();
      camForward.y = 0;
      camForward.normalize();
      
      const camRight = camera.right.clone();
      camRight.y = 0;
      camRight.normalize();
      
      // Calculate move direction
      const moveDir = new pc.Vec3();
      moveDir.add(camForward.mulScalar(-forward));
      moveDir.add(camRight.mulScalar(right));
      moveDir.normalize();
      
      // Apply movement
      const pos = entity.getPosition();
      pos.add(moveDir.mulScalar(moveSpeed * dt));
      entity.setPosition(pos);
      
      // Rotate character to face movement direction
      if (moveDir.lengthSq() > 0.001) {
        const targetAngle = Math.atan2(moveDir.x, moveDir.z) * (180 / Math.PI);
        const currentAngles = entity.getEulerAngles();
        
        // Smooth rotation
        let angleDiff = targetAngle - currentAngles.y;
        while (angleDiff > 180) angleDiff -= 360;
        while (angleDiff < -180) angleDiff += 360;
        
        const rotSpeed = 10;
        currentAngles.y += angleDiff * Math.min(1, rotSpeed * dt);
        entity.setEulerAngles(currentAngles);
      }
    }
    
    // Simple gravity
    if (!state.isGrounded) {
      state.velocity.y -= 20 * dt;
    }

    // Jump
    if (jump && state.isGrounded) {
      state.velocity.y = jumpForce;
      state.isGrounded = false;
    }

    // Apply vertical velocity
    const pos = entity.getPosition();
    pos.y += state.velocity.y * dt;

    // Ground check - use raycast if physics available, otherwise simple check
    let groundY = 0;
    if (app.systems.rigidbody) {
      try {
        const rayStart = new pc.Vec3(pos.x, pos.y + 1, pos.z);
        const rayEnd = new pc.Vec3(pos.x, pos.y - 10, pos.z);
        const result = app.systems.rigidbody.raycastFirst(rayStart, rayEnd);
        if (result) {
          groundY = result.point.y;
        }
      } catch {
        // Physics not ready, use default
      }
    }

    if (pos.y <= groundY) {
      pos.y = groundY;
      state.velocity.y = 0;
      state.isGrounded = true;
    }
    
    entity.setPosition(pos);

    // Update animation parameters (let state graph handle transitions)
    updateAnimationParams();
  };

  // Track if we're using a single embedded animation (no state machine needed)
  let usingSingleEmbeddedAnim = false;
  let embeddedAnimStarted = false;
  let useParameterBasedAnim = false;
  let paramAnimInitialized = false;

  // Calculate current movement speed for animation parameter
  const calculateSpeed = (): number => {
    if (!state.isMoving) return 0;
    return state.isRunning ? speed * 1.8 : speed;
  };

  // Update animation parameters - let the state graph handle transitions automatically
  const updateAnimationParams = () => {
    const modelEnt = entity.children[0] as any;
    if (!modelEnt) return;

    const clips = modelEnt._animClips || [];
    const anim = modelEnt.anim;

    // Check if any library animations actually exist in the clips
    const clipNames = clips.map((c: any) => c.name?.toLowerCase() || '');
    const hasWorkingLibraryAnims = character.definition.animations.some(a => {
      const searchName = (a.clipName || a.name).toLowerCase();
      return clipNames.some(cn => cn.includes(searchName) || cn.includes('idle') || cn.includes('walk'));
    });

    // If GLB has clips but none match library animations, use embedded animation
    if (clips.length > 0 && !hasWorkingLibraryAnims) {
      if (!embeddedAnimStarted) {
        embeddedAnimStarted = true;
        usingSingleEmbeddedAnim = true;
        debug.log('[AnimatedCharacter] Using embedded GLB animation:', clips[0]?.name);

        if (anim && anim.baseLayer) {
          anim.baseLayer.loop = true;
          anim.baseLayer.play(clips[0].name);
        } else {
          character.playAnimation(clips[0].name, 0.1);
        }
      }
      return; // Don't run state machine for embedded-only characters
    }

    // Try parameter-based animation (preferred)
    if (anim) {
      // Set parameters - state graph will handle transitions automatically
      const currentSpeed = calculateSpeed();
      setAnimParam(anim, 'speed', currentSpeed);
      setAnimParam(anim, 'isGrounded', state.isGrounded);
      setAnimParam(anim, 'isJumping', !state.isGrounded && state.velocity.y > 0);
      setAnimParam(anim, 'isCrouching', state.isCrouching);

      // Initialize with idle if this is first frame
      if (!paramAnimInitialized && hasWorkingLibraryAnims) {
        paramAnimInitialized = true;
        useParameterBasedAnim = true;

        // Find and play initial idle animation
        const idleClip = clips.find((c: any) =>
          c.name?.toLowerCase().includes('idle')
        );
        if (idleClip && anim.baseLayer) {
          anim.baseLayer.play(idleClip.name);
        }
        debug.log('[AnimatedCharacter] Initialized parameter-based animation');
      }

      // If parameters are working, let state graph handle it
      if (useParameterBasedAnim) {
        return;
      }
    }

    // Fallback to manual animation switching if parameters don't work
    let targetAnim = 'idle';

    if (!state.isGrounded) {
      targetAnim = state.velocity.y > 0 ? 'jump' : 'idle';
    } else if (state.isRunning) {
      targetAnim = 'run';
    } else if (state.isMoving) {
      targetAnim = 'walk';
    }

    // Check if animation exists, with fallback chain
    const hasAnim = character.definition.animations.some(a => a.name === targetAnim);
    if (!hasAnim) {
      const fallbacks: Record<string, string[]> = {
        'run': ['walk', 'idle'],
        'jump': ['idle'],
        'walk': ['run', 'idle'],
        'idle': []
      };

      const fallbackList = fallbacks[targetAnim] || [];
      for (const fallback of fallbackList) {
        if (character.definition.animations.some(a => a.name === fallback)) {
          targetAnim = fallback;
          break;
        }
      }
    }

    // Only switch if animation changed
    if (targetAnim !== state.currentAnim) {
      state.currentAnim = targetAnim;
      character.playAnimation(targetAnim, 0.15);
    }
  };
  
  // Register update
  app.on('update', update);
  
  // Notify that player controller is active (so free camera can be disabled)
  app.fire('hon:player-controller-active', { entityName: entity.name });
  debug.log('[PlayerController] Player controller active for:', entity.name);
  
  // Cleanup function
  const cleanup = () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mouseup', onMouseUp);
    app.off('update', update);
    app.fire('hon:player-controller-removed', { entityName: entity.name });
  };
  
  return { update, cleanup, state };
}

/**
 * Simple third-person camera follow script
 * @param autoRegister - If true, automatically registers update handler. Set to false when using with dual mode controller.
 */
export function createFollowCameraScript(
  app: pc.Application, 
  target: pc.Entity,
  cameraEntity: pc.Entity,
  autoRegister: boolean = true
) {
  const params = {
    distance: 8,
    height: 4,
    smoothSpeed: 5,
    lookOffset: new pc.Vec3(0, 1.5, 0),
    yaw: 0,
    pitch: -15,
    mouseSensitivity: 0.2,
    minPitch: -45,
    maxPitch: 45,
    minDistance: 2,
    maxDistance: 20,
  };
  
  let isPointerLocked = false;
  
  // Pointer lock
  const canvas = app.graphicsDevice.canvas as HTMLCanvasElement;
  canvas.addEventListener('click', () => {
    if (!isPointerLocked) {
      canvas.requestPointerLock();
    }
  });
  
  document.addEventListener('pointerlockchange', () => {
    isPointerLocked = document.pointerLockElement === canvas;
  });
  
  // Mouse look
  window.addEventListener('mousemove', (e) => {
    if (!isPointerLocked) return;
    params.yaw -= e.movementX * params.mouseSensitivity;
    params.pitch -= e.movementY * params.mouseSensitivity;
    params.pitch = Math.max(params.minPitch, Math.min(params.maxPitch, params.pitch));
  });
  
  // Zoom
  window.addEventListener('wheel', (e) => {
    params.distance += e.deltaY * 0.01;
    params.distance = Math.max(params.minDistance, Math.min(params.maxDistance, params.distance));
  });
  
  const update = (dt: number) => {
    const targetPos = target.getPosition().clone();
    targetPos.add(params.lookOffset);
    
    // Calculate camera position from spherical coordinates
    const yawRad = params.yaw * Math.PI / 180;
    const pitchRad = params.pitch * Math.PI / 180;
    
    const offset = new pc.Vec3(
      Math.sin(yawRad) * Math.cos(pitchRad) * params.distance,
      Math.sin(pitchRad) * params.distance + params.height,
      Math.cos(yawRad) * Math.cos(pitchRad) * params.distance
    );
    
    const desiredPos = targetPos.clone().add(offset);
    
    // Smooth follow
    const currentPos = cameraEntity.getPosition();
    currentPos.lerp(currentPos, desiredPos, Math.min(1, params.smoothSpeed * dt));
    cameraEntity.setPosition(currentPos);
    
    // Look at target
    cameraEntity.lookAt(targetPos);
  };
  
  // Only auto-register if not being managed by dual mode controller
  if (autoRegister) {
    app.on('update', update);
  }
  
  return { update, params };
}

/**
 * First-person camera script for FPS games
 * @param autoRegister - If true, automatically registers update handler. Set to false when using with dual mode controller.
 * Camera is positioned at eye level inside the character
 */
export function createFirstPersonCameraScript(
  app: pc.Application,
  target: pc.Entity,
  cameraEntity: pc.Entity,
  autoRegister: boolean = true
) {
  const params = {
    eyeHeight: 1.7,           // Eye level offset from character position
    mouseSensitivity: 0.15,
    pitch: 0,
    yaw: 0,
    minPitch: -89,
    maxPitch: 89,
  };

  // FPS arm dynamics - for smooth, natural weapon movement
  const armState = {
    currentPitch: 0,          // Current arm pitch (lerped)
    currentSway: 0,           // Horizontal sway from mouse movement
    lastMouseX: 0,            // For calculating mouse velocity
    lastMouseY: 0,
    swayAmount: 0,            // Current sway amount
    bobTime: 0,               // For walk bob effect
  };
  
  let isPointerLocked = false;
  
  // Pointer lock for mouse capture
  const canvas = app.graphicsDevice.canvas as HTMLCanvasElement;
  canvas.addEventListener('click', () => {
    if (!isPointerLocked) {
      canvas.requestPointerLock();
    }
  });
  
  document.addEventListener('pointerlockchange', () => {
    isPointerLocked = document.pointerLockElement === canvas;
  });
  
  // Mouse look - direct control of view direction
  window.addEventListener('mousemove', (e) => {
    if (!isPointerLocked) return;
    params.yaw -= e.movementX * params.mouseSensitivity;
    params.pitch -= e.movementY * params.mouseSensitivity;
    params.pitch = Math.max(params.minPitch, Math.min(params.maxPitch, params.pitch));

    // Track mouse velocity for weapon sway
    armState.lastMouseX = e.movementX;
    armState.lastMouseY = e.movementY;
  });
  
  const update = (dt: number) => {
    // Position camera at character's eye level
    const targetPos = target.getPosition().clone();
    targetPos.y += params.eyeHeight;
    cameraEntity.setPosition(targetPos);

    // Apply rotation from mouse look
    cameraEntity.setEulerAngles(params.pitch, params.yaw, 0);

    // Update FPS arm dynamics (if arms are attached)
    if (fpsArmsEntity && fpsArmsEntity.parent) {
      // Lerp arm pitch to follow camera pitch (arms aim up/down with look direction)
      // Use a portion of camera pitch so arms respond naturally
      const targetArmPitch = params.pitch * 0.3; // Arms follow 30% of camera pitch
      armState.currentPitch += (targetArmPitch - armState.currentPitch) * Math.min(1, dt * 8);

      // Weapon sway from mouse movement (decays over time)
      const swayInfluence = 0.8; // How much mouse movement affects sway
      const swayDecay = 6; // How quickly sway returns to center
      const maxSway = 3; // Max sway angle in degrees

      armState.swayAmount += armState.lastMouseX * swayInfluence * dt * 10;
      armState.swayAmount = Math.max(-maxSway, Math.min(maxSway, armState.swayAmount));
      armState.swayAmount *= Math.max(0, 1 - dt * swayDecay); // Decay towards 0

      // Reset mouse velocity (it's consumed)
      armState.lastMouseX *= 0.8;
      armState.lastMouseY *= 0.8;

      // Apply local rotation to arms (relative to camera)
      // Base rotation: -15 pitch (from static positioning) + dynamic pitch + sway
      const basePitch = -15; // From our static positioning
      fpsArmsEntity.setLocalEulerAngles(
        basePitch + armState.currentPitch,
        180, // Face forward
        armState.swayAmount // Roll for sway effect
      );
    }
  };
  
  // Only auto-register if not being managed by dual mode controller
  if (autoRegister) {
    app.on('update', update);
  }
  
  // Hide the player model in first-person (we only want to see arms/weapon)
  const hidePlayerModel = () => {
    // Find all render components in the character and its children, and disable them
    const hideRecursive = (entity: pc.Entity) => {
      const render = entity.render;
      if (render) {
        render.enabled = false;
      }
      entity.children.forEach((child: pc.Entity) => hideRecursive(child));
    };
    hideRecursive(target);
    debug.log('[FPSCamera] Player model hidden (all render components disabled)');
  };
  
  const showPlayerModel = () => {
    // Re-enable all render components in the character and its children
    const showRecursive = (entity: pc.Entity) => {
      const render = entity.render;
      if (render) {
        render.enabled = true;
      }
      entity.children.forEach((child: pc.Entity) => showRecursive(child));
    };
    showRecursive(target);

    // Reset character to standing position (fix ragdoll issue)
    // Get current position but ensure Y is at ground level or current height
    const pos = target.getPosition();
    target.setPosition(pos.x, Math.max(0, pos.y), pos.z);

    // Reset rotation to upright (only preserve Y rotation for facing direction)
    const rot = target.getEulerAngles();
    target.setEulerAngles(0, rot.y, 0);

    // Reset scale to original (in case crouch modified it)
    const charDef = (target as any)._characterDefinition;
    if (charDef?.scale) {
      target.setLocalScale(charDef.scale, charDef.scale, charDef.scale);
    }

    debug.log('[FPSCamera] Player model shown and reset to standing position');
  };
  
  // Hide player model by default in FPS mode
  hidePlayerModel();
  
  // FPS arms entity (attached to camera, shows hands + weapon)
  let fpsArmsEntity: pc.Entity | null = null;
  
  // Attach FPS arms with weapon to camera
  const attachFPSArms = async (weaponType: 'akm' | 'glock' | 'shotgun' | 'knife' = 'akm'): Promise<pc.Entity | null> => {
    if (!WEAPON_MODELS_AVAILABLE) {
      debug.log('[FPSArms] FPS arm rigs and weapon models are not in this build; first-person view has no arms');
      return null;
    }
    try {
      // Import asset registry to get FPS rig path
      const { ASSET_BASE_URL } = await import('./assetRegistry');
      
      // Use the pre-made FPS rig with AKM, or basic arms
      // Note: URL encode spaces in filenames
      const fpsRigPath = weaponType === 'akm' 
        ? `${ASSET_BASE_URL}/fps/rigs/Fps%20Rig%20AKM.glb`
        : `${ASSET_BASE_URL}/fps/rigs/Fps%20Rig.glb`;
      
      debug.log('[FPSArms] Loading FPS arms:', fpsRigPath);
      
      // Load the FPS rig
      const fpsAsset = new pc.Asset('fps_arms', 'container', { url: fpsRigPath });
      
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('FPS arms load timeout')), 15000);
        fpsAsset.on('load', () => { clearTimeout(timeout); resolve(); });
        fpsAsset.on('error', (err: Error) => { clearTimeout(timeout); reject(err); });
        app.assets.add(fpsAsset);
        app.assets.load(fpsAsset);
      });
      
      const container = fpsAsset.resource;
      if (!container) {
        console.error('[FPSArms] No container in loaded asset');
        return null;
      }
      
      // Instantiate the FPS arms
      fpsArmsEntity = container.instantiateRenderEntity();
      if (!fpsArmsEntity) {
        console.error('[FPSArms] Failed to instantiate FPS arms');
        return null;
      }
      
      fpsArmsEntity.name = 'fps_arms';
      fpsArmsEntity.tags.add('fps_arms');
      
      // Attach to camera as child
      cameraEntity.addChild(fpsArmsEntity);

      // Position arms in front of camera - classic FPS viewmodel
      // Arms should be in bottom-right quadrant, not blocking center of view
      // X: 0.25 (slightly right), Y: -0.75 (low on screen), Z: -1.1 (pushed forward)
      fpsArmsEntity.setLocalPosition(0.25, -0.75, -1.1);
      // Initial rotation - will be overwritten by dynamic update loop
      // Base pitch (-15) + dynamic pitch from camera + sway from mouse movement
      fpsArmsEntity.setLocalEulerAngles(-15, 180, 0);
      // Scale 0.32 keeps weapon visible but not intrusive (like CS:GO, CoD)
      fpsArmsEntity.setLocalScale(0.32, 0.32, 0.32);

      debug.log('[FPSArms] Arms positioned with dynamic rotation enabled');
      
      debug.log('[FPSArms] FPS arms attached to camera');
      
      // If not using pre-made AKM rig, attach weapon separately
      if (weaponType !== 'akm') {
        // Load and attach the weapon to the arms
        const { WEAPON_ATTACHMENTS } = await import('./characterLibrary');
        let weaponPath = WEAPON_ATTACHMENTS.firearms.akm.path;
        
        if (weaponType === 'glock') weaponPath = WEAPON_ATTACHMENTS.firearms.glock.path;
        else if (weaponType === 'shotgun') weaponPath = WEAPON_ATTACHMENTS.firearms.shotgun.path;
        else if (weaponType === 'knife') weaponPath = WEAPON_ATTACHMENTS.melee.knife.path;
        
        const weaponAsset = new pc.Asset('fps_weapon', 'container', { url: weaponPath });
        
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Weapon load timeout')), 10000);
          weaponAsset.on('load', () => { clearTimeout(timeout); resolve(); });
          weaponAsset.on('error', (err: Error) => { clearTimeout(timeout); reject(err); });
          app.assets.add(weaponAsset);
          app.assets.load(weaponAsset);
        });
        
        const weaponEntity = weaponAsset.resource?.instantiateRenderEntity();
        if (weaponEntity) {
          // Find hand bone in FPS arms
          const handBoneNames = ['RightHand', 'mixamorig:RightHand', 'Hand_R', 'hand_r'];
          let handBone: pc.Entity | null = null;
          
          for (const boneName of handBoneNames) {
            handBone = fpsArmsEntity.findByName(boneName) as pc.Entity;
            if (handBone) break;
          }
          
          if (handBone) {
            handBone.addChild(weaponEntity);
            weaponEntity.setLocalPosition(0.02, 0.02, 0.1);
            weaponEntity.setLocalEulerAngles(-90, 0, 0);
            weaponEntity.setLocalScale(0.02, 0.02, 0.02);
          } else {
            fpsArmsEntity.addChild(weaponEntity);
            weaponEntity.setLocalPosition(0.15, -0.1, 0.3);
            weaponEntity.setLocalEulerAngles(-5, 0, 0);
            weaponEntity.setLocalScale(0.02, 0.02, 0.02);
          }
          
          debug.log('[FPSArms] Weapon attached to FPS arms');
        }
      }
      
      return fpsArmsEntity;
      
    } catch (error) {
      console.error('[FPSArms] Failed to load FPS arms:', error);
      return null;
    }
  };
  
  // Check if FPS arms entity is still valid (hasn't been destroyed externally)
  const isFPSArmsValid = (): boolean => {
    // An entity is invalid if it's null or has been destroyed (no parent means detached from scene)
    return fpsArmsEntity !== null && fpsArmsEntity.parent !== null;
  };

  // Hide FPS arms (for third-person mode)
  const hideFPSArms = () => {
    if (isFPSArmsValid()) {
      fpsArmsEntity!.enabled = false;
      debug.log('[FPSArms] FPS arms hidden');
    } else if (fpsArmsEntity !== null) {
      // Entity was destroyed externally, clean up reference
      debug.log('[FPSArms] FPS arms were destroyed externally, cleaning up reference');
      fpsArmsEntity = null;
    }
  };

  // Show FPS arms (for first-person mode)
  const showFPSArms = () => {
    if (isFPSArmsValid()) {
      fpsArmsEntity!.enabled = true;
      debug.log('[FPSArms] FPS arms shown');
    } else if (fpsArmsEntity !== null) {
      // Entity was destroyed externally, clean up reference
      debug.log('[FPSArms] FPS arms were destroyed externally, cleaning up reference');
      fpsArmsEntity = null;
    }
  };

  // Check if FPS arms are loaded and valid
  const areFPSArmsLoaded = (): boolean => {
    return isFPSArmsValid();
  };

  // Remove FPS arms completely
  const removeFPSArms = () => {
    if (fpsArmsEntity) {
      if (fpsArmsEntity.parent !== null) {
        fpsArmsEntity.destroy();
      }
      fpsArmsEntity = null;
      debug.log('[FPSArms] FPS arms removed');
    }
  };
  
  return {
    update,
    params,
    hidePlayerModel,
    showPlayerModel,
    attachFPSArms,
    hideFPSArms,
    showFPSArms,
    removeFPSArms,
    areFPSArmsLoaded,
    getYaw: () => params.yaw
  };
}

/**
 * Camera controller that supports switching between first-person and third-person
 * In first-person mode, shows FPS arms with weapon attached to camera
 */
export function createDualModeCameraController(
  app: pc.Application,
  target: pc.Entity,
  cameraEntity: pc.Entity,
  initialMode: CameraMode = 'third-person',
  weaponType: 'akm' | 'glock' | 'shotgun' | 'knife' = 'akm'
) {
  let currentMode: CameraMode = initialMode;
  let fpController: ReturnType<typeof createFirstPersonCameraScript> | null = null;
  let tpController: ReturnType<typeof createFollowCameraScript> | null = null;

  // Initialize both controllers with autoRegister: false
  // The dual mode controller manages which update runs based on current mode
  fpController = createFirstPersonCameraScript(app, target, cameraEntity, false);
  tpController = createFollowCameraScript(app, target, cameraEntity, false);

  // Start with the correct mode
  const setMode = async (mode: CameraMode) => {
    currentMode = mode;

    if (mode === 'first-person') {
      // Hide player model, use FPS camera
      fpController?.hidePlayerModel();

      // Check if FPS arms are loaded and valid using the controller's validation
      const armsLoaded = fpController?.areFPSArmsLoaded?.() ?? false;

      // Attach FPS arms with weapon if not already loaded or if they were destroyed
      if (!armsLoaded && fpController?.attachFPSArms) {
        debug.log('[Camera] Loading FPS arms with weapon:', weaponType);
        await fpController.attachFPSArms(weaponType);
      } else if (armsLoaded && fpController?.showFPSArms) {
        // Show existing FPS arms
        fpController.showFPSArms();
      }

      debug.log('[Camera] Switched to first-person mode with FPS arms');
    } else {
      // Show player model, use third-person camera
      fpController?.showPlayerModel();

      // Hide FPS arms in third-person (keep them loaded for quick switching)
      // The hideFPSArms function now handles destroyed entities gracefully
      fpController?.hideFPSArms?.();

      debug.log('[Camera] Switched to third-person mode');
    }

    app.fire('hon:camera-mode-changed', { mode });
  };
  
  // Set initial mode (async)
  setMode(initialMode);
  
  // Toggle with V key
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'KeyV') {
      setMode(currentMode === 'first-person' ? 'third-person' : 'first-person');
    }
  };
  
  window.addEventListener('keydown', onKeyDown);
  
  // Create unified update that uses the active camera
  const wrappedUpdate = (dt: number) => {
    if (currentMode === 'first-person') {
      fpController?.update(dt);
    } else {
      tpController?.update(dt);
    }
  };
  
  // Register the unified update handler (individual controllers have autoRegister: false)
  app.on('update', wrappedUpdate);
  
  return {
    setMode,
    getMode: () => currentMode,
    toggle: () => setMode(currentMode === 'first-person' ? 'third-person' : 'first-person'),
    cleanup: () => {
      window.removeEventListener('keydown', onKeyDown);
      app.off('update', wrappedUpdate);
      fpController?.removeFPSArms();
    }
  };
}

/**
 * Attach a weapon to a character's hand
 * Finds the hand bone and parents the weapon GLB to it
 */
export async function attachWeaponToCharacter(
  app: pc.Application,
  character: LoadedCharacter,
  weaponPath: string,
  weaponId: string = 'weapon'
): Promise<pc.Entity | null> {
  debug.log('[WeaponAttachment] Attaching weapon:', weaponPath, 'to', character.definition.name);
  
  try {
    // Load weapon GLB
    const weaponAsset = new pc.Asset(weaponId, 'container', { url: weaponPath });
    
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Weapon load timeout')), 10000);
      weaponAsset.on('load', () => { clearTimeout(timeout); resolve(); });
      weaponAsset.on('error', (err: Error) => { clearTimeout(timeout); reject(err); });
      app.assets.add(weaponAsset);
      app.assets.load(weaponAsset);
    });
    
    const container = weaponAsset.resource;
    if (!container) {
      console.error('[WeaponAttachment] No weapon container');
      return null;
    }
    
    // Instantiate weapon model
    const weaponEntity = container.instantiateRenderEntity();
    if (!weaponEntity) {
      console.error('[WeaponAttachment] Failed to instantiate weapon');
      return null;
    }
    
    weaponEntity.name = weaponId;
    weaponEntity.tags.add('weapon');
    
    // Find hand bone - check common bone names
    const handBoneNames = [
      'RightHand', 'mixamorig:RightHand', 'Hand_R', 'hand_r', 'hand.R',
      'RightHandIndex1', 'mixamorig:RightHandIndex1',
      'Weapon', 'weapon_bone', 'WeaponAttach',
      'Bip01_R_Hand', 'Bip001_R_Hand'
    ];
    
    // Search for hand bone in the character model
    let handBone: pc.Entity | null = null;
    const modelEntity = character.entity.children[0]; // The actual model is first child
    
    if (modelEntity) {
      for (const boneName of handBoneNames) {
        handBone = modelEntity.findByName(boneName) as pc.Entity;
        if (handBone) {
          debug.log('[WeaponAttachment] Found hand bone:', boneName);
          break;
        }
      }
    }
    
    // Scale weapon appropriately (GLB weapons are often huge)
    const weaponScale = 0.02; // Weapons are typically 50-100x too large
    
    if (handBone) {
      // Attach to hand bone
      handBone.addChild(weaponEntity);
      
      // Position and rotate weapon relative to hand
      weaponEntity.setLocalPosition(0.02, 0.02, 0.1);
      weaponEntity.setLocalEulerAngles(-90, 0, 0);
      weaponEntity.setLocalScale(weaponScale, weaponScale, weaponScale);
      
      debug.log('[WeaponAttachment] Weapon attached to hand bone, scale:', weaponScale);
    } else {
      // Fallback: attach to character root with offset (visible in first-person)
      console.warn('[WeaponAttachment] No hand bone found, attaching to root with offset');
      character.entity.addChild(weaponEntity);
      weaponEntity.setLocalPosition(0.3, 1.0, 0.5); // In front of player at chest level
      weaponEntity.setLocalEulerAngles(-5, 180, 0); // Pointing forward
      weaponEntity.setLocalScale(weaponScale, weaponScale, weaponScale);
    }
    
    // Store weapon reference on character entity
    (character.entity as any)._weapon = weaponEntity;
    
    debug.log('[WeaponAttachment] Weapon attached successfully');
    return weaponEntity;
    
  } catch (error) {
    console.error('[WeaponAttachment] Failed:', error);
    return null;
  }
}

/**
 * Hit detection system for shooting
 * Performs raycasts and handles damage to enemies
 */
export function createHitDetectionSystem(app: pc.Application): {
  onShoot: (origin: pc.Vec3, direction: pc.Vec3, damage?: number) => void;
  cleanup: () => void;
} {
  debug.log('[HitDetection] Initializing hit detection system');
  
  // Enemy health tracking
  const enemyHealth = new Map<string, number>();
  const defaultEnemyHealth = 100;
  const defaultDamage = 25;
  
  // Get health for entity (create default if not exists)
  const getHealth = (entityId: string): number => {
    if (!enemyHealth.has(entityId)) {
      enemyHealth.set(entityId, defaultEnemyHealth);
    }
    return enemyHealth.get(entityId)!;
  };
  
  // Apply damage to entity
  const applyDamage = (entity: pc.Entity, damage: number) => {
    const entityId = entity.getGuid();
    const currentHealth = getHealth(entityId);
    const newHealth = Math.max(0, currentHealth - damage);
    enemyHealth.set(entityId, newHealth);
    
    debug.log(`[HitDetection] ${entity.name} took ${damage} damage. Health: ${newHealth}/${defaultEnemyHealth}`);
    
    // Fire damage event
    app.fire('hon:enemy-damaged', {
      entityId,
      name: entity.name,
      damage,
      health: newHealth,
      maxHealth: defaultEnemyHealth
    });
    
    // Create hit effect
    createHitEffect(app, entity.getPosition());
    
    // Check for death
    if (newHealth <= 0) {
      debug.log(`[HitDetection] ${entity.name} defeated!`);
      app.fire('hon:enemy-defeated', {
        entityId,
        name: entity.name
      });
      
      // Remove enemy after short delay (for death animation)
      setTimeout(() => {
        if (entity.parent) {
          entity.destroy();
        }
        enemyHealth.delete(entityId);
      }, 500);
    }
  };
  
  // Shoot handler - performs raycast and checks for enemy hits
  const onShoot = (origin: pc.Vec3, direction: pc.Vec3, damage: number = defaultDamage) => {
    // Normalize direction
    const dir = direction.clone().normalize();
    
    // Raycast length
    const rayLength = 100;
    const end = origin.clone().add(dir.mulScalar(rayLength));
    
    // Perform raycast if physics is available and fully initialized
    // Note: app.systems.rigidbody may exist but ammo.js might not be ready
    let raycastSucceeded = false;
    if (app.systems.rigidbody) {
      try {
        const result = app.systems.rigidbody.raycastFirst(origin, end);
        raycastSucceeded = true;

        if (result) {
          const hitEntity = result.entity;

          // Check if hit entity is an enemy
          if (hitEntity.tags.has('enemy')) {
            applyDamage(hitEntity, damage);
          } else {
            // Hit something else - create impact effect
            createImpactEffect(app, result.point);
          }

          app.fire('hon:raycast-hit', {
            entity: hitEntity.name,
            point: result.point,
            normal: result.normal,
            isEnemy: hitEntity.tags.has('enemy')
          });
        }
      } catch (err) {
        // Physics system not fully initialized (ammo.js not ready)
        // Fall through to proximity-based detection
        console.warn('[HitDetection] Raycast failed, using fallback:', err);
        raycastSucceeded = false;
      }
    }

    // Fallback: proximity-based hit detection (when physics unavailable or failed)
    if (!raycastSucceeded) {
      const enemies = app.root.findByTag('enemy');
      for (const enemy of enemies) {
        const enemyPos = enemy.getPosition();
        
        // Simple distance + direction check
        const toEnemy = enemyPos.clone().sub(origin);
        const distance = toEnemy.length();
        
        if (distance < rayLength) {
          toEnemy.normalize();
          const dot = dir.dot(toEnemy);
          
          // Check if enemy is roughly in shoot direction
          if (dot > 0.9) { // Within ~25 degrees
            applyDamage(enemy, damage);
            break;
          }
        }
      }
    }
  };
  
  // Listen for player shoot events
  const shootHandler = (event: { origin: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } }) => {
    const origin = new pc.Vec3(event.origin.x, event.origin.y, event.origin.z);
    const direction = new pc.Vec3(event.direction.x, event.direction.y, event.direction.z);
    onShoot(origin, direction);
  };
  
  app.on('hon:player-shoot', shootHandler);
  
  return {
    onShoot,
    cleanup: () => {
      app.off('hon:player-shoot', shootHandler);
      enemyHealth.clear();
    }
  };
}

/**
 * Create visual hit effect at position (red flash)
 */
function createHitEffect(app: pc.Application, position: pc.Vec3): void {
  const effect = new pc.Entity('hit_effect');
  effect.addComponent('render', { type: 'sphere' });
  effect.setPosition(position);
  effect.setLocalScale(0.5, 0.5, 0.5);
  
  const mat = new pc.StandardMaterial();
  mat.emissive = new pc.Color(1, 0, 0);
  mat.emissiveIntensity = 5;
  mat.opacity = 0.8;
  mat.blendType = pc.BLEND_NORMAL;
  mat.update();
  
  effect.render!.meshInstances.forEach(mi => mi.material = mat);
  app.root.addChild(effect);
  
  // Animate and remove
  let scale = 0.5;
  const updateEffect = (dt: number) => {
    scale += dt * 2;
    const opacity = Math.max(0, 1 - scale);
    effect.setLocalScale(scale, scale, scale);
    mat.opacity = opacity;
    mat.update();
    
    if (opacity <= 0) {
      app.off('update', updateEffect);
      effect.destroy();
    }
  };
  app.on('update', updateEffect);
}

/**
 * Create impact effect at position (spark)
 */
function createImpactEffect(app: pc.Application, position: pc.Vec3): void {
  const effect = new pc.Entity('impact_effect');
  effect.addComponent('render', { type: 'sphere' });
  effect.setPosition(position);
  effect.setLocalScale(0.2, 0.2, 0.2);

  const mat = new pc.StandardMaterial();
  mat.emissive = new pc.Color(1, 0.8, 0);
  mat.emissiveIntensity = 3;
  mat.opacity = 1;
  mat.blendType = pc.BLEND_NORMAL;
  mat.update();

  effect.render!.meshInstances.forEach(mi => mi.material = mat);
  app.root.addChild(effect);

  // Quick fade
  setTimeout(() => effect.destroy(), 100);
}

// ============================================
// ANIMATION LIBRARY PRO - External Animation Loading
// ============================================

// Cache for Animation Library clips
let animationLibraryCache: Map<string, pc.AnimTrack> | null = null;
let animationLibraryLoading: Promise<Map<string, pc.AnimTrack>> | null = null;

/**
 * Load Animation Library Pro and cache all clips
 * This library contains 127 animation clips (Walk_Loop, Idle_Loop, etc.)
 */
export async function loadAnimationLibrary(app: pc.Application): Promise<Map<string, pc.AnimTrack>> {
  // Return cached if available
  if (animationLibraryCache) {
    return animationLibraryCache;
  }

  // Wait if already loading
  if (animationLibraryLoading) {
    return animationLibraryLoading;
  }

  // Start loading
  animationLibraryLoading = (async () => {
    // Supply a library with verified redistribution terms. Built-in model
    // animations continue to work without this optional external library.
    const ANIMATION_LIBRARY_URL = import.meta.env.VITE_ANIMATION_LIBRARY_URL?.trim();
    if (!ANIMATION_LIBRARY_URL) return new Map<string, pc.AnimTrack>();

    debug.log('[AnimationLibrary] Loading Animation Library Pro...');

    const asset = new pc.Asset('animation_library', 'container', {
      url: ANIMATION_LIBRARY_URL
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Animation Library load timeout')), 60000);

      asset.on('load', () => {
        clearTimeout(timeout);
        resolve();
      });
      asset.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });

      app.assets.add(asset);
      app.assets.load(asset);
    });

    const container = asset.resource;
    if (!container || !container.animations) {
      throw new Error('Animation Library has no animations');
    }

    // Cache all animation clips by name
    const clips = new Map<string, pc.AnimTrack>();
    for (const anim of container.animations) {
      if (anim.name) {
        clips.set(anim.name, anim);
        // Also store without path prefix (e.g., "Walk_Loop" instead of "Armature|Walk_Loop")
        const shortName = anim.name.split('|').pop() || anim.name;
        if (shortName !== anim.name) {
          clips.set(shortName, anim);
        }
      }
    }

    debug.log('[AnimationLibrary] Loaded', clips.size, 'animation clips:', Array.from(clips.keys()).slice(0, 10), '...');
    animationLibraryCache = clips;
    return clips;
  })();

  return animationLibraryLoading;
}

/**
 * Apply an animation from Animation Library Pro to a character
 * This allows using Walk_Loop, Idle_Loop etc. on any humanoid character
 */
export async function applyAnimationToCharacter(
  app: pc.Application,
  character: LoadedCharacter,
  animationName: string,
  blendTime: number = 0.3
): Promise<boolean> {
  try {
    const library = await loadAnimationLibrary(app);
    const clip = library.get(animationName);

    if (!clip) {
      console.warn('[AnimationLibrary] Animation not found:', animationName);
      return false;
    }

    const modelEntity = character.entity.children[0] as any;
    if (!modelEntity) {
      console.warn('[AnimationLibrary] No model entity found');
      return false;
    }

    // Ensure animation component exists
    if (!modelEntity.animation) {
      modelEntity.addComponent('animation', {
        activate: true,
        speed: 1,
        loop: true
      });
    }

    // Create asset for the animation clip
    const animAsset = new pc.Asset(animationName + '_' + Date.now(), 'animation', { url: '' });
    animAsset.resource = clip;
    app.assets.add(animAsset);

    // Play the animation
    modelEntity.animation.play(clip.name, blendTime);
    debug.log('[AnimationLibrary] Playing animation:', animationName);

    return true;
  } catch (err) {
    console.error('[AnimationLibrary] Failed to apply animation:', err);
    return false;
  }
}

/**
 * Get available animation names from the library
 */
export function getAvailableAnimations(): string[] {
  if (!animationLibraryCache) {
    return [];
  }
  return Array.from(animationLibraryCache.keys());
}

