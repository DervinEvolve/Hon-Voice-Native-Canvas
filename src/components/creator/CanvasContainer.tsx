/**
 * CanvasContainer - Main canvas wrapper component
 * 
 * Extracted from Creator.tsx for better code organization.
 * Handles mode switching between focus, board, and world modes.
 */

import React, { RefObject } from 'react';
import { Comic, Panel } from '../../types';
import { FocusCanvas } from './FocusCanvas';
import { BoardCanvas, BoardPosition, AlignmentGuides } from './BoardCanvas';
import { WorldMapCanvas } from './WorldMapCanvas';
import { WorldImmersiveCanvas } from './WorldImmersiveCanvas';
import { HonIndicator } from './HonIndicator';

export interface MarqueeState {
  x: number;
  y: number;
  w: number;
  h: number;
  active: boolean;
}

export interface CanvasContainerProps {
  /** Current comic data */
  currentComic: Comic | null;
  /** Current page index */
  currentPageIndex: number;
  /** Current canvas scale */
  scale: number;
  /** Current canvas position */
  position: { x: number; y: number };
  /** Whether canvas is being dragged */
  isDragging: boolean;
  /** Scale threshold for overview/board mode */
  overviewThreshold: number;
  /** Whether world mode is active */
  isWorldMode: boolean;
  /** World mode preference (map or immersive) */
  worldModePreference: 'map' | 'immersive';
  /** Board positions for each panel */
  boardPositions: Record<string, BoardPosition>;
  /** Panel scales */
  panelScales: Record<string, number>;
  /** Panel groups */
  panelGroups: Record<string, string[]>;
  /** Selected panel IDs */
  selectedPanelIds: string[];
  /** Currently dragging panel ID */
  boardDragPanelId: string | null;
  /** Alignment guides */
  alignmentGuides: AlignmentGuides;
  /** Computed layout positions (fallback) */
  computedLayout: Record<string, BoardPosition>;
  /** Notion interactive state */
  notionInteractiveIds: Record<string, boolean>;
  /** Action menu panel ID */
  actionMenuFor: string | null;
  /** Marquee state */
  marquee: MarqueeState;
  /** Hon indicator color getter */
  getIndicatorColor: () => string;
  /** Canvas ref */
  canvasRef: RefObject<HTMLDivElement>;
  /** Zoom container ref */
  zoomContainerRef: RefObject<HTMLDivElement>;
  /** Lasso container ref */
  lassoContainerRef: RefObject<HTMLDivElement>;
  /** Handler for panel update */
  onUpdatePanel: (panel: Panel, pageIndex: number) => void;
  /** Handler for panel remove */
  onRemovePanel: (panelId: string, pageIndex: number) => void;
  /** Handler for panel reorder */
  onReorderPanels: (startIndex: number, endIndex: number, pageIndex: number) => void;
  /** Handler for panel mouse down */
  onPanelMouseDown: (panelId: string, e: React.MouseEvent<HTMLDivElement>) => void;
  /** Handler for panel click */
  onPanelClick: (panelId: string, pageIndex: number, e: React.MouseEvent) => void;
  /** Handler for panel pointer down */
  onPanelPointerDown: (panelId: string, pageIndex: number, e: React.PointerEvent) => void;
  /** Handler for panel double click */
  onPanelDoubleClick: (pageIndex: number, e: React.MouseEvent) => void;
  /** Handler for opening action menu */
  onOpenActionMenu: (panelId: string) => void;
  /** Handler for setting notion interactive */
  onSetNotionInteractive: (panelId: string, interactive: boolean) => void;
  /** Handler for resize start */
  onResizeStart: (panelId: string, e: React.MouseEvent) => void;
  /** Handler for marquee pointer down */
  onMarqueePointerDown: (e: React.PointerEvent) => void;
  /** Handler for marquee pointer move */
  onMarqueePointerMove: (e: React.PointerEvent) => void;
  /** Handler for marquee pointer up */
  onMarqueePointerUp: (e: React.PointerEvent) => void;
  /** Handler for canvas click */
  onCanvasClick: (e: React.MouseEvent) => void;
  /** Handler for exiting world mode */
  onExitWorldMode: () => void;
  /** Render quick edit menu */
  renderQuickEditMenu?: (panel: Panel, pageIndex: number) => React.ReactNode;
}

export const CanvasContainer: React.FC<CanvasContainerProps> = ({
  currentComic,
  currentPageIndex,
  scale,
  position,
  isDragging,
  overviewThreshold,
  isWorldMode,
  worldModePreference,
  boardPositions,
  panelScales,
  panelGroups,
  selectedPanelIds,
  boardDragPanelId,
  alignmentGuides,
  computedLayout,
  notionInteractiveIds,
  actionMenuFor,
  marquee,
  getIndicatorColor,
  canvasRef,
  zoomContainerRef,
  lassoContainerRef,
  onUpdatePanel,
  onRemovePanel,
  onReorderPanels,
  onPanelMouseDown,
  onPanelClick,
  onPanelPointerDown,
  onPanelDoubleClick,
  onOpenActionMenu,
  onSetNotionInteractive,
  onResizeStart,
  onMarqueePointerDown,
  onMarqueePointerMove,
  onMarqueePointerUp,
  onCanvasClick,
  onExitWorldMode,
  renderQuickEditMenu,
}) => {
  const isBoardMode = scale <= overviewThreshold;

  // World mode rendering
  if (isWorldMode) {
    return (
      <div className="absolute inset-0 z-10">
        {worldModePreference === 'immersive' ? (
          <WorldImmersiveCanvas onClose={onExitWorldMode} />
        ) : (
          <WorldMapCanvas onClose={onExitWorldMode} />
        )}
      </div>
    );
  }

  return (
    <div
      ref={lassoContainerRef}
      className="absolute inset-0 overflow-hidden"
      onPointerDown={onMarqueePointerDown}
      onPointerMove={onMarqueePointerMove}
      onPointerUp={onMarqueePointerUp}
      onClick={onCanvasClick}
    >
      <div 
        ref={canvasRef}
        id="infinite-canvas"
        className="w-full h-full flex items-center justify-center"
        style={{ 
          touchAction: "none",
          cursor: isDragging ? "grabbing" : "default"
        }}
      >
        <div 
          ref={zoomContainerRef}
          id="zoom-container"
          className="relative transform-gpu"
          style={{ 
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transformOrigin: "center",
            transition: isDragging ? "none" : "transform 0.1s ease-out" 
          }}
        >
          {/* Focus Mode */}
          {!isBoardMode && (
            <FocusCanvas
              currentComic={currentComic}
              currentPageIndex={currentPageIndex}
              onUpdatePanel={onUpdatePanel}
              onRemovePanel={onRemovePanel}
              onReorderPanels={onReorderPanels}
            />
          )}

          {/* Board Mode */}
          {isBoardMode && currentComic && (
            <BoardCanvas
              currentComic={currentComic}
              currentPageIndex={currentPageIndex}
              boardPositions={boardPositions}
              panelScales={panelScales}
              panelGroups={panelGroups}
              selectedPanelIds={selectedPanelIds}
              boardDragPanelId={boardDragPanelId}
              alignmentGuides={alignmentGuides}
              computedLayout={computedLayout}
              notionInteractiveIds={notionInteractiveIds}
              actionMenuFor={actionMenuFor}
              getIndicatorColor={getIndicatorColor}
              onPanelMouseDown={onPanelMouseDown}
              onPanelClick={onPanelClick}
              onPanelPointerDown={onPanelPointerDown}
              onPanelDoubleClick={onPanelDoubleClick}
              onRemovePanel={onRemovePanel}
              onOpenActionMenu={onOpenActionMenu}
              onSetNotionInteractive={onSetNotionInteractive}
              onResizeStart={onResizeStart}
              renderQuickEditMenu={renderQuickEditMenu}
            />
          )}

          {/* Hon Indicator - inside panel grid for focus mode highlighting (hidden in world mode) */}
          <HonIndicator isOverviewMode={isBoardMode} />
        </div>
      </div>

      {/* Lasso overlay at container level */}
      {isBoardMode && marquee.active && (
        <div
          className="pointer-events-none absolute border-2 border-blue-400/70 bg-blue-400/10 rounded"
          style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
        />
      )}
    </div>
  );
};

export default CanvasContainer;

