/**
 * usePanelScale - Custom hook for panel resize/scale functionality
 * 
 * Extracted from Creator.tsx for better code organization and reusability.
 * Handles panel scaling with constraints.
 */

import { useState, useRef, useEffect, useCallback } from 'react';

export interface UsePanelScaleConfig {
  /** Minimum scale value */
  minScale?: number;
  /** Maximum scale value */
  maxScale?: number;
  /** Scale sensitivity (pixels per 1.0 scale change) */
  sensitivity?: number;
}

export interface UsePanelScaleReturn {
  /** Current panel scales map */
  panelScales: Record<string, number>;
  /** Set panel scales */
  setPanelScales: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  /** Get scale for a specific panel */
  getPanelScale: (panelId: string) => number;
  /** Set scale for a specific panel */
  setPanelScale: (panelId: string, scale: number) => void;
  /** Handler for resize mouse down */
  onResizeStart: (panelId: string, e: React.MouseEvent) => void;
  /** Ref for current scales (for use in closures) */
  panelScalesRef: React.MutableRefObject<Record<string, number>>;
}

const DEFAULT_MIN_SCALE = 0.8;
const DEFAULT_MAX_SCALE = 1.6;
const DEFAULT_SENSITIVITY = 240;

/**
 * Hook for managing panel scale state with resize handles
 */
export function usePanelScale(config: UsePanelScaleConfig = {}): UsePanelScaleReturn {
  const {
    minScale = DEFAULT_MIN_SCALE,
    maxScale = DEFAULT_MAX_SCALE,
    sensitivity = DEFAULT_SENSITIVITY,
  } = config;

  const [panelScales, setPanelScales] = useState<Record<string, number>>({});
  const panelScalesRef = useRef(panelScales);

  // Keep ref in sync with state
  useEffect(() => {
    panelScalesRef.current = panelScales;
  }, [panelScales]);

  // Listen for external scale events
  useEffect(() => {
    const handleScaleSet = (e: CustomEvent<{ id: string; scale: number }>) => {
      const { id, scale } = e.detail;
      if (!id || typeof scale !== 'number') return;
      const clampedScale = Math.max(minScale, Math.min(maxScale, scale));
      setPanelScales(prev => ({ ...prev, [id]: clampedScale }));
    };

    document.addEventListener('panel-scale-set', handleScaleSet as EventListener);
    return () => {
      document.removeEventListener('panel-scale-set', handleScaleSet as EventListener);
    };
  }, [minScale, maxScale]);

  const getPanelScale = useCallback((panelId: string): number => {
    const rawScale = panelScales[panelId];
    return (typeof rawScale === 'number' && !isNaN(rawScale) && rawScale > 0) ? rawScale : 1;
  }, [panelScales]);

  const setPanelScale = useCallback((panelId: string, scale: number) => {
    const clampedScale = Math.max(minScale, Math.min(maxScale, scale));
    setPanelScales(prev => ({ ...prev, [panelId]: clampedScale }));
  }, [minScale, maxScale]);

  const onResizeStart = useCallback((panelId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Set a flag to prevent panel drag (for game panels)
    const panel = e.currentTarget.closest('[data-panel-id]');
    if (panel) {
      panel.setAttribute('data-resizing', 'true');
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const startScale = panelScalesRef.current[panelId] || 1;

    const onMove = (ev: MouseEvent) => {
      ev.preventDefault();
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const delta = Math.max(dx, dy) / sensitivity;
      const nextScale = Math.max(minScale, Math.min(maxScale, Number((startScale + delta).toFixed(2))));
      
      // Dispatch event for external listeners
      try {
        document.dispatchEvent(new CustomEvent('panel-scale-set', {
          detail: { id: panelId, scale: nextScale }
        }));
      } catch {}
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      
      // Clear the resizing flag
      const panel = document.querySelector(`[data-panel-id="${panelId}"]`);
      if (panel) {
        panel.removeAttribute('data-resizing');
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [minScale, maxScale, sensitivity]);

  return {
    panelScales,
    setPanelScales,
    getPanelScale,
    setPanelScale,
    onResizeStart,
    panelScalesRef,
  };
}

