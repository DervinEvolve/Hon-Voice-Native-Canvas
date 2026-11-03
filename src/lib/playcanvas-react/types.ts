/**
 * Hon PlayCanvas Types
 */

export interface HonEntityConfig {
  name: string;
  type?: 'box' | 'sphere' | 'cylinder' | 'cone' | 'capsule' | 'plane';
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  color?: string;
  emissive?: string;
  emissiveIntensity?: number;
  metalness?: number;
  roughness?: number;
  physics?: boolean | 'static' | 'dynamic' | 'kinematic';
  tags?: string[];
}

export interface HonPlayerConfig extends HonEntityConfig {
  speed?: number;
  jumpForce?: number;
  health?: number;
  controls?: 'wasd' | 'arrows' | 'both';
  cameraFollow?: boolean;
  cameraDistance?: number;
}

export interface HonEnemyConfig extends HonEntityConfig {
  behavior?: 'chase' | 'patrol' | 'turret' | 'wander' | 'stationary';
  speed?: number;
  health?: number;
  damage?: number;
  range?: number;
  patrolPoints?: [number, number, number][];
}

export interface HonCollectibleConfig extends HonEntityConfig {
  value?: number;
  effect?: 'score' | 'health' | 'powerup' | 'key';
  respawn?: boolean;
  respawnDelay?: number;
  floatAnimation?: boolean;
  rotateAnimation?: boolean;
}

export interface HonSpawnerConfig {
  entityType: 'enemy' | 'collectible' | 'projectile';
  entityConfig: HonEntityConfig;
  rate?: number; // spawns per second
  maxCount?: number;
  spawnRadius?: number;
  initialDelay?: number;
}

export interface HonEnvironmentConfig {
  preset?: 'space' | 'forest' | 'dungeon' | 'city' | 'desert' | 'ocean' | 'void';
  skyColor?: string;
  fogEnabled?: boolean;
  fogColor?: string;
  fogDensity?: number;
  ambientColor?: string;
  ambientIntensity?: number;
  sunColor?: string;
  sunIntensity?: number;
  sunDirection?: [number, number, number];
}

export interface HonGameState {
  score: number;
  health: number;
  maxHealth: number;
  level: number;
  isPlaying: boolean;
  isPaused: boolean;
  isGameOver: boolean;
  isVictory: boolean;
  customData: Record<string, any>;
}

export interface HonSceneConfig {
  name: string;
  type: 'game' | 'exploration' | 'showcase';
  environment: HonEnvironmentConfig;
  player?: HonPlayerConfig;
  entities: HonEntityConfig[];
  spawners?: HonSpawnerConfig[];
  objectives?: {
    type: 'score' | 'survive' | 'collect' | 'reach';
    target: number | string;
  }[];
}

