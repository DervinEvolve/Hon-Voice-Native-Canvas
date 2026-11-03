/**
 * PlatformerScene - Ready-to-use platformer template
 */

import React from 'react';
import { Entity } from '@playcanvas/react';
import { Camera, Render, Collision, RigidBody } from '@playcanvas/react/components';
import { HonPlayer } from '../components/HonPlayer';
import { HonCollectible } from '../components/HonCollectible';
import { HonEnvironment } from '../components/HonEnvironment';
import { HonTrigger } from '../components/HonTrigger';

interface PlatformerSceneProps {
  levelLayout?: 'linear' | 'vertical' | 'maze';
}

export const PlatformerScene: React.FC<PlatformerSceneProps> = ({
  levelLayout = 'linear'
}) => {
  // Platform generator based on layout
  const platforms = generatePlatforms(levelLayout);
  
  return (
    <>
      {/* Environment */}
      <HonEnvironment preset="forest" />
      
      {/* Camera - follows player */}
      <Entity name="MainCamera" position={[0, 8, 15]} rotation={[-20, 0, 0]}>
        <Camera clearColor="#87ceeb" />
      </Entity>
      
      {/* Player */}
      <HonPlayer
        name="Player"
        type="capsule"
        position={[0, 2, 0]}
        color="#4ecdc4"
        speed={8}
        jumpForce={10}
        health={100}
        physics="dynamic"
      />
      
      {/* Ground */}
      <Entity name="Ground" position={[0, -0.5, 0]} scale={[50, 1, 10]}>
        <Render type="box" />
        <Collision type="box" />
        <RigidBody type="static" />
      </Entity>
      
      {/* Platforms */}
      {platforms.map((plat, i) => (
        <Entity 
          key={`platform-${i}`}
          name={`Platform${i}`}
          position={plat.position}
          scale={plat.scale}
        >
          <Render type="box" />
          <Collision type="box" />
          <RigidBody type="static" />
        </Entity>
      ))}
      
      {/* Collectibles on platforms */}
      {platforms.map((plat, i) => (
        <HonCollectible
          key={`coin-plat-${i}`}
          name={`PlatformCoin${i}`}
          position={[
            plat.position[0],
            plat.position[1] + 1.5,
            plat.position[2]
          ]}
          value={10}
          effect="score"
        />
      ))}
      
      {/* Goal trigger at end */}
      <HonTrigger
        name="Goal"
        position={[platforms[platforms.length - 1]?.position[0] || 20, 2, 0]}
        size={[3, 3, 3]}
        onEnter="hon:level-complete"
        oneShot={true}
      />
      
      {/* Death zone */}
      <HonTrigger
        name="DeathZone"
        position={[0, -10, 0]}
        size={[100, 2, 20]}
        onEnter="hon:player-death"
      />
    </>
  );
};

// Helper to generate platform positions
function generatePlatforms(layout: string): Array<{
  position: [number, number, number];
  scale: [number, number, number];
}> {
  const platforms: Array<{
    position: [number, number, number];
    scale: [number, number, number];
  }> = [];
  
  if (layout === 'linear') {
    for (let i = 0; i < 8; i++) {
      platforms.push({
        position: [5 + i * 4, 1 + i * 0.5, 0],
        scale: [3, 0.5, 3]
      });
    }
  } else if (layout === 'vertical') {
    for (let i = 0; i < 6; i++) {
      platforms.push({
        position: [(i % 2) * 5 - 2.5, 2 + i * 3, 0],
        scale: [4, 0.5, 3]
      });
    }
  } else if (layout === 'maze') {
    const positions: [number, number, number][] = [
      [3, 1, 0], [6, 2, 3], [9, 1, -3], [12, 3, 0],
      [15, 2, 3], [18, 4, -3], [21, 3, 0], [24, 5, 0]
    ];
    positions.forEach(pos => {
      platforms.push({ position: pos, scale: [3, 0.5, 3] });
    });
  }
  
  return platforms;
}

export default PlatformerScene;

