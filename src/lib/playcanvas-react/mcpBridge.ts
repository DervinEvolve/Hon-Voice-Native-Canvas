/**
 * MCP Bridge - Connects PlayCanvasMCP tools to React components
 * 
 * Allows Hon to create React-based scenes through the existing MCP tool interface.
 * This bridges the imperative MCP calls with declarative React components.
 */

import type { 
  HonSceneConfig, 
  HonEntityConfig, 
  HonPlayerConfig,
  HonEnemyConfig,
  HonCollectibleConfig,
  HonEnvironmentConfig,
  HonSpawnerConfig 
} from './types';

// Scene state that gets converted to React components
let sceneState: HonSceneConfig = {
  name: 'Hon Scene',
  type: 'exploration',
  environment: { preset: 'space' },
  entities: [],
  spawners: [],
  objectives: []
};

// Listeners for state changes (React will subscribe)
const listeners: Set<(state: HonSceneConfig) => void> = new Set();

function notifyListeners() {
  listeners.forEach(listener => listener(sceneState));
}

/**
 * Subscribe to scene state changes
 */
export function subscribeToSceneState(listener: (state: HonSceneConfig) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Get current scene state
 */
export function getSceneState(): HonSceneConfig {
  return sceneState;
}

/**
 * Reset scene to empty
 */
export function resetScene(): void {
  sceneState = {
    name: 'Hon Scene',
    type: 'exploration',
    environment: { preset: 'space' },
    entities: [],
    spawners: [],
    objectives: []
  };
  notifyListeners();
}

/**
 * MCP Tool Handlers - These map MCP tool calls to scene state changes
 */

export function mcpCreateEntity(params: {
  name: string;
  type?: 'box' | 'sphere' | 'cylinder' | 'cone' | 'capsule' | 'plane';
  position?: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  scale?: { x: number; y: number; z: number };
  color?: string;
  physics?: boolean | 'static' | 'dynamic';
}): { success: boolean; entityId: string; message: string } {
  const entity: HonEntityConfig = {
    name: params.name,
    type: params.type || 'box',
    position: params.position 
      ? [params.position.x, params.position.y, params.position.z] 
      : [0, 0, 0],
    rotation: params.rotation 
      ? [params.rotation.x, params.rotation.y, params.rotation.z] 
      : [0, 0, 0],
    scale: params.scale 
      ? [params.scale.x, params.scale.y, params.scale.z] 
      : [1, 1, 1],
    color: params.color || '#888888',
    physics: params.physics
  };
  
  sceneState = {
    ...sceneState,
    entities: [...sceneState.entities, entity]
  };
  
  notifyListeners();
  
  return {
    success: true,
    entityId: params.name,
    message: `Created ${params.type || 'box'} entity "${params.name}"`
  };
}

export function mcpCreatePlayer(params: HonPlayerConfig): { success: boolean; message: string } {
  sceneState = {
    ...sceneState,
    player: {
      name: params.name || 'Player',
      type: params.type || 'capsule',
      position: params.position || [0, 1, 0],
      speed: params.speed || 10,
      jumpForce: params.jumpForce || 8,
      health: params.health || 100,
      color: params.color || '#00ff88',
      physics: params.physics ?? 'dynamic'
    }
  };
  
  notifyListeners();
  
  return {
    success: true,
    message: `Created player "${params.name || 'Player'}"`
  };
}

export function mcpCreateEnemy(params: HonEnemyConfig): { success: boolean; entityId: string; message: string } {
  const enemy: HonEnemyConfig = {
    name: params.name || `Enemy_${Date.now()}`,
    type: params.type || 'box',
    position: params.position || [0, 1, -10],
    color: params.color || '#ff0044',
    behavior: params.behavior || 'chase',
    speed: params.speed || 5,
    health: params.health || 50,
    damage: params.damage || 10,
    range: params.range || 15,
    physics: params.physics ?? 'dynamic'
  };
  
  sceneState = {
    ...sceneState,
    entities: [...sceneState.entities, enemy]
  };
  
  notifyListeners();
  
  return {
    success: true,
    entityId: enemy.name!,
    message: `Created enemy "${enemy.name}" with ${params.behavior || 'chase'} behavior`
  };
}

export function mcpCreateCollectible(params: HonCollectibleConfig): { success: boolean; entityId: string; message: string } {
  const collectible: HonCollectibleConfig = {
    name: params.name || `Collectible_${Date.now()}`,
    type: params.type || 'sphere',
    position: params.position || [0, 1, 0],
    scale: params.scale || [0.5, 0.5, 0.5],
    color: params.color || '#ffff00',
    value: params.value || 10,
    effect: params.effect || 'score',
    respawn: params.respawn ?? true,
    floatAnimation: params.floatAnimation ?? true,
    rotateAnimation: params.rotateAnimation ?? true
  };
  
  sceneState = {
    ...sceneState,
    entities: [...sceneState.entities, collectible]
  };
  
  notifyListeners();
  
  return {
    success: true,
    entityId: collectible.name!,
    message: `Created ${params.effect || 'score'} collectible worth ${params.value || 10}`
  };
}

export function mcpCreateSpawner(params: HonSpawnerConfig & { position?: [number, number, number] }): { success: boolean; message: string } {
  const spawner: HonSpawnerConfig = {
    entityType: params.entityType,
    entityConfig: params.entityConfig,
    rate: params.rate || 1,
    maxCount: params.maxCount || 10,
    spawnRadius: params.spawnRadius || 5,
    initialDelay: params.initialDelay || 0
  };
  
  sceneState = {
    ...sceneState,
    spawners: [...(sceneState.spawners || []), spawner]
  };
  
  notifyListeners();
  
  return {
    success: true,
    message: `Created ${params.entityType} spawner (${params.rate || 1}/sec, max ${params.maxCount || 10})`
  };
}

export function mcpSetEnvironment(params: HonEnvironmentConfig): { success: boolean; message: string } {
  sceneState = {
    ...sceneState,
    environment: {
      ...sceneState.environment,
      ...params
    }
  };
  
  notifyListeners();
  
  return {
    success: true,
    message: `Set environment to ${params.preset || 'custom'}`
  };
}

export function mcpDeleteEntity(name: string): { success: boolean; message: string } {
  const hadEntity = sceneState.entities.some(e => e.name === name);
  
  sceneState = {
    ...sceneState,
    entities: sceneState.entities.filter(e => e.name !== name)
  };
  
  if (sceneState.player?.name === name) {
    delete sceneState.player;
  }
  
  notifyListeners();
  
  return {
    success: hadEntity,
    message: hadEntity ? `Deleted entity "${name}"` : `Entity "${name}" not found`
  };
}

export function mcpMoveEntity(name: string, position: { x: number; y: number; z: number }): { success: boolean; message: string } {
  let found = false;
  
  sceneState = {
    ...sceneState,
    entities: sceneState.entities.map(e => {
      if (e.name === name) {
        found = true;
        return { ...e, position: [position.x, position.y, position.z] as [number, number, number] };
      }
      return e;
    })
  };
  
  if (sceneState.player?.name === name) {
    found = true;
    sceneState.player = {
      ...sceneState.player,
      position: [position.x, position.y, position.z]
    };
  }
  
  notifyListeners();
  
  return {
    success: found,
    message: found ? `Moved "${name}" to (${position.x}, ${position.y}, ${position.z})` : `Entity "${name}" not found`
  };
}

/**
 * Load a scene template
 */
export function mcpLoadTemplate(template: 'space-shooter' | 'platformer' | 'exploration', options?: any): { success: boolean; message: string } {
  // Templates are handled by the React component layer
  // This just signals which template to use
  sceneState = {
    name: `${template} Scene`,
    type: template === 'exploration' ? 'exploration' : 'game',
    environment: { 
      preset: template === 'space-shooter' ? 'space' : 
              template === 'platformer' ? 'forest' : 'forest' 
    },
    entities: [],
    spawners: [],
    objectives: []
  };
  
  // Mark which template to load
  (sceneState as any)._template = template;
  (sceneState as any)._templateOptions = options;
  
  notifyListeners();
  
  return {
    success: true,
    message: `Loading ${template} template`
  };
}

