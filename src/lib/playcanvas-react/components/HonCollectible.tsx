/**
 * HonCollectible - Collectible items (coins, health, powerups)
 * 
 * Features floating and rotating animations, respawning.
 */

import React from 'react';
import { Entity } from '@playcanvas/react';
import { Render, Collision, Script } from '@playcanvas/react/components';
import type { HonCollectibleConfig } from '../types';

// Collectible behavior script
class CollectibleScript {
  value: number;
  effect: string;
  respawn: boolean;
  respawnDelay: number;
  floatAnimation: boolean;
  rotateAnimation: boolean;
  private baseY: number = 0;
  private time: number = 0;
  private collected: boolean = false;
  private respawnTimer: number = 0;
  
  constructor(args: {
    value?: number;
    effect?: string;
    respawn?: boolean;
    respawnDelay?: number;
    floatAnimation?: boolean;
    rotateAnimation?: boolean;
  }) {
    this.value = args.value || 10;
    this.effect = args.effect || 'score';
    this.respawn = args.respawn !== false;
    this.respawnDelay = args.respawnDelay || 3;
    this.floatAnimation = args.floatAnimation !== false;
    this.rotateAnimation = args.rotateAnimation !== false;
  }
  
  initialize(app: any, entity: any) {
    this.baseY = entity.getPosition().y;
    
    // Listen for collision with player
    if (entity.collision) {
      entity.collision.on('triggerenter', (other: any) => {
        if (other.entity.name === 'Player' && !this.collected) {
          this.collect(app, entity);
        }
      });
    }
  }
  
  update(dt: number, app: any, entity: any) {
    if (this.collected) {
      if (this.respawn) {
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0) {
          this.collected = false;
          entity.enabled = true;
        }
      }
      return;
    }
    
    this.time += dt;
    
    // Floating animation
    if (this.floatAnimation) {
      const pos = entity.getPosition();
      entity.setPosition(pos.x, this.baseY + Math.sin(this.time * 2) * 0.3, pos.z);
    }
    
    // Rotating animation
    if (this.rotateAnimation) {
      entity.rotateLocal(0, 90 * dt, 0);
    }
  }
  
  private collect(app: any, entity: any) {
    this.collected = true;
    this.respawnTimer = this.respawnDelay;
    entity.enabled = false;
    
    // Fire event for game state
    app.fire('hon:collectible', {
      effect: this.effect,
      value: this.value
    });
  }
}

interface HonCollectibleProps extends HonCollectibleConfig {
  children?: React.ReactNode;
}

export const HonCollectible: React.FC<HonCollectibleProps> = ({
  name = 'Collectible',
  type = 'sphere',
  position = [0, 1, 0],
  rotation = [0, 0, 0],
  scale = [0.5, 0.5, 0.5],
  color = '#ffff00',
  value = 10,
  effect = 'score',
  respawn = true,
  respawnDelay = 3,
  floatAnimation = true,
  rotateAnimation = true,
  children
}) => {
  return (
    <Entity name={name} position={position} rotation={rotation} scale={scale}>
      <Render type={type} />
      <Collision type={type} trigger={true} />
      <Script 
        type={CollectibleScript}
        value={value}
        effect={effect}
        respawn={respawn}
        respawnDelay={respawnDelay}
        floatAnimation={floatAnimation}
        rotateAnimation={rotateAnimation}
      />
      {children}
    </Entity>
  );
};

export default HonCollectible;

