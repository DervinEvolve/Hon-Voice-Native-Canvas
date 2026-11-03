/**
 * ExplorationScene - Open world exploration template
 */

import React from 'react';
import { Entity } from '@playcanvas/react';
import { Camera, Render, Light, Collision, RigidBody } from '@playcanvas/react/components';
import { HonPlayer } from '../components/HonPlayer';
import { HonCollectible } from '../components/HonCollectible';
import { HonEnvironment } from '../components/HonEnvironment';

interface ExplorationSceneProps {
  preset?: 'forest' | 'desert' | 'city' | 'dungeon';
  size?: 'small' | 'medium' | 'large';
}

export const ExplorationScene: React.FC<ExplorationSceneProps> = ({
  preset = 'forest',
  size = 'medium'
}) => {
  const sizeConfig = {
    small: { ground: 30, objects: 10 },
    medium: { ground: 60, objects: 25 },
    large: { ground: 100, objects: 50 }
  };
  
  const config = sizeConfig[size];
  
  // Generate random decorative objects
  const decorations = Array.from({ length: config.objects }).map((_, i) => ({
    position: [
      (Math.random() - 0.5) * config.ground * 0.8,
      1,
      (Math.random() - 0.5) * config.ground * 0.8
    ] as [number, number, number],
    type: ['box', 'cylinder', 'cone'][Math.floor(Math.random() * 3)] as 'box' | 'cylinder' | 'cone',
    scale: [
      0.5 + Math.random() * 2,
      1 + Math.random() * 4,
      0.5 + Math.random() * 2
    ] as [number, number, number]
  }));
  
  return (
    <>
      {/* Environment */}
      <HonEnvironment preset={preset} />
      
      {/* Camera */}
      <Entity name="MainCamera" position={[0, 10, 20]} rotation={[-20, 0, 0]}>
        <Camera clearColor="#87ceeb" />
      </Entity>
      
      {/* Player */}
      <HonPlayer
        name="Player"
        type="capsule"
        position={[0, 2, 0]}
        color="#4ecdc4"
        speed={8}
        health={100}
        physics="dynamic"
        cameraFollow={true}
      />
      
      {/* Ground */}
      <Entity name="Ground" position={[0, 0, 0]} scale={[config.ground, 0.5, config.ground]}>
        <Render type="box" />
        <Collision type="box" />
        <RigidBody type="static" />
      </Entity>
      
      {/* Decorative objects */}
      {decorations.map((obj, i) => (
        <Entity
          key={`decoration-${i}`}
          name={`Decoration${i}`}
          position={obj.position}
          scale={obj.scale}
        >
          <Render type={obj.type} />
          <Collision type={obj.type} />
          <RigidBody type="static" />
        </Entity>
      ))}
      
      {/* Scattered collectibles */}
      {Array.from({ length: 10 }).map((_, i) => (
        <HonCollectible
          key={`collectible-${i}`}
          name={`Collectible${i}`}
          position={[
            (Math.random() - 0.5) * config.ground * 0.7,
            1.5,
            (Math.random() - 0.5) * config.ground * 0.7
          ]}
          value={10}
          effect="score"
          floatAnimation={true}
          rotateAnimation={true}
        />
      ))}
      
      {/* Ambient point lights for atmosphere */}
      <Entity name="Light1" position={[10, 5, 10]}>
        <Light type="point" color="#ffaa00" intensity={0.5} range={20} />
      </Entity>
      <Entity name="Light2" position={[-10, 5, -10]}>
        <Light type="point" color="#00aaff" intensity={0.5} range={20} />
      </Entity>
    </>
  );
};

export default ExplorationScene;

