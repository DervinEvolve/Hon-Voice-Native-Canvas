/**
 * HonEnvironment - Scene environment setup (sky, fog, lighting)
 * 
 * Presets: space, forest, dungeon, city, desert, ocean, void
 */

import React, { useEffect } from 'react';
import { Entity } from '@playcanvas/react';
import { Light } from '@playcanvas/react/components';
import type { HonEnvironmentConfig } from '../types';

// Environment presets
const PRESETS: Record<string, HonEnvironmentConfig> = {
  space: {
    skyColor: '#000011',
    fogEnabled: false,
    ambientColor: '#111133',
    ambientIntensity: 0.3,
    sunColor: '#ffffff',
    sunIntensity: 0.5,
    sunDirection: [1, -1, -1]
  },
  forest: {
    skyColor: '#87ceeb',
    fogEnabled: true,
    fogColor: '#c8e6c9',
    fogDensity: 0.02,
    ambientColor: '#4a6741',
    ambientIntensity: 0.5,
    sunColor: '#fff8dc',
    sunIntensity: 1.0,
    sunDirection: [0.5, -1, -0.5]
  },
  dungeon: {
    skyColor: '#0a0a0a',
    fogEnabled: true,
    fogColor: '#1a1a2e',
    fogDensity: 0.05,
    ambientColor: '#2d2d44',
    ambientIntensity: 0.2,
    sunColor: '#ff6600',
    sunIntensity: 0.3,
    sunDirection: [0, -1, 0]
  },
  city: {
    skyColor: '#1a1a2e',
    fogEnabled: true,
    fogColor: '#2d2d44',
    fogDensity: 0.01,
    ambientColor: '#3d3d5c',
    ambientIntensity: 0.4,
    sunColor: '#ff9933',
    sunIntensity: 0.6,
    sunDirection: [0.3, -1, -0.5]
  },
  desert: {
    skyColor: '#ffd699',
    fogEnabled: true,
    fogColor: '#e6c88a',
    fogDensity: 0.008,
    ambientColor: '#d4a574',
    ambientIntensity: 0.6,
    sunColor: '#ffee88',
    sunIntensity: 1.5,
    sunDirection: [0.2, -1, -0.3]
  },
  ocean: {
    skyColor: '#1e90ff',
    fogEnabled: true,
    fogColor: '#4169e1',
    fogDensity: 0.03,
    ambientColor: '#4682b4',
    ambientIntensity: 0.5,
    sunColor: '#ffffff',
    sunIntensity: 0.8,
    sunDirection: [0, -1, -0.5]
  },
  void: {
    skyColor: '#000000',
    fogEnabled: false,
    ambientColor: '#1a0a2e',
    ambientIntensity: 0.1,
    sunColor: '#8b00ff',
    sunIntensity: 0.2,
    sunDirection: [0, -1, 0]
  }
};

interface HonEnvironmentProps extends HonEnvironmentConfig {
  children?: React.ReactNode;
}

export const HonEnvironment: React.FC<HonEnvironmentProps> = ({
  preset = 'space',
  skyColor,
  fogEnabled,
  fogColor,
  fogDensity,
  ambientColor,
  ambientIntensity,
  sunColor,
  sunIntensity,
  sunDirection,
  children
}) => {
  // Merge preset with custom values
  const base = PRESETS[preset] || PRESETS.space;
  const config: HonEnvironmentConfig = {
    skyColor: skyColor || base.skyColor,
    fogEnabled: fogEnabled ?? base.fogEnabled,
    fogColor: fogColor || base.fogColor,
    fogDensity: fogDensity ?? base.fogDensity,
    ambientColor: ambientColor || base.ambientColor,
    ambientIntensity: ambientIntensity ?? base.ambientIntensity,
    sunColor: sunColor || base.sunColor,
    sunIntensity: sunIntensity ?? base.sunIntensity,
    sunDirection: sunDirection || base.sunDirection
  };
  
  const sunDir = config.sunDirection || [0, -1, 0];
  
  return (
    <Entity name="Environment">
      {/* Ambient Light */}
      <Entity name="AmbientLight">
        <Light 
          type="directional" 
          color={config.ambientColor}
          intensity={config.ambientIntensity}
        />
      </Entity>
      
      {/* Sun/Directional Light */}
      <Entity 
        name="SunLight" 
        rotation={[
          Math.atan2(sunDir[1], Math.sqrt(sunDir[0]**2 + sunDir[2]**2)) * 180 / Math.PI,
          Math.atan2(sunDir[0], sunDir[2]) * 180 / Math.PI,
          0
        ]}
      >
        <Light 
          type="directional" 
          color={config.sunColor}
          intensity={config.sunIntensity}
          castShadows={true}
          shadowBias={0.05}
          shadowDistance={40}
        />
      </Entity>
      
      {children}
    </Entity>
  );
};

export default HonEnvironment;

