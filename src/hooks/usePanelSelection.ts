/**
 * usePanelSelection - Custom hook for panel selection and marquee functionality
 * 
 * Extracted from Creator.tsx for better code organization and reusability.
 * Handles single selection, multi-selection, and marquee/lasso selection.
 */

import { useState, useRef, useCallback, RefObject } from 'react';
import { useComicStore } from '../store/useComicStore';

export interface MarqueeState {
  x: number;
  y: number;
  w: number;
  h: number;
  active: boolean;
}

export interface UsePanelSelectionConfig {
  /** Scale threshold below which board mode is active */
  overviewThreshold?: number;
  /** Current canvas scale */
  scale: number;
}

export interface UsePanelSelectionReturn {
  /** Currently selected panel IDs */
  selectedPanelIds: string[];
  /** Set selected panel IDs */
  setSelectedPanelIds: (ids: string[]) => void;
  /** Clear all selections */
  clearSelection: () => void;
  /** Current marquee state */
  marquee: MarqueeState;
  /** Timestamp of last marquee selection (to prevent click-through) */
  justMarqueeSelectAt: number;
  /** Handler for marquee pointer down */
  onMarqueePointerDown: (e: React.PointerEvent, containerRef: RefObject<HTMLDivElement>) => void;
  /** Handler for marquee pointer move */
  onMarqueePointerMove: (e: React.PointerEvent, containerRef: RefObject<HTMLDivElement>) => void;
  /** Handler for marquee pointer up */
  onMarqueePointerUp: (e: React.PointerEvent, containerRef: RefObject<HTMLDivElement>, zoomContainerRef: RefObject<HTMLDivElement>) => void;
  /** Handler for canvas click (to clear selection) */
  onCanvasClick: (e: React.MouseEvent) => void;
  /** Handler for panel click */
  onPanelClick: (panelId: string, e: React.MouseEvent) => void;
  /** Handler for panel pointer down (touch) */
  onPanelPointerDown: (panelId: string, e: React.PointerEvent) => void;
}

const DEFAULT_MARQUEE: MarqueeState = { x: 0, y: 0, w: 0, h: 0, active: false };

/**
 * Hook for managing panel selection state with marquee support
 */
export function usePanelSelection(config: UsePanelSelectionConfig): UsePanelSelectionReturn {
  const { scale, overviewThreshold = 0.65 } = config;

  // Get selection state from store
  const selectedPanelIds = useComicStore(s => s.selectedPanelIds || [], (a, b) => {
    if (a.length !== b.length) return false;
    return a.every((id, i) => id === b[i]);
  });
  const setSelectedPanelIds = useComicStore(s => s.setSelectedPanelIds);
  const clearSelection = useComicStore(s => s.clearSelection);

  // Local state for marquee
  const [marquee, setMarquee] = useState<MarqueeState>(DEFAULT_MARQUEE);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const justMarqueeSelectAtRef = useRef<number>(0);

  // Marquee pointer down handler
  const onMarqueePointerDown = useCallback((
    e: React.PointerEvent,
    containerRef: RefObject<HTMLDivElement>
  ) => {
    // Only in board mode (scale below threshold)
    if (scale > overviewThreshold) return;
    // Only handle touch events for marquee
    if (e.pointerType !== 'touch') return;
    // Ignore if clicking on a panel
    if ((e.target as HTMLElement).closest('[data-board-panel]')) return;
    // Ignore if already tracking a pointer
    if (activePointerIdRef.current !== null) return;

    if (!containerRef.current) return;

    activePointerIdRef.current = e.pointerId;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    marqueeStartRef.current = { x, y };
    setMarquee({ x, y, w: 0, h: 0, active: true });
  }, [scale, overviewThreshold]);

  // Marquee pointer move handler
  const onMarqueePointerMove = useCallback((
    e: React.PointerEvent,
    containerRef: RefObject<HTMLDivElement>
  ) => {
    if (scale > overviewThreshold) return;
    if (e.pointerType !== 'touch') return;
    if (!marquee.active || !marqueeStartRef.current || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x2 = e.clientX - rect.left;
    const y2 = e.clientY - rect.top;
    const x1 = marqueeStartRef.current.x;
    const y1 = marqueeStartRef.current.y;
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    setMarquee({ x, y, w, h, active: true });
  }, [scale, overviewThreshold, marquee.active]);

  // Marquee pointer up handler
  const onMarqueePointerUp = useCallback((
    e: React.PointerEvent,
    containerRef: RefObject<HTMLDivElement>,
    zoomContainerRef: RefObject<HTMLDivElement>
  ) => {
    if (scale > overviewThreshold) return;
    if (e.pointerType !== 'touch') return;
    if (!marquee.active || !containerRef.current) return;

    try {
      const rect = containerRef.current.getBoundingClientRect();
      const selBox = new DOMRect(
        rect.left + marquee.x,
        rect.top + marquee.y,
        marquee.w,
        marquee.h
      );

      const newly: string[] = [];
      const searchContainer = zoomContainerRef.current || containerRef.current;
      const nodes = searchContainer.querySelectorAll('[data-board-panel]');
      
      nodes.forEach(node => {
        const el = node as HTMLElement;
        const id = el.getAttribute('data-board-panel');
        if (!id) return;
        const r = el.getBoundingClientRect();
        const intersects = !(
          r.right < selBox.left ||
          r.left > selBox.right ||
          r.bottom < selBox.top ||
          r.top > selBox.bottom
        );
        if (intersects) newly.push(id);
      });

      setSelectedPanelIds(newly);
      document.dispatchEvent(new CustomEvent('board-selection-changed', { detail: { panelIds: newly } }));
      justMarqueeSelectAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
    } finally {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      activePointerIdRef.current = null;
      marqueeStartRef.current = null;
      setMarquee(DEFAULT_MARQUEE);
    }
  }, [scale, overviewThreshold, marquee, setSelectedPanelIds]);

  // Canvas click handler (to clear selection)
  const onCanvasClick = useCallback((e: React.MouseEvent) => {
    if (scale > overviewThreshold) return;
    const target = e.target as HTMLElement;
    if (!target.closest('[data-board-panel]')) {
      clearSelection();
      document.dispatchEvent(new CustomEvent('board-selection-changed', { detail: { panelIds: [] } }));
    }
  }, [scale, overviewThreshold, clearSelection]);

  // Panel click handler
  const onPanelClick = useCallback((panelId: string, e: React.MouseEvent) => {
    if (scale > overviewThreshold) return;
    e.stopPropagation();

    // If just finished a marquee selection, ignore stray click-up
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - justMarqueeSelectAtRef.current < 120) return;

    // Single click selects this panel (replaces selection)
    setSelectedPanelIds([panelId]);
    document.dispatchEvent(new CustomEvent('board-selection-changed', { detail: { panelIds: [panelId] } }));
  }, [scale, overviewThreshold, setSelectedPanelIds]);

  // Panel pointer down handler (for touch)
  const onPanelPointerDown = useCallback((panelId: string, e: React.PointerEvent) => {
    if (scale > overviewThreshold) return;
    if (e.pointerType !== 'touch') return;
    e.stopPropagation();
    setSelectedPanelIds([panelId]);
    document.dispatchEvent(new CustomEvent('board-selection-changed', { detail: { panelIds: [panelId] } }));
  }, [scale, overviewThreshold, setSelectedPanelIds]);

  return {
    selectedPanelIds,
    setSelectedPanelIds,
    clearSelection,
    marquee,
    justMarqueeSelectAt: justMarqueeSelectAtRef.current,
    onMarqueePointerDown,
    onMarqueePointerMove,
    onMarqueePointerUp,
    onCanvasClick,
    onPanelClick,
    onPanelPointerDown,
  };
}

