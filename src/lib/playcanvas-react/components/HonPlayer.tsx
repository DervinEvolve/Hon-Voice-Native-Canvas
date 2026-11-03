/**
 * HonPlayer - Configurable player entity for Hon scenes
 * 
 * Provides WASD/Arrow movement, jumping, and camera following.
 */

import React from 'react';
import { Entity } from '@playcanvas/react';
import { Render, Collision, RigidBody, Script } from '@playcanvas/react/components';
import type { HonPlayerConfig } from '../types';

// Player controller script
class PlayerControllerScript {
  speed: number;
  jumpForce: number;
  
  constructor(args: { speed?: number; jumpForce?: number }) {
    this.speed = args.speed || 10;
    this.jumpForce = args.jumpForce || 8;
  }
  
  update(dt: number, app: any, entity: any) {
    const keyboard = app.keyboard;
    const forward = entity.forward;
    const right = entity.right;
    
    let moveX = 0;
    let moveZ = 0;
    
    // WASD movement
    if (keyboard.isPressed(87) || keyboard.isPressed(38)) moveZ -= 1; // W or Up
    if (keyboard.isPressed(83) || keyboard.isPressed(40)) moveZ += 1; // S or Down
    if (keyboard.isPressed(65) || keyboard.isPressed(37)) moveX -= 1; // A or Left
    if (keyboard.isPressed(68) || keyboard.isPressed(39)) moveX += 1; // D or Right
    
    if (moveX !== 0 || moveZ !== 0) {
      const rigidBody = entity.rigidbody;
      if (rigidBody) {
        const velocity = rigidBody.linearVelocity;
        rigidBody.linearVelocity = new pc.Vec3(
          moveX * this.speed,
          velocity.y,
          moveZ * this.speed
        );
      } else {
        entity.translateLocal(moveX * this.speed * dt, 0, moveZ * this.speed * dt);
      }
    }
    
    // Jump
    if (keyboard.wasPressed(32)) { // Space
      const rigidBody = entity.rigidbody;
      if (rigidBody) {
        rigidBody.applyImpulse(new pc.Vec3(0, this.jumpForce, 0));
      }
    }
  }
}

interface HonPlayerProps extends HonPlayerConfig {
  children?: React.ReactNode;
}

export const HonPlayer: React.FC<HonPlayerProps> = ({
  name = 'Player',
  type = 'capsule',
  position = [0, 1, 0],
  rotation = [0, 0, 0],
  scale = [1, 2, 1],
  color = '#00ff88',
  speed = 10,
  jumpForce = 8,
  health = 100,
  physics = 'dynamic',
  cameraFollow = true,
  cameraDistance = 10,
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
            friction={0.5}
            restitution={0.1}
          />
        </>
      )}
      <Script 
        type={PlayerControllerScript} 
        speed={speed} 
        jumpForce={jumpForce} 
      />
      {children}
    </Entity>
  );
};

export default HonPlayer;

