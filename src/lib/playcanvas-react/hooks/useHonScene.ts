/**
 * useHonScene - Hook for managing Hon scene state
 */

import { useState, useCallback, useEffect } from 'react';
import type { HonSceneConfig, HonEntityConfig } from '../types';

export function useHonScene(initialConfig?: Partial<HonSceneConfig>) {
  const [config, setConfig] = useState<HonSceneConfig>({
    name: initialConfig?.name || 'Hon Scene',
    type: initialConfig?.type || 'exploration',
    environment: initialConfig?.environment || { preset: 'space' },
    entities: initialConfig?.entities || [],
    spawners: initialConfig?.spawners || [],
    objectives: initialConfig?.objectives || [],
    ...(initialConfig?.player && { player: initialConfig.player })
  });
  
  // Add entity to scene
  const addEntity = useCallback((entity: HonEntityConfig) => {
    setConfig(prev => ({
      ...prev,
      entities: [...prev.entities, entity]
    }));
  }, []);
  
  // Remove entity from scene
  const removeEntity = useCallback((name: string) => {
    setConfig(prev => ({
      ...prev,
      entities: prev.entities.filter(e => e.name !== name)
    }));
  }, []);
  
  // Update entity
  const updateEntity = useCallback((name: string, updates: Partial<HonEntityConfig>) => {
    setConfig(prev => ({
      ...prev,
      entities: prev.entities.map(e => 
        e.name === name ? { ...e, ...updates } : e
      )
    }));
  }, []);
  
  // Set environment
  const setEnvironment = useCallback((env: Partial<HonSceneConfig['environment']>) => {
    setConfig(prev => ({
      ...prev,
      environment: { ...prev.environment, ...env }
    }));
  }, []);
  
  // Set player config
  const setPlayer = useCallback((player: HonSceneConfig['player']) => {
    setConfig(prev => ({
      ...prev,
      player
    }));
  }, []);
  
  // Clear scene
  const clearScene = useCallback(() => {
    setConfig(prev => ({
      ...prev,
      entities: [],
      spawners: []
    }));
  }, []);
  
  return {
    config,
    addEntity,
    removeEntity,
    updateEntity,
    setEnvironment,
    setPlayer,
    clearScene,
    setConfig
  };
}

export default useHonScene;

