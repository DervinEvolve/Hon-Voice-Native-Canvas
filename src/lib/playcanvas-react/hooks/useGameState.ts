/**
 * useGameState - Hook for managing game state (score, health, etc.)
 */

import { useState, useCallback, useEffect } from 'react';
import type { HonGameState } from '../types';

const initialState: HonGameState = {
  score: 0,
  health: 100,
  maxHealth: 100,
  level: 1,
  isPlaying: false,
  isPaused: false,
  isGameOver: false,
  isVictory: false,
  customData: {}
};

export function useGameState(initial?: Partial<HonGameState>) {
  const [state, setState] = useState<HonGameState>({
    ...initialState,
    ...initial
  });
  
  // Score
  const addScore = useCallback((points: number) => {
    setState(prev => ({ ...prev, score: prev.score + points }));
  }, []);
  
  const setScore = useCallback((score: number) => {
    setState(prev => ({ ...prev, score }));
  }, []);
  
  // Health
  const damage = useCallback((amount: number) => {
    setState(prev => {
      const newHealth = Math.max(0, prev.health - amount);
      return {
        ...prev,
        health: newHealth,
        isGameOver: newHealth <= 0
      };
    });
  }, []);
  
  const heal = useCallback((amount: number) => {
    setState(prev => ({
      ...prev,
      health: Math.min(prev.maxHealth, prev.health + amount)
    }));
  }, []);
  
  // Game flow
  const startGame = useCallback(() => {
    setState(prev => ({
      ...prev,
      isPlaying: true,
      isPaused: false,
      isGameOver: false,
      isVictory: false
    }));
  }, []);
  
  const pauseGame = useCallback(() => {
    setState(prev => ({ ...prev, isPaused: true }));
  }, []);
  
  const resumeGame = useCallback(() => {
    setState(prev => ({ ...prev, isPaused: false }));
  }, []);
  
  const endGame = useCallback((victory: boolean) => {
    setState(prev => ({
      ...prev,
      isPlaying: false,
      isGameOver: !victory,
      isVictory: victory
    }));
  }, []);
  
  const resetGame = useCallback(() => {
    setState({
      ...initialState,
      ...initial
    });
  }, [initial]);
  
  // Custom data
  const setCustomData = useCallback((key: string, value: any) => {
    setState(prev => ({
      ...prev,
      customData: { ...prev.customData, [key]: value }
    }));
  }, []);
  
  // Level
  const nextLevel = useCallback(() => {
    setState(prev => ({ ...prev, level: prev.level + 1 }));
  }, []);
  
  return {
    state,
    // Score
    addScore,
    setScore,
    // Health
    damage,
    heal,
    // Game flow
    startGame,
    pauseGame,
    resumeGame,
    endGame,
    resetGame,
    // Custom
    setCustomData,
    nextLevel
  };
}

export default useGameState;

