/**
 * HonTrigger - Invisible trigger zones for events
 */

import React from 'react';
import { Entity } from '@playcanvas/react';
import { Collision, Script } from '@playcanvas/react/components';

interface HonTriggerConfig {
  name?: string;
  position?: [number, number, number];
  size?: [number, number, number];
  onEnter?: string; // Event name to fire
  onExit?: string;
  oneShot?: boolean;
  targetTag?: string; // Only trigger for entities with this tag
}

// Trigger script
class TriggerScript {
  onEnterEvent: string;
  onExitEvent: string;
  oneShot: boolean;
  targetTag: string;
  private triggered: boolean = false;
  
  constructor(args: {
    onEnter?: string;
    onExit?: string;
    oneShot?: boolean;
    targetTag?: string;
  }) {
    this.onEnterEvent = args.onEnter || 'hon:trigger-enter';
    this.onExitEvent = args.onExit || 'hon:trigger-exit';
    this.oneShot = args.oneShot || false;
    this.targetTag = args.targetTag || 'Player';
  }
  
  initialize(app: any, entity: any) {
    if (entity.collision) {
      entity.collision.on('triggerenter', (other: any) => {
        if (this.oneShot && this.triggered) return;
        
        const otherName = other.entity.name;
        if (otherName === this.targetTag || this.targetTag === '*') {
          this.triggered = true;
          app.fire(this.onEnterEvent, {
            trigger: entity,
            other: other.entity
          });
        }
      });
      
      entity.collision.on('triggerleave', (other: any) => {
        const otherName = other.entity.name;
        if (otherName === this.targetTag || this.targetTag === '*') {
          app.fire(this.onExitEvent, {
            trigger: entity,
            other: other.entity
          });
        }
      });
    }
  }
}

interface HonTriggerProps extends HonTriggerConfig {
  children?: React.ReactNode;
}

export const HonTrigger: React.FC<HonTriggerProps> = ({
  name = 'Trigger',
  position = [0, 0, 0],
  size = [2, 2, 2],
  onEnter = 'hon:trigger-enter',
  onExit = 'hon:trigger-exit',
  oneShot = false,
  targetTag = 'Player',
  children
}) => {
  return (
    <Entity name={name} position={position} scale={size}>
      <Collision type="box" trigger={true} />
      <Script 
        type={TriggerScript}
        onEnter={onEnter}
        onExit={onExit}
        oneShot={oneShot}
        targetTag={targetTag}
      />
      {children}
    </Entity>
  );
};

export default HonTrigger;

