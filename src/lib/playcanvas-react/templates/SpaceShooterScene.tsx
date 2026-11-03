/**
 * SpaceShooterScene - Ready-to-use space shooter template
 */

import React from 'react';
import { Application, Entity } from '@playcanvas/react';
import { Camera, Render, Light } from '@playcanvas/react/components';
import { HonPlayer } from '../components/HonPlayer';
import { HonEnemy } from '../components/HonEnemy';
import { HonCollectible } from '../components/HonCollectible';
import { HonSpawner } from '../components/HonSpawner';
import { HonEnvironment } from '../components/HonEnvironment';

interface SpaceShooterSceneProps {
  difficulty?: 'easy' | 'medium' | 'hard';
  onGameOver?: (score: number) => void;
  onVictory?: (score: number) => void;
}

export const SpaceShooterScene: React.FC<SpaceShooterSceneProps> = ({
  difficulty = 'medium',
  onGameOver,
  onVictory
}) => {
  const difficultySettings = {
    easy: { enemySpeed: 3, spawnRate: 0.5, maxEnemies: 5 },
    medium: { enemySpeed: 5, spawnRate: 1, maxEnemies: 10 },
    hard: { enemySpeed: 8, spawnRate: 2, maxEnemies: 20 }
  };
  
  const settings = difficultySettings[difficulty];
  
  return (
    <>
      {/* Environment */}
      <HonEnvironment preset="space" />
      
      {/* Camera */}
      <Entity name="MainCamera" position={[0, 15, 20]} rotation={[-30, 0, 0]}>
        <Camera clearColor="#000011" />
      </Entity>
      
      {/* Player */}
      <HonPlayer
        name="Player"
        type="capsule"
        position={[0, 1, 5]}
        color="#00ff88"
        speed={12}
        health={100}
        physics="dynamic"
      />
      
      {/* Ground/Arena */}
      <Entity name="Arena" position={[0, 0, 0]} scale={[40, 0.5, 40]}>
        <Render type="box" />
      </Entity>
      
      {/* Boundaries */}
      <Entity name="WallLeft" position={[-20, 2, 0]} scale={[0.5, 4, 40]}>
        <Render type="box" />
      </Entity>
      <Entity name="WallRight" position={[20, 2, 0]} scale={[0.5, 4, 40]}>
        <Render type="box" />
      </Entity>
      <Entity name="WallBack" position={[0, 2, -20]} scale={[40, 4, 0.5]}>
        <Render type="box" />
      </Entity>
      <Entity name="WallFront" position={[0, 2, 20]} scale={[40, 4, 0.5]}>
        <Render type="box" />
      </Entity>
      
      {/* Enemy Spawner */}
      <HonSpawner
        entityType="enemy"
        entityConfig={{
          name: 'Enemy',
          type: 'box',
          color: '#ff0044',
          scale: [1, 1, 1]
        }}
        rate={settings.spawnRate}
        maxCount={settings.maxEnemies}
        spawnRadius={15}
        position={[0, 1, -15]}
        initialDelay={2}
      />
      
      {/* Collectibles */}
      {Array.from({ length: 5 }).map((_, i) => (
        <HonCollectible
          key={`coin-${i}`}
          name={`Coin${i}`}
          position={[
            (Math.random() - 0.5) * 30,
            1,
            (Math.random() - 0.5) * 30
          ]}
          value={10}
          effect="score"
          color="#ffff00"
        />
      ))}
      
      {/* Health pickups */}
      <HonCollectible
        name="HealthPack"
        position={[10, 1, 10]}
        value={25}
        effect="health"
        color="#00ff00"
        type="box"
        scale={[0.8, 0.8, 0.8]}
        respawnDelay={10}
      />
    </>
  );
};

export default SpaceShooterScene;

