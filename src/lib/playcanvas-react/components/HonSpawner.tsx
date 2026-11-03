/**
 * HonSpawner - Entity spawner for enemies, collectibles, etc.
 */

import React from 'react';
import { Entity } from '@playcanvas/react';
import { Script } from '@playcanvas/react/components';
import type { HonSpawnerConfig, HonEntityConfig } from '../types';

// Spawner script
class SpawnerScript {
  entityType: string;
  entityConfig: HonEntityConfig;
  rate: number;
  maxCount: number;
  spawnRadius: number;
  initialDelay: number;
  private spawnTimer: number = 0;
  private spawnedEntities: any[] = [];
  private delayTimer: number = 0;
  
  constructor(args: HonSpawnerConfig) {
    this.entityType = args.entityType || 'enemy';
    this.entityConfig = args.entityConfig || { name: 'Spawned', type: 'box' };
    this.rate = args.rate || 1;
    this.maxCount = args.maxCount || 10;
    this.spawnRadius = args.spawnRadius || 5;
    this.initialDelay = args.initialDelay || 0;
    this.delayTimer = this.initialDelay;
  }
  
  update(dt: number, app: any, entity: any) {
    // Initial delay
    if (this.delayTimer > 0) {
      this.delayTimer -= dt;
      return;
    }
    
    // Clean up destroyed entities
    this.spawnedEntities = this.spawnedEntities.filter(e => e && !e.destroyed);
    
    // Check spawn timer
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.spawnedEntities.length < this.maxCount) {
      this.spawn(app, entity);
      this.spawnTimer = 1 / this.rate;
    }
  }
  
  private spawn(app: any, spawnerEntity: any) {
    const pc = (window as any).pc;
    if (!pc) return;
    
    const pos = spawnerEntity.getPosition();
    const offsetX = (Math.random() - 0.5) * 2 * this.spawnRadius;
    const offsetZ = (Math.random() - 0.5) * 2 * this.spawnRadius;
    
    // Create entity
    const entity = new pc.Entity(this.entityConfig.name || 'Spawned');
    
    // Add render component
    entity.addComponent('render', {
      type: this.entityConfig.type || 'box'
    });
    
    // Set position
    entity.setPosition(pos.x + offsetX, pos.y, pos.z + offsetZ);
    
    // Set scale
    if (this.entityConfig.scale) {
      entity.setLocalScale(
        this.entityConfig.scale[0],
        this.entityConfig.scale[1],
        this.entityConfig.scale[2]
      );
    }
    
    // Add to scene
    app.root.addChild(entity);
    this.spawnedEntities.push(entity);
    
    // Fire spawn event
    app.fire('hon:spawn', {
      entityType: this.entityType,
      entity: entity
    });
  }
}

interface HonSpawnerProps extends HonSpawnerConfig {
  position?: [number, number, number];
  children?: React.ReactNode;
}

export const HonSpawner: React.FC<HonSpawnerProps> = ({
  entityType = 'enemy',
  entityConfig = { name: 'Spawned', type: 'box' },
  rate = 1,
  maxCount = 10,
  spawnRadius = 5,
  initialDelay = 0,
  position = [0, 0, 0],
  children
}) => {
  return (
    <Entity name={`${entityType}Spawner`} position={position}>
      <Script 
        type={SpawnerScript}
        entityType={entityType}
        entityConfig={entityConfig}
        rate={rate}
        maxCount={maxCount}
        spawnRadius={spawnRadius}
        initialDelay={initialDelay}
      />
      {children}
    </Entity>
  );
};

export default HonSpawner;

