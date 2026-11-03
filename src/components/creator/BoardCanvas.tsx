/**
 * BoardCanvas - Board mode panel rendering component
 * 
 * Extracted from Creator.tsx for better code organization.
 * Renders panels in a free-form board layout with drag, resize, and selection.
 */

import React, { Suspense, useCallback } from 'react';
import { Panel, Comic } from '../../types';
import { NotionPanel } from './NotionPanel';
import { PanelProgressOverlay } from './PanelProgressOverlay';
import { useComicStore } from '../../store/useComicStore';

// Lazy-load GameViewer to avoid circular import
const GameViewerLazy = React.lazy(() => import('../media/GameViewer').then(mod => ({ default: mod.GameViewer })));

export interface BoardPosition {
  x: number;
  y: number;
}

export interface AlignmentGuides {
  x?: number;
  y?: number;
}

export interface BoardCanvasProps {
  /** Current comic data */
  currentComic: Comic;
  /** Current page index */
  currentPageIndex: number;
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
  /** Hon indicator color getter */
  getIndicatorColor: () => string;
  /** Board cell width */
  cellWidth?: number;
  /** Board cell height */
  cellHeight?: number;
  /** Board item scale */
  itemScale?: number;
  /** Handler for panel mouse down */
  onPanelMouseDown: (panelId: string, e: React.MouseEvent<HTMLDivElement>) => void;
  /** Handler for panel click */
  onPanelClick: (panelId: string, pageIndex: number, e: React.MouseEvent) => void;
  /** Handler for panel pointer down */
  onPanelPointerDown: (panelId: string, pageIndex: number, e: React.PointerEvent) => void;
  /** Handler for panel double click */
  onPanelDoubleClick: (pageIndex: number, e: React.MouseEvent) => void;
  /** Handler for panel remove */
  onRemovePanel: (panelId: string, pageIndex: number) => void;
  /** Handler for opening action menu */
  onOpenActionMenu: (panelId: string) => void;
  /** Handler for setting notion interactive */
  onSetNotionInteractive: (panelId: string, interactive: boolean) => void;
  /** Handler for resize start */
  onResizeStart: (panelId: string, e: React.MouseEvent) => void;
  /** Render quick edit menu */
  renderQuickEditMenu?: (panel: Panel, pageIndex: number) => React.ReactNode;
}

const DEFAULT_CELL_WIDTH = 307;
const DEFAULT_CELL_HEIGHT = 307;
const DEFAULT_ITEM_SCALE = 1.19;

export const BoardCanvas: React.FC<BoardCanvasProps> = ({
  currentComic,
  currentPageIndex,
  boardPositions,
  panelScales,
  panelGroups,
  selectedPanelIds,
  boardDragPanelId,
  alignmentGuides,
  computedLayout,
  notionInteractiveIds,
  actionMenuFor,
  getIndicatorColor,
  cellWidth = DEFAULT_CELL_WIDTH,
  cellHeight = DEFAULT_CELL_HEIGHT,
  itemScale = DEFAULT_ITEM_SCALE,
  onPanelMouseDown,
  onPanelClick,
  onPanelPointerDown,
  onPanelDoubleClick,
  onRemovePanel,
  onOpenActionMenu,
  onSetNotionInteractive,
  onResizeStart,
  renderQuickEditMenu,
}) => {
  const panelGenerationProgress = useComicStore(s => s.panelGenerationProgress);
  const panelCloudinaryUpload = useComicStore(s => s.panelCloudinaryUpload);

  // Build panel to group mapping
  const panelToGroup = Object.entries(panelGroups).reduce((acc, [groupId, panelIds]) => {
    panelIds.forEach(pid => { acc[pid] = groupId; });
    return acc;
  }, {} as Record<string, string>);

  const getPanelScale = useCallback((panelId: string): number => {
    const rawScale = panelScales[panelId];
    return (typeof rawScale === 'number' && !isNaN(rawScale) && rawScale > 0) ? rawScale : 1;
  }, [panelScales]);

  return (
    <div className="relative">
      {currentComic.pages.map((page, pi) => (
        page.map((p, panelIndex) => {
          const pos = boardPositions[p.id] || computedLayout[p.id] || { x: 0, y: 0 };
          const baseW = cellWidth * itemScale;
          const baseH = cellHeight * itemScale;
          const panelScale = getPanelScale(p.id);
          const isGame = p.type === 'game';
          const isNotion = p.type === 'notion';
          const contentW = baseW * panelScale * (isGame ? 1.2 : 1.0);
          const contentH = baseH * panelScale * (isGame ? 1.2 : 1.0);
          const isSelected = p.type !== 'notion' && selectedPanelIds.includes(p.id);
          const isGrouped = !!panelToGroup[p.id];
          const groupId = panelToGroup[p.id];
          const groupMembers = groupId ? panelGroups[groupId] || [] : [];

          return (
            <div
              key={`board-${p.id}`}
              data-board-panel={p.id}
              data-panel-id={p.id}
              data-selected={isSelected ? 'true' : 'false'}
              className={
                (p.type === '3d' || p.type === 'palette')
                  ? `absolute overflow-visible cursor-default group`
                  : p.type === 'notion'
                  ? `absolute rounded-xl shadow-lg bg-white/90 dark:bg-gray-800/90 overflow-visible cursor-grab border border-gray-200/50 dark:border-gray-700/50 group ${isGrouped ? 'ring-2 ring-blue-400/60' : ''}`
                  : `absolute rounded-xl shadow-lg bg-white/90 dark:bg-gray-800/90 ${isSelected ? 'overflow-visible' : 'overflow-hidden'} cursor-grab border border-gray-200/50 dark:border-gray-700/50 group ${isGrouped ? 'ring-2 ring-blue-400/60' : ''}`
              }
              style={isSelected ? {
                width: contentW,
                height: contentH,
                left: `calc(50% + ${pos.x}px)`,
                top: `calc(50% + ${pos.y}px)`,
                transform: 'translate(-50%, -50%)',
                boxShadow: `0 0 40px 15px ${getIndicatorColor().replace('1.0', '0.5')}, 0 0 0 4px ${getIndicatorColor()}${isGrouped ? ', 0 0 0 2px rgba(59, 130, 246, 0.6)' : ''}`,
                outline: `4px solid ${getIndicatorColor()}`,
                borderColor: getIndicatorColor(),
                zIndex: 100
              } : {
                width: contentW,
                height: contentH,
                left: `calc(50% + ${pos.x}px)`,
                top: `calc(50% + ${pos.y}px)`,
                transform: 'translate(-50%, -50%)',
                ...(isGrouped ? {
                  borderColor: 'rgba(59, 130, 246, 0.6)',
                  borderWidth: '2px'
                } : {})
              }}
              onMouseDown={(e) => {
                if (p.type === 'game') {
                  const panel = e.currentTarget as HTMLElement;
                  if (panel.getAttribute('data-resizing') === 'true') {
                    return;
                  }
                }
                if (p.type === '3d' && e.shiftKey) {
                  return;
                }
                if (p.type === 'notion') {
                  onSetNotionInteractive(p.id, false);
                }
                onPanelMouseDown(p.id, e);
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (p.type !== 'notion') {
                  onPanelClick(p.id, pi, e);
                }
              }}
              onPointerDown={(e) => {
                if (e.pointerType !== 'touch') return;
                e.stopPropagation();
                if (p.type !== 'notion') {
                  onPanelPointerDown(p.id, pi, e);
                }
              }}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (p.type === 'notion') {
                  onSetNotionInteractive(p.id, true);
                  return;
                }
                onPanelDoubleClick(pi, e);
              }}
              title={p.type === '3d' ? 'Drag to move • Shift+Drag to rotate' : `Page ${pi + 1} • Double-click to open`}
            >
              {/* Quick actions */}
              {p.type !== 'notion' && p.type !== 'palette' && (
                <>
                  <div 
                    className={`absolute z-30 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity duration-100`} 
                    style={{ left: '100%', top: 0, transform: 'translate(10px, -10px)', pointerEvents: 'auto' }}
                  >
                    <button
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        e.preventDefault();
                        onRemovePanel(p.id, pi); 
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
                        onOpenActionMenu(p.id);
                      }}
                      className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-xs shadow border border-gray-300 dark:border-gray-600 hover:bg-gray-300 dark:hover:bg-gray-600 flex items-center justify-center"
                      title="Quick edit"
                      style={{ pointerEvents: 'auto' }}
                    >
                      +
                    </button>
                  </div>
                  {actionMenuFor === p.id && renderQuickEditMenu?.(p, pi)}
                </>
              )}

              {/* Panel content */}
              {p.url && p.type !== 'game' && p.type !== '3d' && p.type !== 'notion' ? (
                <div className="relative w-full h-full">
                  {p.type === 'video' || p.type === 'gif' ? (
                    <video
                      src={p.url}
                      className={`w-full h-full object-cover rounded-lg transition-all duration-500 ${
                        panelCloudinaryUpload[p.id] ? 'blur-md scale-[1.02]' : ''
                      }`}
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
                    />
                  )}
                  {/* Cloudinary upload blur overlay for smoother transition - no spinner, just blur */}
                  {panelCloudinaryUpload[p.id] && (
                    <div className="absolute inset-0 bg-black/10 backdrop-blur-sm rounded-lg transition-opacity duration-300" />
                  )}
                  {panelGenerationProgress[p.id] && (
                    <PanelProgressOverlay progress={panelGenerationProgress[p.id]} />
                  )}
                </div>
              ) : p.type === 'game' ? (
                <Suspense fallback={<div className="w-full h-full flex items-center justify-center text-xs text-gray-500">Loading game...</div>}>
                  <GameViewerLazy
                    code={(p as any).gameCode || ''}
                    panelId={p.id}
                    className="w-full h-full rounded-lg overflow-hidden"
                  />
                </Suspense>
              ) : p.type === '3d' ? (
                <model-viewer
                  src={p.url}
                  alt={p.caption || '3D Model'}
                  camera-controls
                  auto-rotate
                  style={{ width: '100%', height: '100%', background: 'transparent', pointerEvents: 'auto' }}
                  exposure="1.0"
                  shadow-intensity="0.85"
                />
              ) : p.type === 'notion' ? (
                <NotionPanel 
                  panelId={p.id} 
                  pageId={p.url} 
                  interactive={!!notionInteractiveIds[p.id]}
                  onRemove={() => onRemovePanel(p.id, pi)}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">{p.type}</div>
              )}

              {/* Resize handle */}
              <button
                onMouseDown={(e) => onResizeStart(p.id, e)}
                className="absolute bottom-1 right-1 w-5 h-5 rounded bg-gray-800/90 text-white text-[10px] flex items-center justify-center cursor-nwse-resize shadow z-20"
                title="Resize panel"
                style={{ pointerEvents: 'auto' }}
              >↘</button>

              {/* Page/panel label */}
              {p.type !== 'palette' && (
                <div className="absolute bottom-2 left-2 text-[10px] font-medium px-2 py-0.5 rounded bg-black/60 text-white">
                  Page {pi + 1} · Panel {panelIndex + 1}
                </div>
              )}
            </div>
          );
        })
      ))}
    </div>
  );
};

export default BoardCanvas;

