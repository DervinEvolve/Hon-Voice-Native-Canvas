/**
 * BoardPanel - Memoized single panel component for board mode
 * 
 * Extracted from BoardCanvas for granular re-render optimization.
 * Only re-renders when its own props change.
 */

import React, { Suspense, memo } from 'react';
import { Panel } from '../../types';
import { NotionPanel } from './NotionPanel';
import { PanelProgressOverlay } from './PanelProgressOverlay';

// Lazy-load GameViewer to avoid circular import
const GameViewerLazy = React.lazy(() => import('../media/GameViewer').then(mod => ({ default: mod.GameViewer })));

export interface BoardPanelProps {
  /** The panel data */
  panel: Panel;
  /** Page index */
  pageIndex: number;
  /** Panel index within page */
  panelIndex: number;
  /** Position */
  position: { x: number; y: number };
  /** Content width */
  contentWidth: number;
  /** Content height */
  contentHeight: number;
  /** Whether panel is selected */
  isSelected: boolean;
  /** Whether panel is grouped */
  isGrouped: boolean;
  /** Generation progress (if any) */
  generationProgress?: { status: string; progress: number };
  /** Whether notion is interactive */
  notionInteractive: boolean;
  /** Whether action menu is open for this panel */
  isActionMenuOpen: boolean;
  /** Indicator color for selection */
  indicatorColor: string;
  /** Handler for mouse down */
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Handler for click */
  onClick: (e: React.MouseEvent) => void;
  /** Handler for pointer down */
  onPointerDown: (e: React.PointerEvent) => void;
  /** Handler for double click */
  onDoubleClick: (e: React.MouseEvent) => void;
  /** Handler for remove */
  onRemove: () => void;
  /** Handler for opening action menu */
  onOpenActionMenu: () => void;
  /** Handler for resize start */
  onResizeStart: (e: React.MouseEvent) => void;
  /** Render quick edit menu */
  renderQuickEditMenu?: () => React.ReactNode;
}

/**
 * Memoized panel component - only re-renders when props change
 */
export const BoardPanel = memo<BoardPanelProps>(({
  panel,
  pageIndex,
  panelIndex,
  position,
  contentWidth,
  contentHeight,
  isSelected,
  isGrouped,
  generationProgress,
  notionInteractive,
  isActionMenuOpen,
  indicatorColor,
  onMouseDown,
  onClick,
  onPointerDown,
  onDoubleClick,
  onRemove,
  onOpenActionMenu,
  onResizeStart,
  renderQuickEditMenu,
}) => {
  const p = panel;
  const isGame = p.type === 'game';
  const isNotion = p.type === 'notion';
  const is3D = p.type === '3d';
  const isPalette = p.type === 'palette';

  // GPU-accelerated positioning with will-change hint
  // Notion panels get higher z-index when interactive to appear above other panels
  const baseZIndex = isNotion ? (notionInteractive ? 200 : 50) : 10;
  
  const containerStyle: React.CSSProperties = isSelected ? {
    width: contentWidth,
    height: contentHeight,
    left: `calc(50% + ${position.x}px)`,
    top: `calc(50% + ${position.y}px)`,
    transform: 'translate3d(-50%, -50%, 0)', // GPU acceleration
    willChange: 'transform', // Hint for browser optimization
    contain: 'layout style paint', // CSS containment
    boxShadow: `0 0 40px 15px ${indicatorColor.replace('1.0', '0.5')}, 0 0 0 4px ${indicatorColor}${isGrouped ? ', 0 0 0 2px rgba(59, 130, 246, 0.6)' : ''}`,
    outline: `4px solid ${indicatorColor}`,
    borderColor: indicatorColor,
    zIndex: isNotion ? 200 : 100
  } : {
    width: contentWidth,
    height: contentHeight,
    left: `calc(50% + ${position.x}px)`,
    top: `calc(50% + ${position.y}px)`,
    transform: 'translate3d(-50%, -50%, 0)', // GPU acceleration
    willChange: 'transform',
    contain: 'layout style paint',
    zIndex: baseZIndex,
    ...(isGrouped ? {
      borderColor: 'rgba(59, 130, 246, 0.6)',
      borderWidth: '2px'
    } : {})
  };

  const containerClassName = (is3D || isPalette)
    ? `absolute overflow-visible cursor-default group`
    : isNotion
    ? `absolute rounded-xl shadow-lg bg-white/90 dark:bg-gray-800/90 overflow-visible cursor-grab border border-gray-200/50 dark:border-gray-700/50 group ${isGrouped ? 'ring-2 ring-blue-400/60' : ''}`
    : `absolute rounded-xl shadow-lg bg-white/90 dark:bg-gray-800/90 ${isSelected ? 'overflow-visible' : 'overflow-hidden'} cursor-grab border border-gray-200/50 dark:border-gray-700/50 group ${isGrouped ? 'ring-2 ring-blue-400/60' : ''}`;

  return (
    <div
      data-board-panel={p.id}
      data-panel-id={p.id}
      data-selected={isSelected ? 'true' : 'false'}
      className={containerClassName}
      style={containerStyle}
      onMouseDown={onMouseDown}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      title={is3D ? 'Drag to move • Shift+Drag to rotate' : `Page ${pageIndex + 1} • Double-click to open`}
    >
      {/* Quick actions */}
      {!isNotion && !isPalette && (
        <>
          <div 
            className={`absolute z-30 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity duration-100`} 
            style={{ left: '100%', top: 0, transform: 'translate(10px, -10px)', pointerEvents: 'auto' }}
          >
            <button
              onClick={(e) => { 
                e.stopPropagation(); 
                e.preventDefault();
                onRemove(); 
              }}
              className="mb-1 w-7 h-7 rounded-full bg-red-500 text-white text-xs shadow hover:bg-red-600 flex items-center justify-center"
              title="Remove from board"
              style={{ pointerEvents: 'auto' }}
            >
              ×
            </button>
            <button
              onClick={(e) => { 
                e.stopPropagation(); 
                e.preventDefault();
                onOpenActionMenu();
              }}
              className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-xs shadow border border-gray-300 dark:border-gray-600 hover:bg-gray-300 dark:hover:bg-gray-600 flex items-center justify-center"
              title="Quick edit"
              style={{ pointerEvents: 'auto' }}
            >
              +
            </button>
          </div>
          {isActionMenuOpen && renderQuickEditMenu?.()}
        </>
      )}

      {/* Panel content */}
      {p.url && !isGame && !is3D && !isNotion ? (
        <div className="relative w-full h-full">
          {p.type === 'video' || p.type === 'gif' ? (
            <video
              src={p.url}
              className="w-full h-full object-cover rounded-lg"
              autoPlay
              loop
              muted
              playsInline
            />
          ) : (
            <img
              src={p.url}
              alt={p.caption || ''}
              className="w-full h-full object-cover rounded-lg"
              draggable={false}
              loading="lazy" // Lazy load images for performance
            />
          )}
          {/* Progress overlay - uses panelId for store subscription */}
          <PanelProgressOverlay panelId={p.id} progress={generationProgress} />
        </div>
      ) : isGame ? (
        <Suspense fallback={<div className="w-full h-full flex items-center justify-center text-xs text-gray-500">Loading game...</div>}>
          <GameViewerLazy
            code={(p as any).gameCode || ''}
            panelId={p.id}
            className="w-full h-full rounded-lg overflow-hidden"
          />
        </Suspense>
      ) : is3D ? (
        <model-viewer
          src={p.url}
          alt={p.caption || '3D Model'}
          camera-controls
          auto-rotate
          style={{ width: '100%', height: '100%', background: 'transparent', pointerEvents: 'auto' }}
          exposure="1.0"
          shadow-intensity="0.85"
        />
      ) : isNotion ? (
        <NotionPanel 
          panelId={p.id} 
          pageId={p.url} 
          interactive={notionInteractive}
          onRemove={onRemove}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">{p.type}</div>
      )}

      {/* Resize handle */}
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onResizeStart(e);
        }}
        className="absolute bottom-1 right-1 w-5 h-5 rounded bg-gray-800/90 text-white text-[10px] flex items-center justify-center cursor-nwse-resize shadow z-20"
        title="Resize panel"
        style={{ pointerEvents: 'auto' }}
      >↘</button>

      {/* Page/panel label */}
      {!isPalette && (
        <div className="absolute bottom-2 left-2 text-[10px] font-medium px-2 py-0.5 rounded bg-black/60 text-white">
          Page {pageIndex + 1} · Panel {panelIndex + 1}
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom equality check for memoization
  // Only re-render if these specific props changed
  return (
    prevProps.panel.id === nextProps.panel.id &&
    prevProps.panel.url === nextProps.panel.url &&
    prevProps.panel.type === nextProps.panel.type &&
    prevProps.panel.caption === nextProps.panel.caption &&
    (prevProps.panel as any).gameCode === (nextProps.panel as any).gameCode &&
    prevProps.position.x === nextProps.position.x &&
    prevProps.position.y === nextProps.position.y &&
    prevProps.contentWidth === nextProps.contentWidth &&
    prevProps.contentHeight === nextProps.contentHeight &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isGrouped === nextProps.isGrouped &&
    prevProps.notionInteractive === nextProps.notionInteractive &&
    prevProps.isActionMenuOpen === nextProps.isActionMenuOpen &&
    prevProps.indicatorColor === nextProps.indicatorColor &&
    prevProps.generationProgress?.status === nextProps.generationProgress?.status &&
    prevProps.generationProgress?.progress === nextProps.generationProgress?.progress
  );
});

BoardPanel.displayName = 'BoardPanel';

export default BoardPanel;

