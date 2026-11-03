/**
 * HonEnemy - Configurable enemy entity for Hon scenes
 * 
 * Supports behaviors: chase, patrol, turret, wander, stationary
 */

import React from 'react';
import { Entity } from '@playcanvas/react';
import { Render, Collision, RigidBody, Script } from '@playcanvas/react/components';
import type { HonEnemyConfig } from '../types';

// Enemy AI script
class EnemyAIScript {
  behavior: string;
  speed: number;
  range: number;
  patrolPoints: [number, number, number][];
  private patrolIndex: number = 0;
  private target: any = null;
  
  constructor(args: { 
    behavior?: string; 
    speed?: number; 
    range?: number;
    patrolPoints?: [number, number, number][];
  }) {
    this.behavior = args.behavior || 'chase';
    this.speed = args.speed || 5;
    this.range = args.range || 15;
    this.patrolPoints = args.patrolPoints || [];
  }
  
  initialize(app: any, entity: any) {
    // Find player entity
    this.target = app.root.findByName('Player');
  }
  
  update(dt: number, app: any, entity: any) {
    if (!this.target && this.behavior === 'chase') {
      this.target = app.root.findByName('Player');
      if (!this.target) return;
    }
    
    switch (this.behavior) {
      case 'chase':
        this.updateChase(dt, entity);
        break;
      case 'patrol':
        this.updatePatrol(dt, entity);
        break;
      case 'wander':
        this.updateWander(dt, entity);
        break;
      case 'turret':
        this.updateTurret(dt, entity);
        break;
    }
  }
  
  private updateChase(dt: number, entity: any) {
    if (!this.target) return;
    
    const pos = entity.getPosition();
    const targetPos = this.target.getPosition();
    const direction = targetPos.clone().sub(pos);
    const distance = direction.length();
    
    if (distance > 1 && distance < this.range) {
      direction.normalize();
      entity.translateLocal(
        direction.x * this.speed * dt,
        0,
        direction.z * this.speed * dt
      );
      entity.lookAt(targetPos);
    }
  }
  
  private updatePatrol(dt: number, entity: any) {
    if (this.patrolPoints.length === 0) return;
    
    const pos = entity.getPosition();
    const target = this.patrolPoints[this.patrolIndex];
    const targetVec = new pc.Vec3(target[0], target[1], target[2]);
    const direction = targetVec.clone().sub(pos);
    const distance = direction.length();
    
    if (distance < 0.5) {
      this.patrolIndex = (this.patrolIndex + 1) % this.patrolPoints.length;
    } else {
      direction.normalize();
      entity.translateLocal(
        direction.x * this.speed * dt,
        0,
        direction.z * this.speed * dt
      );
    }
  }
  
  private updateWander(dt: number, entity: any) {
    // Random direction changes
    if (Math.random() < 0.01) {
      entity.rotateLocal(0, (Math.random() - 0.5) * 90, 0);
    }
    entity.translateLocal(0, 0, -this.speed * dt);
  }
  
  private updateTurret(dt: number, entity: any) {
    if (!this.target) return;
    const targetPos = this.target.getPosition();
    entity.lookAt(targetPos);
  }
}

interface HonEnemyProps extends HonEnemyConfig {
  children?: React.ReactNode;
}

export const HonEnemy: React.FC<HonEnemyProps> = ({
  name = 'Enemy',
  type = 'box',
  position = [0, 1, -10],
  rotation = [0, 0, 0],
  scale = [1, 1, 1],
  color = '#ff0044',
  behavior = 'chase',
  speed = 5,
  health = 50,
  damage = 10,
  range = 15,
  patrolPoints = [],
  physics = 'dynamic',
  children
}) => {
  return (
    <Entity name={name} position={position} rotation={rotation} scale={scale}>
      <Render type={type} />
      {physics && (
        <>
          <Collision type={type} />
          <RigidBody 
            type={physics === true ? 'dynamic' : physics} 
            mass={1}
          />
        </>
      )}
      <Script 
        type={EnemyAIScript} 
        behavior={behavior}
        speed={speed}
        range={range}
        patrolPoints={patrolPoints}
      />
      {children}
    </Entity>
  );
};

export default HonEnemy;

