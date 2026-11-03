/**
 * useCanvasZoom - Custom hook for canvas zoom and pan functionality
 * 
 * Extracted from Creator.tsx for better code organization and reusability.
 * Handles mouse wheel zoom, middle-click/space+drag panning, and zoom controls.
 */

import { useState, useRef, useEffect, useCallback, RefObject } from 'react';

export interface CanvasZoomState {
  scale: number;
  position: { x: number; y: number };
  isDragging: boolean;
}

export interface CanvasZoomConfig {
  minZoom?: number;
  maxZoom?: number;
  zoomStep?: number;
  zoomStepLarge?: number;
  disabled?: boolean;
}

export interface CanvasZoomHandlers {
  onWheel: (e: WheelEvent) => void;
  onMouseDown: (e: MouseEvent) => void;
  onMouseMove: (e: MouseEvent) => void;
  onMouseUp: () => void;
}

export interface UseCanvasZoomReturn {
  scale: number;
  position: { x: number; y: number };
  isDragging: boolean;
  setScale: (scale: number) => void;
  setPosition: (position: { x: number; y: number }) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  fitToView: (elementWidth: number, elementHeight: number, containerWidth: number, containerHeight: number, margin?: number) => void;
}

const DEFAULT_CONFIG: Required<CanvasZoomConfig> = {
  minZoom: 0.25,
  maxZoom: 5,
  zoomStep: 0.06,
  zoomStepLarge: 0.12,
  disabled: false,
};

/**
 * Hook for managing canvas zoom and pan state with event handlers
 */
export function useCanvasZoom(
  canvasRef: RefObject<HTMLDivElement>,
  zoomContainerRef: RefObject<HTMLDivElement>,
  config: CanvasZoomConfig = {},
  onZoomChange?: (oldScale: number, newScale: number) => void,
  onPanChange?: (oldPosition: { x: number; y: number }, newPosition: { x: number; y: number }) => void
): UseCanvasZoomReturn {
  const { minZoom, maxZoom, zoomStep, zoomStepLarge, disabled } = { ...DEFAULT_CONFIG, ...config };

  const [scale, setScaleState] = useState(1);
  const [position, setPositionState] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Refs for tracking state changes
  const lastStateRef = useRef<{ scale: number; position: { x: number; y: number } }>({ scale: 1, position: { x: 0, y: 0 } });
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Update transform on the zoom container
  const updateTransform = useCallback((newScale: number, newPosition: { x: number; y: number }) => {
    if (zoomContainerRef.current) {
      zoomContainerRef.current.style.transform = `translate(${newPosition.x}px, ${newPosition.y}px) scale(${newScale})`;
    }
  }, [zoomContainerRef]);

  // Wrapped setters that also update transform
  const setScale = useCallback((newScale: number) => {
    const clampedScale = Math.max(minZoom, Math.min(maxZoom, newScale));
    setScaleState(clampedScale);
    updateTransform(clampedScale, position);
  }, [minZoom, maxZoom, position, updateTransform]);

  const setPosition = useCallback((newPosition: { x: number; y: number }) => {
    setPositionState(newPosition);
    updateTransform(scale, newPosition);
  }, [scale, updateTransform]);

  // Zoom control functions
  const zoomIn = useCallback(() => {
    if (disabled) return;
    const oldScale = scale;
    const newScale = Math.min(maxZoom, scale + zoomStepLarge);
    setScaleState(newScale);
    updateTransform(newScale, position);
    onZoomChange?.(oldScale, newScale);
    lastStateRef.current = { scale: newScale, position };
  }, [disabled, scale, maxZoom, zoomStepLarge, position, updateTransform, onZoomChange]);

  const zoomOut = useCallback(() => {
    if (disabled) return;
    const oldScale = scale;
    const newScale = Math.max(minZoom, scale - zoomStepLarge);
    setScaleState(newScale);
    updateTransform(newScale, position);
    onZoomChange?.(oldScale, newScale);
    lastStateRef.current = { scale: newScale, position };
  }, [disabled, scale, minZoom, zoomStepLarge, position, updateTransform, onZoomChange]);

  const resetZoom = useCallback(() => {
    if (disabled) return;
    const oldScale = scale;
    const oldPosition = position;
    setScaleState(1);
    setPositionState({ x: 0, y: 0 });
    updateTransform(1, { x: 0, y: 0 });
    onZoomChange?.(oldScale, 1);
    onPanChange?.(oldPosition, { x: 0, y: 0 });
    lastStateRef.current = { scale: 1, position: { x: 0, y: 0 } };
  }, [disabled, scale, position, updateTransform, onZoomChange, onPanChange]);

  const fitToView = useCallback((
    elementWidth: number,
    elementHeight: number,
    containerWidth: number,
    containerHeight: number,
    margin: number = 0.1
  ) => {
    if (disabled) return;
    const pw = Math.max(1, elementWidth);
    const ph = Math.max(1, elementHeight);
    const fit = Math.max(minZoom, Math.min(maxZoom, Math.min(
      (containerWidth * (1 - margin)) / pw,
      (containerHeight * (1 - margin)) / ph
    )));
    setScaleState(fit);
    setPositionState({ x: 0, y: 0 });
    updateTransform(fit, { x: 0, y: 0 });
  }, [disabled, minZoom, maxZoom, updateTransform]);

  // Set up event listeners
  useEffect(() => {
    if (!canvasRef.current || !zoomContainerRef.current || disabled) return;

    const canvas = canvasRef.current;
    const zoomContainer = zoomContainerRef.current;

    // Zoom with mouse wheel
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -Math.sign(e.deltaY) * zoomStep;
      const newScale = Math.max(minZoom, Math.min(maxZoom, scale + delta));
      setScaleState(newScale);
      zoomContainer.style.transform = `translate(${position.x}px, ${position.y}px) scale(${newScale})`;

      // Debounce zoom tracking callback
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        const oldScale = lastStateRef.current.scale;
        if (Math.abs(oldScale - newScale) > 0.05) {
          onZoomChange?.(oldScale, newScale);
          lastStateRef.current = { scale: newScale, position };
        }
      }, 500);
    };

    // Handle mouse down for panning
    const handleMouseDown = (e: MouseEvent) => {
      // Only start dragging on middle mouse button or when holding space
      if (e.button === 1 || (e.button === 0 && e.getModifierState('Space'))) {
        e.preventDefault();
        setIsDragging(true);
        setDragStart({ x: e.clientX, y: e.clientY });
      }
    };

    // Handle mouse move for panning
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const dx = (e.clientX - dragStart.x) / scale;
      const dy = (e.clientY - dragStart.y) / scale;

      const newPosition = {
        x: position.x + dx,
        y: position.y + dy
      };

      setPositionState(newPosition);
      setDragStart({ x: e.clientX, y: e.clientY });
      zoomContainer.style.transform = `translate(${newPosition.x}px, ${newPosition.y}px) scale(${scale})`;
    };

    // Handle mouse up to stop panning
    const handleMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        // Track canvas pan event after panning completes
        const oldPos = lastStateRef.current.position;
        if (oldPos.x !== position.x || oldPos.y !== position.y) {
          onPanChange?.(oldPos, position);
          lastStateRef.current = { scale, position };
        }
      }
    };

    // Prevent context menu during drag
    const preventContextMenu = (e: MouseEvent) => {
      if (isDragging) {
        e.preventDefault();
      }
    };

    // Custom zoom control events
    const handleZoomInEvent = () => zoomIn();
    const handleZoomOutEvent = () => zoomOut();
    const handleResetEvent = () => resetZoom();

    // Attach event listeners
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('contextmenu', preventContextMenu);

    // Custom events for external zoom controls
    document.addEventListener('canvas-zoom-in', handleZoomInEvent);
    document.addEventListener('canvas-zoom-out', handleZoomOutEvent);
    document.addEventListener('canvas-reset', handleResetEvent);

    // Initialize last state
    lastStateRef.current = { scale, position };

    // Cleanup
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('contextmenu', preventContextMenu);

      document.removeEventListener('canvas-zoom-in', handleZoomInEvent);
      document.removeEventListener('canvas-zoom-out', handleZoomOutEvent);
      document.removeEventListener('canvas-reset', handleResetEvent);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [
    canvasRef,
    zoomContainerRef,
    scale,
    position,
    isDragging,
    dragStart,
    disabled,
    minZoom,
    maxZoom,
    zoomStep,
    zoomIn,
    zoomOut,
    resetZoom,
    onZoomChange,
    onPanChange
  ]);

  return {
    scale,
    position,
    isDragging,
    setScale,
    setPosition,
    zoomIn,
    zoomOut,
    resetZoom,
    fitToView,
  };
}

