/**
 * usePanelDrag - Custom hook for board panel drag functionality
 * 
 * Extracted from Creator.tsx for better code organization and reusability.
 * Handles panel dragging with alignment guides and snap-to-grid.
 */

import { useState, useRef, useCallback, RefObject } from 'react';
import { Panel, Comic } from '../types';

export interface AlignmentGuides {
  x?: number;
  y?: number;
}

export interface BoardPosition {
  x: number;
  y: number;
}

export interface UsePanelDragConfig {
  /** Current canvas scale */
  scale: number;
  /** Scale threshold below which board mode is active */
  overviewThreshold?: number;
  /** Current comic data */
  currentComic: Comic | null;
  /** Panel scales map */
  panelScales: Record<string, number>;
  /** Panel groups map */
  panelGroups: Record<string, string[]>;
  /** Computed layout positions (fallback) */
  computedLayout: Record<string, BoardPosition>;
  /** Board cell width */
  cellWidth?: number;
  /** Board cell height */
  cellHeight?: number;
  /** Board item scale */
  itemScale?: number;
  /** Canvas ref for wheel blocking during drag */
  canvasRef: RefObject<HTMLDivElement>;
  /** Callback when drag completes */
  onDragComplete?: (panelId: string, panelIds: string[], oldPosition: BoardPosition, newPosition: BoardPosition) => void;
}

export interface UsePanelDragReturn {
  /** Current board positions */
  boardPositions: Record<string, BoardPosition>;
  /** Set board positions */
  setBoardPositions: React.Dispatch<React.SetStateAction<Record<string, BoardPosition>>>;
  /** Currently dragging panel ID */
  boardDragPanelId: string | null;
  /** Current alignment guides */
  alignmentGuides: AlignmentGuides;
  /** Handler for panel mouse down */
  onPanelMouseDown: (panelId: string, e: React.MouseEvent<HTMLDivElement>) => void;
  /** Ref tracking last user move time per panel */
  lastUserMoveAtRef: React.MutableRefObject<Record<string, number>>;
}

const DEFAULT_CELL_WIDTH = 307;
const DEFAULT_CELL_HEIGHT = 307;
const DEFAULT_ITEM_SCALE = 1.19;
const SNAP_THRESHOLD_BASE = 10; // pixels

/**
 * Hook for managing panel drag state with alignment guides
 */
export function usePanelDrag(config: UsePanelDragConfig): UsePanelDragReturn {
  const {
    scale,
    overviewThreshold = 0.65,
    currentComic,
    panelScales,
    panelGroups,
    computedLayout,
    cellWidth = DEFAULT_CELL_WIDTH,
    cellHeight = DEFAULT_CELL_HEIGHT,
    itemScale = DEFAULT_ITEM_SCALE,
    canvasRef,
    onDragComplete,
  } = config;

  const [boardPositions, setBoardPositions] = useState<Record<string, BoardPosition>>({});
  const [boardDragPanelId, setBoardDragPanelId] = useState<string | null>(null);
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuides>({});
  const lastUserMoveAtRef = useRef<Record<string, number>>({});

  // Build panel to group mapping
  const panelToGroup = Object.entries(panelGroups).reduce((acc, [groupId, panelIds]) => {
    panelIds.forEach(pid => { acc[pid] = groupId; });
    return acc;
  }, {} as Record<string, string>);

  const onPanelMouseDown = useCallback((panelId: string, e: React.MouseEvent<HTMLDivElement>) => {
    if (scale > overviewThreshold) return;
    e.preventDefault();
    e.stopPropagation();
    setBoardDragPanelId(panelId);

    // Check if this panel is in a group - if so, drag all panels in the group
    const groupId = panelToGroup[panelId];
    const panelsToDrag = groupId ? panelGroups[groupId] || [panelId] : [panelId];

    const currentPos = boardPositions[panelId] || computedLayout[panelId] || { x: 0, y: 0 };
    const startPos = { x: currentPos.x, y: currentPos.y };
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;

    // Store starting positions for all panels in the group
    const groupStartPositions: Record<string, BoardPosition> = {};
    panelsToDrag.forEach(pid => {
      const pos = boardPositions[pid] || computedLayout[pid] || { x: 0, y: 0 };
      groupStartPositions[pid] = { x: pos.x, y: pos.y };
    });

    const onMove = (me: MouseEvent) => {
      const dx = (me.clientX - startMouseX) / scale;
      const dy = (me.clientY - startMouseY) / scale;

      let newX = startPos.x + dx;
      let newY = startPos.y + dy;

      // Check alignment with other panels
      const guides: AlignmentGuides = {};
      const SNAP_THRESHOLD = SNAP_THRESHOLD_BASE / scale;

      if (currentComic) {
        currentComic.pages.forEach(page => {
          page.forEach((p: Panel) => {
            if (p.id === panelId) return;
            const otherPos = boardPositions[p.id] || computedLayout[p.id] || { x: 0, y: 0 };
            const otherScale = panelScales[p.id] || 1;
            const baseW = cellWidth * itemScale * otherScale;
            const baseH = cellHeight * itemScale * otherScale;
            const currentScale = panelScales[panelId] || 1;
            const currentW = cellWidth * itemScale * currentScale;
            const currentH = cellHeight * itemScale * currentScale;

            // Check horizontal alignment (centers and edges)
            if (Math.abs(newX - otherPos.x) < SNAP_THRESHOLD) {
              guides.x = otherPos.x;
              newX = otherPos.x;
            } else if (Math.abs(newX + currentW / 2 - (otherPos.x + baseW / 2)) < SNAP_THRESHOLD) {
              guides.x = otherPos.x + baseW / 2 - currentW / 2;
              newX = guides.x;
            } else if (Math.abs(newX + currentW - (otherPos.x + baseW)) < SNAP_THRESHOLD) {
              guides.x = otherPos.x + baseW - currentW;
              newX = guides.x;
            } else if (Math.abs(newX - (otherPos.x + baseW)) < SNAP_THRESHOLD) {
              guides.x = otherPos.x + baseW;
              newX = guides.x;
            }

            // Check vertical alignment (centers and edges)
            if (Math.abs(newY - otherPos.y) < SNAP_THRESHOLD) {
              guides.y = otherPos.y;
              newY = otherPos.y;
            } else if (Math.abs(newY + currentH / 2 - (otherPos.y + baseH / 2)) < SNAP_THRESHOLD) {
              guides.y = otherPos.y + baseH / 2 - currentH / 2;
              newY = guides.y;
            } else if (Math.abs(newY + currentH - (otherPos.y + baseH)) < SNAP_THRESHOLD) {
              guides.y = otherPos.y + baseH - currentH;
              newY = guides.y;
            } else if (Math.abs(newY - (otherPos.y + baseH)) < SNAP_THRESHOLD) {
              guides.y = otherPos.y + baseH;
              newY = guides.y;
            }
          });
        });
      }

      setAlignmentGuides(guides);

      // Update position for all panels in the group
      setBoardPositions(prev => {
        const next = { ...prev };
        panelsToDrag.forEach(pid => {
          const pStartPos = groupStartPositions[pid];
          if (pid === panelId) {
            next[pid] = { x: newX, y: newY };
          } else {
            // Other panels in group move by the same delta
            next[pid] = {
              x: pStartPos.x + dx,
              y: pStartPos.y + dy
            };
          }
          lastUserMoveAtRef.current[pid] = Date.now();
        });
        return next;
      });
    };

    const onUp = () => {
      setBoardDragPanelId(null);
      setAlignmentGuides({});
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);

      // Get final position and call completion callback
      const finalPos = boardPositions[panelId] || computedLayout[panelId] || { x: 0, y: 0 };
      if (startPos.x !== finalPos.x || startPos.y !== finalPos.y) {
        onDragComplete?.(panelId, panelsToDrag, startPos, finalPos);
      }
    };

    // While dragging a panel, temporarily disable wheel-zoom to avoid accidental zoom jitter
    const onWheelBlock = (w: WheelEvent) => { w.preventDefault(); };
    try {
      canvasRef.current?.addEventListener('wheel', onWheelBlock, { passive: false });
    } catch {}

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    const cleanupWheel = () => {
      try {
        canvasRef.current?.removeEventListener('wheel', onWheelBlock as any);
      } catch {}
    };
    document.addEventListener('mouseup', cleanupWheel, { once: true });
  }, [
    scale,
    overviewThreshold,
    currentComic,
    boardPositions,
    computedLayout,
    panelScales,
    panelGroups,
    panelToGroup,
    cellWidth,
    cellHeight,
    itemScale,
    canvasRef,
    onDragComplete,
  ]);

  return {
    boardPositions,
    setBoardPositions,
    boardDragPanelId,
    alignmentGuides,
    onPanelMouseDown,
    lastUserMoveAtRef,
  };
}

