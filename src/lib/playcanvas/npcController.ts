/**
 * NPC Controller - Wandering NPCs with animations
 *
 * Creates NPCs that:
 * - Walk around the scene with proper animations
 * - Stay on the ground (raycast-based ground detection)
 * - Change direction periodically
 * - Avoid walking off edges or through walls
 */

import * as pc from 'playcanvas';
import { loadAnimatedCharacter, LoadedCharacter, loadAnimationLibrary, applyAnimationToCharacter } from './animatedCharacterController';
import { CharacterDefinition, getCharacter, NPCBehavior } from './characterLibrary';
import { debug } from '../../utils/debug';

export interface NPCInstance {
  entity: pc.Entity;
  character: LoadedCharacter;
  config: NPCControllerConfig;
  state: NPCState;
  cleanup: () => void;
}

export interface NPCControllerConfig {
  characterId: string;
  position: { x: number; y: number; z: number };
  behavior: NPCBehavior;
  wanderRadius?: number;      // How far from spawn point NPC will wander
  walkSpeed?: number;         // Movement speed
  idleTime?: number;          // How long to idle between walks (seconds)
  walkTime?: number;          // How long to walk before changing direction (seconds)
  patrolPath?: { x: number; y: number; z: number }[];  // Waypoints for patrol behavior
  loopPath?: boolean;         // Whether to loop back to start or reverse direction
  scale?: number;             // Scale multiplier for NPC (default: 1.0, use 0.01 for city_block)
}

interface NPCState {
  isWalking: boolean;
  currentDirection: pc.Vec3;
  spawnPoint: pc.Vec3;
  targetPoint: pc.Vec3 | null;
  stateTimer: number;
  groundY: number;
  // Patrol path state
  currentWaypointIndex: number;
  patrolDirection: 1 | -1;  // 1 = forward through path, -1 = backward
}

const DEFAULT_CONFIG = {
  wanderRadius: 15,
  walkSpeed: 2,
  idleTime: 3,
  walkTime: 5,
};

/**
 * Spawn a wandering NPC in the scene
 */
export async function spawnWanderingNPC(
  app: pc.Application,
  config: NPCControllerConfig
): Promise<NPCInstance | null> {
  debug.log('[NPC] Spawning NPC:', config.characterId, 'at', config.position);

  // Load the character
  const character = await loadAnimatedCharacter(app, {
    characterId: config.characterId,
    position: config.position,
    isPlayer: false,
  });

  if (!character) {
    console.error('[NPC] Failed to load character:', config.characterId);
    return null;
  }

  // Apply scale if specified (for matching scene scale like city_block at 0.01)
  if (config.scale && config.scale !== 1.0) {
    const currentScale = character.entity.getLocalScale();
    character.entity.setLocalScale(
      currentScale.x * config.scale,
      currentScale.y * config.scale,
      currentScale.z * config.scale
    );
    debug.log('[NPC] Applied scale:', config.scale);
  }

  // Tag as NPC
  character.entity.tags.add('npc');

  // Initialize state
  const state: NPCState = {
    isWalking: false,
    currentDirection: new pc.Vec3(0, 0, 1),
    spawnPoint: new pc.Vec3(config.position.x, config.position.y, config.position.z),
    targetPoint: null,
    stateTimer: 0,
    groundY: config.position.y,
    currentWaypointIndex: 0,
    patrolDirection: 1,
  };

  // Merge config with defaults
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  // Load Animation Library and apply Walk_Loop animation
  try {
    debug.log('[NPC] Loading Animation Library for', config.characterId);
    await loadAnimationLibrary(app);
    // Try to apply Walk_Loop from Animation Library
    const walkApplied = await applyAnimationToCharacter(app, character, 'Walk_Loop', 0.3);
    if (walkApplied) {
      debug.log('[NPC] Walk_Loop animation applied from Animation Library');
    } else {
      // Fallback to character's built-in idle animation
      debug.log('[NPC] Using character built-in animation');
      character.playAnimation('idle', 0.3);
    }
  } catch (err) {
    console.warn('[NPC] Animation Library not available, using built-in:', err);
    character.playAnimation('idle', 0.3);
  }

  // Create the update function
  const update = (dt: number) => {
    updateNPC(app, character, fullConfig, state, dt);
  };

  // Mark entity so startPedestrians in components.ts won't add duplicate handler
  (character.entity as any)._pedestrianScript = update;

  // Register update
  app.on('update', update);

  // Cleanup function
  const cleanup = () => {
    app.off('update', update);
    delete (character.entity as any)._pedestrianScript;
    if (character.entity.parent) {
      character.entity.destroy();
    }
  };

  debug.log('[NPC] NPC spawned successfully:', config.characterId);

  return {
    entity: character.entity,
    character,
    config: fullConfig,
    state,
    cleanup,
  };
}

/**
 * Try to play an animation with fallback names
 * Now uses Animation Library Pro clips if available
 */
async function playAnimationWithFallbackAsync(
  app: pc.Application,
  character: LoadedCharacter,
  animType: 'walk' | 'idle' | 'run',
  blendTime: number = 0.3
): Promise<void> {
  // Animation Library Pro clip names
  const libraryClips: Record<string, string> = {
    'walk': 'Walk_Loop',
    'idle': 'Idle_Loop',
    'run': 'Jog_Fwd_Loop',
  };

  // Try Animation Library first
  const libraryClipName = libraryClips[animType];
  if (libraryClipName) {
    const applied = await applyAnimationToCharacter(app, character, libraryClipName, blendTime);
    if (applied) {
      debug.log('[NPC] Playing', animType, 'from Animation Library');
      return;
    }
  }

  // Fallback to built-in animations
  playAnimationWithFallback(character, animType, blendTime);
}

/**
 * Sync version - try to play built-in animation with fallback names
 */
function playAnimationWithFallback(
  character: LoadedCharacter,
  animType: 'walk' | 'idle' | 'run',
  blendTime: number = 0.3
): void {
  // Animation name variations to try
  const animVariations: Record<string, string[]> = {
    'walk': ['walk', 'Walk', 'Walk_Loop', 'walk_loop', 'Walking', 'walking', 'animation/0', 'animation'],
    'idle': ['idle', 'Idle', 'Idle_Loop', 'idle_loop', 'Standing', 'standing', 'animation/0', 'animation'],
    'run': ['run', 'Run', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Running', 'running', 'animation/0'],
  };

  const variations = animVariations[animType] || [animType];
  const modelEntity = character.entity.children[0] as any;

  // Try each variation through character.playAnimation
  for (const animName of variations) {
    try {
      character.playAnimation(animName, blendTime);
      return; // Success!
    } catch (e) {
      // Try next variation
    }
  }

  // Try directly through animation component (simpler API)
  if (modelEntity?.animation) {
    // Get all available animation clips
    const clips = modelEntity._animClips || [];
    if (clips.length > 0) {
      try {
        // Play the first available clip
        const clipName = clips[0].name;
        modelEntity.animation.play(clipName, blendTime);
        debug.log('[NPC] Playing fallback animation:', clipName);
        return;
      } catch (e) {
        console.warn('[NPC] animation.play failed:', e);
      }
    }
  }

  // Last resort: try anim component with state graph
  if (modelEntity?.anim?.baseLayer) {
    for (const animName of variations) {
      try {
        modelEntity.anim.baseLayer.transition(animName, blendTime);
        return;
      } catch (e) {
        // Try next
      }
    }
  }

  console.warn(`[NPC] Could not play ${animType} animation - no matching clips found`);
}

/**
 * Update NPC behavior each frame
 */
function updateNPC(
  app: pc.Application,
  character: LoadedCharacter,
  config: NPCControllerConfig,
  state: NPCState,
  dt: number
): void {
  const entity = character.entity;
  const pos = entity.getPosition().clone();

  // Ground detection - raycast down to find floor
  const groundY = findGroundLevel(app, pos);
  if (groundY !== null) {
    state.groundY = groundY;
  }

  // Keep NPC on ground
  if (pos.y !== state.groundY) {
    pos.y = state.groundY;
    entity.setPosition(pos);
  }

  // Update state timer
  state.stateTimer -= dt;

  // Use patrol path if provided, otherwise wander
  const hasPatrolPath = config.patrolPath && config.patrolPath.length > 1;

  if (state.isWalking) {
    // Walking behavior
    if (hasPatrolPath) {
      // Patrol path movement - check if reached waypoint
      const reachedWaypoint = moveTowardsWaypoint(app, entity, state, config, dt);
      if (reachedWaypoint) {
        // Brief pause at waypoint
        state.isWalking = false;
        state.stateTimer = 0.5 + Math.random() * 1.5; // Short pause at waypoints
        playAnimationWithFallback(character, 'idle', 0.3);
      }
    } else {
      // Random wandering
      if (state.stateTimer <= 0) {
        state.isWalking = false;
        state.stateTimer = config.idleTime! + Math.random() * 2;
        playAnimationWithFallback(character, 'idle', 0.3);
      } else {
        moveNPC(app, entity, state, config, dt);
      }
    }
  } else {
    // Idle behavior
    if (state.stateTimer <= 0) {
      state.isWalking = true;

      if (hasPatrolPath) {
        // Move to next waypoint
        advanceToNextWaypoint(state, config);
        state.stateTimer = 30; // Long timeout, will reach waypoint before this
      } else {
        state.stateTimer = config.walkTime! + Math.random() * 3;
        pickNewDirection(state, config);
      }

      playAnimationWithFallback(character, 'walk', 0.3);
    }
  }
}

/**
 * Move NPC towards current waypoint, returns true if reached
 */
function moveTowardsWaypoint(
  app: pc.Application,
  entity: pc.Entity,
  state: NPCState,
  config: NPCControllerConfig,
  dt: number
): boolean {
  if (!config.patrolPath || config.patrolPath.length === 0) return false;

  const waypoint = config.patrolPath[state.currentWaypointIndex];
  const pos = entity.getPosition().clone();
  const speed = config.walkSpeed || DEFAULT_CONFIG.walkSpeed;

  // Calculate direction to waypoint
  const toWaypoint = new pc.Vec3(
    waypoint.x - pos.x,
    0,
    waypoint.z - pos.z
  );

  const distance = toWaypoint.length();

  // Check if reached waypoint
  if (distance < 0.5) {
    return true;
  }

  // Move towards waypoint
  toWaypoint.normalize();
  state.currentDirection = toWaypoint;

  pos.add(toWaypoint.clone().mulScalar(speed * dt));
  pos.y = state.groundY;
  entity.setPosition(pos);

  // Rotate to face movement direction
  const targetAngle = Math.atan2(toWaypoint.x, toWaypoint.z) * (180 / Math.PI);
  const currentAngles = entity.getEulerAngles();

  let angleDiff = targetAngle - currentAngles.y;
  while (angleDiff > 180) angleDiff -= 360;
  while (angleDiff < -180) angleDiff += 360;

  const rotSpeed = 5;
  currentAngles.y += angleDiff * Math.min(1, rotSpeed * dt);
  entity.setEulerAngles(currentAngles);

  return false;
}

/**
 * Advance to the next waypoint in the patrol path
 */
function advanceToNextWaypoint(state: NPCState, config: NPCControllerConfig): void {
  if (!config.patrolPath || config.patrolPath.length === 0) return;

  const pathLength = config.patrolPath.length;

  if (config.loopPath) {
    // Loop back to start
    state.currentWaypointIndex = (state.currentWaypointIndex + 1) % pathLength;
  } else {
    // Ping-pong: reverse direction at ends
    state.currentWaypointIndex += state.patrolDirection;

    if (state.currentWaypointIndex >= pathLength) {
      state.currentWaypointIndex = pathLength - 2;
      state.patrolDirection = -1;
    } else if (state.currentWaypointIndex < 0) {
      state.currentWaypointIndex = 1;
      state.patrolDirection = 1;
    }
  }
}

/**
 * Find ground level at position using raycast
 */
function findGroundLevel(app: pc.Application, pos: pc.Vec3): number | null {
  // Try physics raycast first
  if (app.systems.rigidbody) {
    try {
      const rayStart = new pc.Vec3(pos.x, pos.y + 2, pos.z);
      const rayEnd = new pc.Vec3(pos.x, pos.y - 50, pos.z);
      const result = app.systems.rigidbody.raycastFirst(rayStart, rayEnd);

      if (result) {
        return result.point.y;
      }
    } catch (e) {
      // Physics not ready
    }
  }

  // Fallback: assume ground is at Y=0
  return 0;
}

/**
 * Pick a new random direction to walk
 */
function pickNewDirection(state: NPCState, config: NPCControllerConfig): void {
  const wanderRadius = config.wanderRadius || DEFAULT_CONFIG.wanderRadius;

  // Random angle
  const angle = Math.random() * Math.PI * 2;

  // Random distance within wander radius
  const distance = (Math.random() * 0.5 + 0.5) * wanderRadius;

  // Calculate target point relative to spawn
  const targetX = state.spawnPoint.x + Math.cos(angle) * distance;
  const targetZ = state.spawnPoint.z + Math.sin(angle) * distance;

  state.targetPoint = new pc.Vec3(targetX, state.groundY, targetZ);

  // Calculate direction to target
  state.currentDirection = state.targetPoint.clone().sub(
    new pc.Vec3(state.spawnPoint.x, state.groundY, state.spawnPoint.z)
  ).normalize();
}

/**
 * Move NPC towards target
 */
function moveNPC(
  app: pc.Application,
  entity: pc.Entity,
  state: NPCState,
  config: NPCControllerConfig,
  dt: number
): void {
  const pos = entity.getPosition().clone();
  const speed = config.walkSpeed || DEFAULT_CONFIG.walkSpeed;

  // Calculate direction to target
  if (state.targetPoint) {
    const toTarget = state.targetPoint.clone().sub(pos);
    toTarget.y = 0; // Keep movement horizontal

    const distanceToTarget = toTarget.length();

    if (distanceToTarget < 1) {
      // Reached target, pick new direction
      pickNewDirection(state, config);
      return;
    }

    toTarget.normalize();
    state.currentDirection = toTarget;
  }

  // Check if next position is valid (has ground)
  const nextPos = pos.clone().add(state.currentDirection.clone().mulScalar(speed * dt));
  const nextGroundY = findGroundLevel(app, nextPos);

  // If no ground ahead or too steep, turn around
  if (nextGroundY === null || Math.abs(nextGroundY - state.groundY) > 2) {
    // Reverse direction
    state.currentDirection.mulScalar(-1);
    pickNewDirection(state, config);
    return;
  }

  // Move forward
  pos.add(state.currentDirection.clone().mulScalar(speed * dt));
  pos.y = state.groundY;
  entity.setPosition(pos);

  // Rotate to face movement direction
  if (state.currentDirection.lengthSq() > 0.001) {
    const targetAngle = Math.atan2(state.currentDirection.x, state.currentDirection.z) * (180 / Math.PI);
    const currentAngles = entity.getEulerAngles();

    // Smooth rotation
    let angleDiff = targetAngle - currentAngles.y;
    while (angleDiff > 180) angleDiff -= 360;
    while (angleDiff < -180) angleDiff += 360;

    const rotSpeed = 5;
    currentAngles.y += angleDiff * Math.min(1, rotSpeed * dt);
    entity.setEulerAngles(currentAngles);
  }
}

/**
 * Spawn multiple NPCs in a scene
 */
export async function spawnNPCGroup(
  app: pc.Application,
  configs: NPCControllerConfig[]
): Promise<NPCInstance[]> {
  const npcs: NPCInstance[] = [];

  for (const config of configs) {
    const npc = await spawnWanderingNPC(app, config);
    if (npc) {
      npcs.push(npc);
    }
  }

  debug.log(`[NPC] Spawned ${npcs.length} NPCs`);
  return npcs;
}

/**
 * Predefined sidewalk patrol paths for city_block environment
 *
 * ADJUSTING PATHS:
 * 1. Load city_block in your app and enable debug mode
 * 2. Use browser console to check NPC positions: app.root.findByTag('npc')[0].getPosition()
 * 3. Walk around and note coordinates of sidewalk edges
 * 4. Update the coordinates below to match your scene
 *
 * COORDINATE SYSTEM:
 * - X: East (+) / West (-)
 * - Y: Up (always 0 for ground level, raycast will adjust)
 * - Z: North (+) / South (-)
 *
 * PATH STRUCTURE:
 * Each path is an array of waypoints. NPCs walk from point to point.
 * Add more waypoints for curved or complex paths.
 */
/**
 * city_block layout (from screenshot analysis):
 * - Grid of building blocks with streets between
 * - Streets have yellow lane markings (dark gray)
 * - Sidewalks are light gray, along building edges
 * - Scale: 0.01 (modeled in cm, displayed in meters)
 * - Approximate size: ~80m x 80m
 *
 * Coordinates adjusted based on actual scene layout.
 * The scene appears centered around origin with buildings in quadrants.
 */
export const CITY_BLOCK_SIDEWALK_PATHS: Record<string, { x: number; y: number; z: number }[]> = {
  // ========== MAIN STREET SIDEWALKS ==========
  // These run along the major streets visible in the scene

  // Main east-west street - north sidewalk (near center)
  main_street_north: [
    { x: -30, y: 0, z: 8 },
    { x: -15, y: 0, z: 8 },
    { x: 0, y: 0, z: 8 },
    { x: 15, y: 0, z: 8 },
    { x: 30, y: 0, z: 8 },
  ],

  // Main east-west street - south sidewalk
  main_street_south: [
    { x: -30, y: 0, z: -8 },
    { x: -15, y: 0, z: -8 },
    { x: 0, y: 0, z: -8 },
    { x: 15, y: 0, z: -8 },
    { x: 30, y: 0, z: -8 },
  ],

  // Main north-south street - east sidewalk
  cross_street_east: [
    { x: 8, y: 0, z: -30 },
    { x: 8, y: 0, z: -15 },
    { x: 8, y: 0, z: 0 },
    { x: 8, y: 0, z: 15 },
    { x: 8, y: 0, z: 30 },
  ],

  // Main north-south street - west sidewalk
  cross_street_west: [
    { x: -8, y: 0, z: -30 },
    { x: -8, y: 0, z: -15 },
    { x: -8, y: 0, z: 0 },
    { x: -8, y: 0, z: 15 },
    { x: -8, y: 0, z: 30 },
  ],

  // ========== OUTER PERIMETER (edge of map) ==========

  sidewalk_outer_north: [
    { x: -35, y: 0, z: 35 },
    { x: 0, y: 0, z: 35 },
    { x: 35, y: 0, z: 35 },
  ],

  sidewalk_outer_south: [
    { x: -35, y: 0, z: -35 },
    { x: 0, y: 0, z: -35 },
    { x: 35, y: 0, z: -35 },
  ],

  sidewalk_outer_east: [
    { x: 35, y: 0, z: -35 },
    { x: 35, y: 0, z: 0 },
    { x: 35, y: 0, z: 35 },
  ],

  sidewalk_outer_west: [
    { x: -35, y: 0, z: -35 },
    { x: -35, y: 0, z: 0 },
    { x: -35, y: 0, z: 35 },
  ],

  // ========== INTERSECTION AREA (center of scene) ==========
  // NPCs can walk around the central intersection

  intersection_loop: [
    { x: -6, y: 0, z: 6 },
    { x: 6, y: 0, z: 6 },
    { x: 6, y: 0, z: -6 },
    { x: -6, y: 0, z: -6 },
  ],

  // ========== BUILDING PERIMETERS (around building clusters) ==========

  // Northeast quadrant buildings
  buildings_ne: [
    { x: 12, y: 0, z: 12 },
    { x: 28, y: 0, z: 12 },
    { x: 28, y: 0, z: 28 },
    { x: 12, y: 0, z: 28 },
  ],

  // Northwest quadrant buildings
  buildings_nw: [
    { x: -12, y: 0, z: 12 },
    { x: -28, y: 0, z: 12 },
    { x: -28, y: 0, z: 28 },
    { x: -12, y: 0, z: 28 },
  ],

  // Southeast quadrant buildings
  buildings_se: [
    { x: 12, y: 0, z: -12 },
    { x: 28, y: 0, z: -12 },
    { x: 28, y: 0, z: -28 },
    { x: 12, y: 0, z: -28 },
  ],

  // Southwest quadrant buildings
  buildings_sw: [
    { x: -12, y: 0, z: -12 },
    { x: -28, y: 0, z: -12 },
    { x: -28, y: 0, z: -28 },
    { x: -12, y: 0, z: -28 },
  ],
};

/**
 * Create default NPC configs for a city scene with sidewalk patrol paths
 */
export function createCityNPCConfigs(centerX: number = 0, centerZ: number = 0, count: number = 5): NPCControllerConfig[] {
  // Civilian-style characters for city scenes
  // Note: 'driver' removed - GLB file missing from storage
  // Note: dancer excluded - only has idle/dance animations, no walk
  const characterIds = ['security_guard', 'boy', 'girl', 'cyberpunk', 'robot_local', 'elf'];
  const configs: NPCControllerConfig[] = [];

  // Available paths - prioritize sidewalks and building perimeters for realistic city walking
  const pathKeys = [
    'main_street_north',
    'main_street_south',
    'cross_street_east',
    'cross_street_west',
    'intersection_loop',
    'buildings_ne',
    'buildings_nw',
    'buildings_se',
    'buildings_sw',
    'sidewalk_outer_north',
    'sidewalk_outer_south',
  ];

  // Paths that should loop (building perimeters and intersection)
  const loopingPaths = ['buildings_ne', 'buildings_nw', 'buildings_se', 'buildings_sw', 'intersection_loop'];

  for (let i = 0; i < count; i++) {
    // Assign each NPC to a path
    const pathKey = pathKeys[i % pathKeys.length];
    const path = CITY_BLOCK_SIDEWALK_PATHS[pathKey];

    if (!path || path.length === 0) continue;

    // Start at a random point along the path
    const startWaypointIndex = Math.floor(Math.random() * path.length);
    const startPoint = path[startWaypointIndex];

    // Offset the path by center position
    const offsetPath = path.map(p => ({
      x: p.x + centerX,
      y: p.y,
      z: p.z + centerZ,
    }));

    configs.push({
      characterId: characterIds[i % characterIds.length],
      position: {
        x: startPoint.x + centerX,
        y: 0,
        z: startPoint.z + centerZ,
      },
      behavior: 'patrol',
      patrolPath: offsetPath,
      loopPath: loopingPaths.includes(pathKey),
      walkSpeed: 0.015 + Math.random() * 0.005, // Scaled for 0.01 scene (1.5-2.0 m/s in real scale)
      idleTime: 1 + Math.random() * 2,
      walkTime: 10,
      scale: 0.01, // city_block is modeled in cm, needs 0.01 scale
    });
  }

  return configs;
}

/**
 * Get all available path names for debugging/configuration
 */
export function getAvailablePathNames(): string[] {
  return Object.keys(CITY_BLOCK_SIDEWALK_PATHS);
}

/**
 * Create a single NPC on a specific path
 */
export function createNPCOnPath(
  characterId: string,
  pathName: string,
  centerX: number = 0,
  centerZ: number = 0
): NPCControllerConfig | null {
  const path = CITY_BLOCK_SIDEWALK_PATHS[pathName];
  if (!path || path.length === 0) {
    console.warn(`[NPC] Path not found: ${pathName}`);
    return null;
  }

  const startPoint = path[0];
  const offsetPath = path.map(p => ({
    x: p.x + centerX,
    y: p.y,
    z: p.z + centerZ,
  }));

  const loopingPaths = ['block_ne', 'block_nw', 'block_se', 'block_sw'];

  return {
    characterId,
    position: {
      x: startPoint.x + centerX,
      y: 0,
      z: startPoint.z + centerZ,
    },
    behavior: 'patrol',
    patrolPath: offsetPath,
    loopPath: loopingPaths.includes(pathName),
    walkSpeed: 1.2 + Math.random() * 0.6,
    idleTime: 1 + Math.random() * 2,
    walkTime: 10,
  };
}

/**
 * Cleanup all NPCs
 */
export function cleanupAllNPCs(npcs: NPCInstance[]): void {
  npcs.forEach(npc => npc.cleanup());
  debug.log('[NPC] All NPCs cleaned up');
}
