/**
 * Hon PlayCanvas React Component Library
 * 
 * Unified components for procedural scene building in immersive mode.
 * Hon can compose these to create games and interactive experiences.
 */

// Re-export core PlayCanvas React components
export { Application, Entity } from '@playcanvas/react';
export { Camera, Render, Light, Collision, RigidBody } from '@playcanvas/react/components';

// Hon-specific components
export { HonPlayer } from './components/HonPlayer';
export { HonEnemy } from './components/HonEnemy';
export { HonCollectible } from './components/HonCollectible';
export { HonProjectile } from './components/HonProjectile';
export { HonEnvironment } from './components/HonEnvironment';
export { HonSpawner } from './components/HonSpawner';
export { HonTrigger } from './components/HonTrigger';

// Scene templates
export { SpaceShooterScene } from './templates/SpaceShooterScene';
export { PlatformerScene } from './templates/PlatformerScene';
export { ExplorationScene } from './templates/ExplorationScene';

// Utilities
export { useHonScene } from './hooks/useHonScene';
export { useGameState } from './hooks/useGameState';

// Scene Renderer (for unified immersive mode)
export { HonSceneRenderer, HonSceneApplication } from './HonSceneRenderer';

// Scene State Bridge (internal use by WorldImmersiveCanvas)
export {
  subscribeToSceneState,
  getSceneState,
  resetScene
} from './mcpBridge';

// Types
export type { 
  HonSceneConfig, 
  HonEntityConfig, 
  HonGameState,
  HonPlayerConfig,
  HonEnemyConfig,
  HonCollectibleConfig,
  HonEnvironmentConfig,
  HonSpawnerConfig
} from './types';

