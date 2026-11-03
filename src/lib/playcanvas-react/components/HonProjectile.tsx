/**
 * HonProjectile - Projectile entity (bullets, missiles, etc.)
 */

import React from 'react';
import { Entity } from '@playcanvas/react';
import { Render, Collision, Script } from '@playcanvas/react/components';

interface HonProjectileConfig {
  name?: string;
  type?: 'sphere' | 'box' | 'cylinder';
  position?: [number, number, number];
  direction?: [number, number, number];
  speed?: number;
  damage?: number;
  lifetime?: number;
  color?: string;
  scale?: [number, number, number];
}

// Projectile behavior script
class ProjectileScript {
  direction: [number, number, number];
  speed: number;
  damage: number;
  lifetime: number;
  private timer: number = 0;
  
  constructor(args: {
    direction?: [number, number, number];
    speed?: number;
    damage?: number;
    lifetime?: number;
  }) {
    this.direction = args.direction || [0, 0, -1];
    this.speed = args.speed || 20;
    this.damage = args.damage || 10;
    this.lifetime = args.lifetime || 5;
  }
  
  initialize(app: any, entity: any) {
    // Listen for collision
    if (entity.collision) {
      entity.collision.on('triggerenter', (other: any) => {
        if (other.entity.name !== 'Player') {
          this.onHit(app, entity, other.entity);
        }
      });
    }
  }
  
  update(dt: number, app: any, entity: any) {
    // Move projectile
    entity.translateLocal(
      this.direction[0] * this.speed * dt,
      this.direction[1] * this.speed * dt,
      this.direction[2] * this.speed * dt
    );
    
    // Lifetime check
    this.timer += dt;
    if (this.timer >= this.lifetime) {
      entity.destroy();
    }
  }
  
  private onHit(app: any, projectile: any, target: any) {
    // Fire hit event
    app.fire('hon:projectile-hit', {
      projectile: projectile,
      target: target,
      damage: this.damage
    });
    
    // Destroy projectile
    projectile.destroy();
  }
}

interface HonProjectileProps extends HonProjectileConfig {
  children?: React.ReactNode;
}

export const HonProjectile: React.FC<HonProjectileProps> = ({
  name = 'Projectile',
  type = 'sphere',
  position = [0, 1, 0],
  direction = [0, 0, -1],
  speed = 20,
  damage = 10,
  lifetime = 5,
  color = '#ffff00',
  scale = [0.2, 0.2, 0.2],
  children
}) => {
  return (
    <Entity name={name} position={position} scale={scale}>
      <Render type={type} />
      <Collision type={type} trigger={true} />
      <Script 
        type={ProjectileScript}
        direction={direction}
        speed={speed}
        damage={damage}
        lifetime={lifetime}
      />
      {children}
    </Entity>
  );
};

export default HonProjectile;

