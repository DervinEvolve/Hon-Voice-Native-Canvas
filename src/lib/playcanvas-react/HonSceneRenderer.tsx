/**
 * HonSceneRenderer - Renders a Hon scene from config state
 * 
 * This component takes a HonSceneConfig and renders it using PlayCanvas React.
 * Used by WorldImmersiveCanvas to render AI-generated scenes.
 */

import React, { useEffect, useState } from 'react';
import { Application, Entity } from '@playcanvas/react';
import { Camera, Render, Light, Collision, RigidBody } from '@playcanvas/react/components';

import { HonPlayer } from './components/HonPlayer';
import { HonEnemy } from './components/HonEnemy';
import { HonCollectible } from './components/HonCollectible';
import { HonEnvironment } from './components/HonEnvironment';
import { HonSpawner } from './components/HonSpawner';
import { HonTrigger } from './components/HonTrigger';

import { SpaceShooterScene } from './templates/SpaceShooterScene';
import { PlatformerScene } from './templates/PlatformerScene';
import { ExplorationScene } from './templates/ExplorationScene';

import { subscribeToSceneState, getSceneState } from './mcpBridge';
import type { HonSceneConfig, HonEntityConfig, HonEnemyConfig, HonCollectibleConfig } from './types';

interface HonSceneRendererProps {
  initialConfig?: HonSceneConfig;
  onReady?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Determine entity type and render appropriate component
 */
function renderEntity(entity: HonEntityConfig, index: number): React.ReactNode {
  // Check if it's an enemy config
  if ('behavior' in entity || 'damage' in entity) {
    const enemyConfig = entity as HonEnemyConfig;
    return (
      <HonEnemy
        key={`entity-${entity.name}-${index}`}
        {...enemyConfig}
      />
    );
  }
  
  // Check if it's a collectible config
  if ('value' in entity || 'effect' in entity || 'respawn' in entity) {
    const collectibleConfig = entity as HonCollectibleConfig;
    return (
      <HonCollectible
        key={`entity-${entity.name}-${index}`}
        {...collectibleConfig}
      />
    );
  }
  
  // Default: render as basic entity
  return (
    <Entity
      key={`entity-${entity.name}-${index}`}
      name={entity.name}
      position={entity.position}
      rotation={entity.rotation}
      scale={entity.scale}
    >
      <Render type={entity.type || 'box'} />
      {entity.physics && (
        <>
          <Collision type={entity.type || 'box'} />
          <RigidBody 
            type={entity.physics === true ? 'dynamic' : entity.physics} 
          />
        </>
      )}
    </Entity>
  );
}

export const HonSceneRenderer: React.FC<HonSceneRendererProps> = ({
  initialConfig,
  onReady,
  onError
}) => {
  const [config, setConfig] = useState<HonSceneConfig>(
    initialConfig || getSceneState()
  );
  
  // Subscribe to MCP bridge state changes
  useEffect(() => {
    const unsubscribe = subscribeToSceneState((newState) => {
      setConfig(newState);
    });
    
    return unsubscribe;
  }, []);
  
  // Check for template
  const template = (config as any)._template;
  const templateOptions = (config as any)._templateOptions;
  
  // Render template if specified
  if (template) {
    switch (template) {
      case 'space-shooter':
        return <SpaceShooterScene {...templateOptions} />;
      case 'platformer':
        return <PlatformerScene {...templateOptions} />;
      case 'exploration':
        return <ExplorationScene {...templateOptions} />;
    }
  }
  
  // Render custom scene from config
  return (
    <>
      {/* Environment */}
      <HonEnvironment {...config.environment} />
      
      {/* Main Camera */}
      <Entity 
        name="MainCamera" 
        position={[0, 10, 20]} 
        rotation={[-20, 0, 0]}
      >
        <Camera clearColor={config.environment.skyColor || '#000011'} />
      </Entity>
      
      {/* Ground plane */}
      <Entity name="Ground" position={[0, -0.5, 0]} scale={[100, 1, 100]}>
        <Render type="box" />
        <Collision type="box" />
        <RigidBody type="static" />
      </Entity>
      
      {/* Player */}
      {config.player && (
        <HonPlayer {...config.player} />
      )}
      
      {/* Entities */}
      {config.entities.map((entity, index) => renderEntity(entity, index))}
      
      {/* Spawners */}
      {config.spawners?.map((spawner, index) => (
        <HonSpawner
          key={`spawner-${index}`}
          {...spawner}
        />
      ))}
    </>
  );
};

/**
 * Standalone application wrapper for testing/preview
 */
export const HonSceneApplication: React.FC<HonSceneRendererProps> = (props) => {
  return (
    <Application>
      <HonSceneRenderer {...props} />
    </Application>
  );
};

export default HonSceneRenderer;

