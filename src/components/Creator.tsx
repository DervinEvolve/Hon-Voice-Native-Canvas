import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Save, Send, BookOpen, PenLine, Users, Bot, MessageSquare } from 'lucide-react';
import { useComicStore } from '../store/useComicStore';
import { CreatorSideMenu } from './creator/CreatorSideMenu';
import { PanelGrid } from './creator/PanelGrid';
import { CustomCanvas } from './creator/CustomCanvas';
import { PageManager } from './creator/PageManager';
import { ConversationalAIWidget } from './common/ConversationalAIWidget';
import { UnifiedDropdown } from './creator/UnifiedDropdown';
import type { Template, Panel, Comic, Collaborator as ComicCollaborator } from '../types';
import { nanoid } from 'nanoid';
import { fluxService } from '../services/fluxService';
import { ideogramService } from '../services/ideogramService';
import { fluxDevService } from '../services/fluxDevService';
import { CollaboratorAvatars } from './creator/CollaboratorAvatars';
import { collaboratorService, Collaborator } from '../services/collaboratorService';
import { lumaService } from '../services/lumaService';
import { HonIndicator } from './creator/HonIndicator';
import { HonProcessingState } from '../types/hume';
import { NotionPanel } from './creator/NotionPanel';
import { BoardMinimap } from './creator/BoardMinimap';
import { comicTemplates } from './creator/templates';
import { boardDebug } from '../utils/boardDebug';
import { useAuth } from '../contexts/AuthContext';
import { useWallet } from '@solana/wallet-adapter-react';
import { WorldCanvas } from './creator/WorldCanvas';
import { WorldMapCanvas } from './creator/WorldMapCanvas';
import { WorldImmersiveCanvas } from './creator/WorldImmersiveCanvas';
import { canvasHistoryBus } from '../utils/canvasHistory';
import { PanelObjectTags } from './creator/PanelObjectTags';
import { SAM3MaskOverlay } from './creator/SAM3MaskOverlay';
import { useAutoSave } from '../hooks/useAutoSave';

// Helper to get canvas history bus (now just returns the imported instance)
const getCanvasHistoryBus = () => canvasHistoryBus;

// Lazy-load GameViewer to avoid circular import and ensure ESM compatibility (no require in browser)
const GameViewerLazy = React.lazy(() => import('./media/GameViewer').then(mod => ({ default: mod.GameViewer })));

// Define the ImageGeneration type
interface ImageGeneration {
  url: string;
  prompt: string;
  timestamp: Date;
  model: string;
  type: string;
  metadata?: Record<string, any>;
}

// Define the GenerationModel type (add here if not already imported)
type GenerationModel = 'flux' | 'ideogram' | 'flux-dev';

export const Creator: React.FC = () => {
  const navigate = useNavigate();
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isSavingPage, setIsSavingPage] = useState(false);
  const [selectedPanelForEdit, setSelectedPanelForEdit] = useState<Panel | null>(null);
  const [isPanelEditorOpen, setIsPanelEditorOpen] = useState(false);
  const [collaborators, setCollaborators] = useState<ComicCollaborator[]>([]);
  const [isLoadingCollaborators, setIsLoadingCollaborators] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isSideMenuCollapsed, setIsSideMenuCollapsed] = useState(false);
  
  // Infinite canvas state
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const wasInBoardRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const zoomContainerRef = useRef<HTMLDivElement>(null);
  const lassoContainerRef = useRef<HTMLDivElement>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const zoomPanDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const lastZoomPanStateRef = useRef<{ scale: number; position: { x: number; y: number } } | null>(null);
  const selectedPanelIds = useComicStore(s => s.selectedPanelIds || [], (a, b) => {
    // Custom equality check - force re-render if array contents changed
    if (a.length !== b.length) return false;
    return a.every((id, i) => id === b[i]);
  });
  const setSelectedPanelIds = useComicStore(s => s.setSelectedPanelIds);
  const clearSelection = useComicStore(s => s.clearSelection);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number; active: boolean }>({ x: 0, y: 0, w: 0, h: 0, active: false });
  
  // Debug: log whenever selectedPanelIds changes
  useEffect(() => {
    console.log('[Creator] selectedPanelIds changed:', selectedPanelIds);
  }, [selectedPanelIds]);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  // Hon indicator state for matching selection ring colors
  const [honIsActive, setHonIsActive] = useState(false);
  const [honState, setHonState] = useState<HonProcessingState>('idle');
  
  const { 
    currentComic: comicFromStore,
    currentPageIndex,
    setCurrentPageIndex,
    updatePanel, 
    removePanel, 
    reorderPanels,
    setCurrentComic,
    toggleCreatorMode,
    setShowMyComics,
    setPageTemplate,
    savePage,
    saveDraft,
    publishComic,
    addPage,
    removePage,
    captionAllCurrentPagePanels,
    recentGenerations,
    addRecentGeneration,
    init,
    isWorldMode,
    setWorldMode,
    isCreatorMode,
    worldModePreference,
    setWorldModePreference,
    setPanelGenerationProgress,
  } = useComicStore();
  
  const currentComic = comicFromStore as Comic | null;

  // Auto-save drafts to Supabase (debounced)
  useAutoSave();

  const [pageNodePositions, setPageNodePositions] = useState<Record<number, { x: number; y: number }>>({});
  const [draggingNode, setDraggingNode] = useState<number | null>(null);
  const [nodeDragLast, setNodeDragLast] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  // Board-mode (decoupled panels)
  const [boardPositions, setBoardPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [boardDragPanelId, setBoardDragPanelId] = useState<string | null>(null);
  const [boardDragLast, setBoardDragLast] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const BOARD_CELL_W = 307; // base board panel width
  const BOARD_CELL_H = 307; // base board panel height
  const BOARD_GAP = 40;
  const BOARD_ITEM_SCALE = 1.19; // base visual scale-up in board mode (non-game)
  const flipMapRef = useRef<Record<string, DOMRect>>({});
  const didBoardFitRef = useRef(false);
  const [panelScales, setPanelScales] = useState<Record<string, number>>({});
  const panelScalesRef = useRef(panelScales);
  useEffect(() => { panelScalesRef.current = panelScales; }, [panelScales]);
  const [actionMenuFor, setActionMenuFor] = useState<string | null>(null);
  const [actionPrompt, setActionPrompt] = useState<string>('');
  const [actionModel, setActionModel] = useState<'nano-banana' | 'recraft' | 'seedream' | 'flux-kontext' | 'qwen-edit' | 'ideogram'>('nano-banana');
  const [actionTargetObject, setActionTargetObject] = useState<string>(''); // Selected object for mask-based editing
  const [isQuickEditLoading, setIsQuickEditLoading] = useState(false);
  // Game panel edit state - sync with store so Hon can change it via voice
  const preferredGameModel = useComicStore(s => s.preferredGameModel);
  const setPreferredGameModel = useComicStore(s => s.setPreferredGameModel);
  // Map store model to dropdown value
  const gameEditModel = preferredGameModel === 'claude' ? 'claude' : 'gemini-3';
  const setGameEditModel = (value: 'gemini-3' | 'claude') => {
    setPreferredGameModel(value === 'claude' ? 'claude' : 'gemini');
  };
  const [savedGameTemplates, setSavedGameTemplates] = useState<Array<{ id: string; name: string; code: string; createdAt: string }>>([]);
  const [selectedGameTemplate, setSelectedGameTemplate] = useState<string>('');
  const [showSaveTemplateInput, setShowSaveTemplateInput] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [notionInteractiveIds, setNotionInteractiveIds] = useState<Record<string, boolean>>({});
  const lastUserMoveAtRef = useRef<Record<string, number>>({});
  const justMarqueeSelectAtRef = useRef<number>(0);
  
  // Alignment guides
  const [alignmentGuides, setAlignmentGuides] = useState<{ x?: number; y?: number }>({});
  
  // Panel grouping: groupId -> array of panel IDs
  const [panelGroups, setPanelGroups] = useState<Record<string, string[]>>({});
  
  // Helper function to capture complete canvas state for snapshots
  const captureCanvasState = useCallback((
    overrideComic?: Comic,
    overrideBoardPositions?: Record<string, { x: number; y: number }>,
    overridePanelScales?: Record<string, number>,
    overridePanelGroups?: Record<string, string[]>
  ): Record<string, any> => {
    const comicToUse = overrideComic || currentComic;
    if (!comicToUse) return {};
    
    // Get all panels from all pages
    const allPanels: any[] = [];
    comicToUse.pages.forEach((page, pageIndex) => {
      page.forEach(panel => {
        allPanels.push({ ...panel, _pageIndex: pageIndex });
      });
    });

    return {
      comic: {
        id: comicToUse.id,
        title: comicToUse.title,
        pages: comicToUse.pages,
        pageTemplates: comicToUse.pageTemplates,
      },
      viewport: {
        scale,
        position,
      },
      panels: allPanels,
      selectedPanelIds,
      currentPageIndex,
      boardState: {
        positions: overrideBoardPositions || boardPositions,
        panelScales: overridePanelScales || panelScales,
        panelGroups: overridePanelGroups || panelGroups,
      },
      timestamp: new Date().toISOString(),
    };
  }, [currentComic, scale, position, selectedPanelIds, currentPageIndex, boardPositions, panelScales, panelGroups]);

  // Get auth and wallet for canvas history
  const { user } = useAuth();
  const { publicKey } = useWallet();

  // Initialize canvas history when comic loads
  useEffect(() => {
    const bus = getCanvasHistoryBus();
    if (currentComic?.id) {
      const userId = user?.id || undefined;
      const walletAddress = publicKey?.toString() || currentComic.creatorWallet || undefined;
      bus.initialize(currentComic.id, userId, walletAddress);
    } else {
      bus.reset();
    }
  }, [currentComic?.id, user?.id, publicKey]);

  // Subscribe to Hon indicator updates to color-match selection rings in board mode (lazy import)
  useEffect(() => {
    let un: (() => void) | undefined;
    (async () => {
      try {
        const mod = await import('../services/humeEviService');
        un = mod.humeEviService.onVisualIndicatorChange((active: boolean, processing: HonProcessingState) => {
          setHonIsActive(active);
          setHonState(processing);
        });
      } catch (e) {
        console.warn('Hon indicator subscription failed', e);
      }
    })();
    return () => { try { un && un(); } catch {} };
  }, []);

  const getIndicatorColor = useCallback((): string => {
    switch (honState) {
      case 'generating':
        return 'rgba(139, 92, 246, 1.0)'; // Purple
      case 'editing':
        return 'rgba(34, 197, 94, 1.0)'; // Green
      case 'dreaming':
        return 'rgba(236, 72, 153, 1.0)'; // Pink
      case 'inspiring':
        return 'rgba(59, 130, 246, 1.0)'; // Blue
      case 'reasoning':
      case 'processing':
        return 'rgba(139, 92, 246, 1.0)'; // Purple
      default:
        return 'rgba(59, 130, 246, 1.0)'; // Default blue
    }
  }, [honState]);

  // Critical fix: Initialize local comic state from currentComic
  useEffect(() => {
    if (currentComic) {
      setCurrentComic(currentComic);
    }
    
    // Initialize the store to load recentGenerations from localStorage
    init();
  }, [currentComic, init]);

  // Load saved game templates from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('hon-game-templates');
      if (saved) {
        const templates = JSON.parse(saved);
        if (Array.isArray(templates)) {
          setSavedGameTemplates(templates);
        }
      }
    } catch (e) {
      console.warn('Failed to load game templates:', e);
    }
  }, []);

  // Load collaborators when the comic changes
  useEffect(() => {
    if (currentComic?.id) {
      setIsLoadingCollaborators(true);

      // Load collaborators
      collaboratorService.getCollaborators(currentComic.id)
        .then(data => {
          // Map service collaborators to ComicCollaborator type
          const mappedCollaborators: ComicCollaborator[] = data.map(collab => ({
            id: collab.id,
            username: collab.username,
            avatar_url: collab.avatar_url || collab.avatarUrl || '',
            status: collab.status || 'online'
          }));
          setCollaborators(mappedCollaborators);
        })
        .catch(error => {
          console.error('Failed to load collaborators:', error);
        })
        .finally(() => {
          setIsLoadingCollaborators(false);
        });
    } else {
      setCollaborators([]);
    }
  }, [currentComic?.id]);

  // Auto-collapse sidebar when World Mode activates
  useEffect(() => {
    if (isWorldMode) {
      setIsSideMenuCollapsed(true);
      // Notify SideMenu to collapse itself visually
      document.dispatchEvent(new CustomEvent('side-menu-set-collapsed', { detail: { collapsed: true } }));
    }
  }, [isWorldMode]);

  // Initialize canvas zoom and pan functionality
  useEffect(() => {
    if (!canvasRef.current || !zoomContainerRef.current) return;
    
    const canvas = canvasRef.current;
    const zoomContainer = zoomContainerRef.current;
    
    // Zoom with mouse wheel
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Hard-lock zoom when panel editor is open
      if (isPanelEditorOpen) return;
      const delta = -Math.sign(e.deltaY) * 0.06;
      const newScale = Math.max(0.25, Math.min(5, scale + delta));
      setScale(newScale);
      zoomContainer.style.transform = `translate(${position.x}px, ${position.y}px) scale(${newScale})`;
      
      // Debounce zoom tracking
      if (zoomPanDebounceRef.current) {
        clearTimeout(zoomPanDebounceRef.current);
      }
      zoomPanDebounceRef.current = setTimeout(() => {
        const oldScale = lastZoomPanStateRef.current?.scale || scale;
        if (Math.abs(oldScale - newScale) > 0.05) {
          getCanvasHistoryBus().emit({
            eventType: 'canvas_zoom',
            eventDescription: `Zoomed canvas to ${(newScale * 100).toFixed(0)}%`,
            eventData: {
              oldScale,
              newScale,
            },
          });
          lastZoomPanStateRef.current = { scale: newScale, position };
        }
      }, 500);
    };
    
    // Handle mouse down for panning
    const handleMouseDown = (e: MouseEvent) => {
      if (isPanelEditorOpen) return; // lock panning while editor open
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
      
      setPosition(newPosition);
      setDragStart({ x: e.clientX, y: e.clientY });
      
      // Update zoom container transform
      zoomContainer.style.transform = `translate(${newPosition.x}px, ${newPosition.y}px) scale(${scale})`;
    };
    
    // Handle mouse up to stop panning
    const handleMouseUp = () => {
      setIsDragging(false);
      
      // Track canvas pan event after panning completes
      if (lastZoomPanStateRef.current) {
        const oldPos = lastZoomPanStateRef.current.position;
        if (oldPos.x !== position.x || oldPos.y !== position.y) {
          getCanvasHistoryBus().emit({
            eventType: 'canvas_pan',
            eventDescription: 'Panned canvas',
            eventData: {
              oldPosition: oldPos,
              newPosition: position,
            },
          });
          lastZoomPanStateRef.current = { scale, position };
        }
      }
    };
    
    // Listen for custom events for zoom controls
    const handleZoomIn = () => {
      if (isPanelEditorOpen) return;
      const oldScale = scale;
      const newScale = Math.min(5, scale + 0.12);
      setScale(newScale);
      zoomContainer.style.transform = `translate(${position.x}px, ${position.y}px) scale(${newScale})`;
      
      getCanvasHistoryBus().emit({
        eventType: 'canvas_zoom',
        eventDescription: `Zoomed in to ${(newScale * 100).toFixed(0)}%`,
        eventData: { oldScale, newScale },
      });
      lastZoomPanStateRef.current = { scale: newScale, position };
    };
    
    const handleZoomOut = () => {
      if (isPanelEditorOpen) return;
      const oldScale = scale;
      const newScale = Math.max(0.25, scale - 0.12);
      setScale(newScale);
      zoomContainer.style.transform = `translate(${position.x}px, ${position.y}px) scale(${newScale})`;
      
      getCanvasHistoryBus().emit({
        eventType: 'canvas_zoom',
        eventDescription: `Zoomed out to ${(newScale * 100).toFixed(0)}%`,
        eventData: { oldScale, newScale },
      });
      lastZoomPanStateRef.current = { scale: newScale, position };
    };
    
    const handleReset = () => {
      if (isPanelEditorOpen) return;
      const oldScale = scale;
      const oldPos = position;
      setScale(1);
      setPosition({ x: 0, y: 0 });
      zoomContainer.style.transform = `translate(0px, 0px) scale(1)`;
      
      getCanvasHistoryBus().emit({
        eventType: 'canvas_zoom',
        eventDescription: 'Reset canvas zoom',
        eventData: { oldScale, newScale: 1, oldPosition: oldPos, newPosition: { x: 0, y: 0 } },
      });
      lastZoomPanStateRef.current = { scale: 1, position: { x: 0, y: 0 } };
    };
    
    // Prevent context menu on canvas to allow for better right-click handling
    const preventContextMenu = (e: MouseEvent) => {
      if (isDragging) {
        e.preventDefault();
      }
    };
    
    // Event listeners
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('contextmenu', preventContextMenu);
    
    // Custom events for zoom controls
    document.addEventListener('canvas-zoom-in', handleZoomIn as EventListener);
    document.addEventListener('canvas-zoom-out', handleZoomOut as EventListener);
    document.addEventListener('canvas-reset', handleReset as EventListener);
    
    // Initialize last zoom/pan state
    lastZoomPanStateRef.current = { scale, position };
    
    // Clean up event listeners
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('contextmenu', preventContextMenu);
      
      document.removeEventListener('canvas-zoom-in', handleZoomIn as EventListener);
      document.removeEventListener('canvas-zoom-out', handleZoomOut as EventListener);
      document.removeEventListener('canvas-reset', handleReset as EventListener);
      
      if (zoomPanDebounceRef.current) {
        clearTimeout(zoomPanDebounceRef.current);
      }
    };
  }, [scale, position, isDragging, dragStart, isPanelEditorOpen]);

  // Enable board debug logs by default for this build so you can capture logs immediately
  useEffect(() => {
    try { localStorage.setItem('hon-debug-board', '1'); } catch {}
  }, []);

  // Listen for PanelEditor open/close to toggle page manager position and hard-lock zoom
  useEffect(() => {
    const handler = (e: any) => {
      setIsPanelEditorOpen(Boolean(e?.detail?.open));
      if (e?.detail?.open) {
        // Snap to Fit view so full page is visible behind the editor
        const pageEl = document.getElementById('comic-page-container');
        if (canvasRef.current && pageEl) {
          const vw = canvasRef.current.clientWidth;
          const vh = canvasRef.current.clientHeight;
          const pw = Math.max(1, pageEl.offsetWidth);
          const ph = Math.max(1, pageEl.offsetHeight);
          const margin = 0.1;
          const fit = Math.max(0.1, Math.min(5, Math.min((vw*(1-margin))/pw, (vh*(1-margin))/ph)));
          setScale(fit);
          setPosition({ x: 0, y: 0 });
          if (zoomContainerRef.current) {
            zoomContainerRef.current.style.transform = `translate(0px, 0px) scale(${fit})`;
          }
        } else {
          setScale(1);
          setPosition({ x: 0, y: 0 });
          if (zoomContainerRef.current) {
            zoomContainerRef.current.style.transform = `translate(0px, 0px) scale(1)`;
          }
        }
      }
    };
    document.addEventListener('panel-editor-open-state', handler as EventListener);
    const enterBoard = () => {
      // Force board mode by setting scale below overviewThreshold then fitting
      const target = Math.max(0.1, overviewThreshold - 0.05);
      setScale(target);
      if (zoomContainerRef.current) {
        const t = `translate(${position.x}px, ${position.y}px) scale(${target})`;
        zoomContainerRef.current.style.transform = t;
      }
      // Allow fitView to run on next tick
      didBoardFitRef.current = false;
      setTimeout(() => {
        try { (fitView as unknown as Function)(); } catch {}
      }, 0);
    };
    document.addEventListener('enter-board-mode', enterBoard as EventListener);
    
    // Smoothly pan to show a specific panel (used by Notion panel activation)
    const panToPanel = (e: any) => {
      const panelId = e?.detail?.panelId;
      const smooth = e?.detail?.smooth !== false;
      if (!panelId || !canvasRef.current || !zoomContainerRef.current) return;
      
      // Find the panel's DOM element or position from boardPositions
      const panelPos = boardPositions[panelId];
      if (!panelPos) return; // Panel not positioned yet, skip panning
      
      const canvasRect = canvasRef.current.getBoundingClientRect();
      const viewCenterX = canvasRect.width / 2;
      const viewCenterY = canvasRect.height / 2;
      
      // Calculate where panel currently is on screen
      const currentScale = scale;
      const panelScreenX = position.x + (panelPos.x * currentScale);
      const panelScreenY = position.y + (panelPos.y * currentScale);
      
      // Check if panel is already reasonably visible (within 40% of center)
      const visibleMargin = Math.min(canvasRect.width, canvasRect.height) * 0.4;
      const distFromCenter = Math.sqrt(
        Math.pow(panelScreenX - viewCenterX, 2) + 
        Math.pow(panelScreenY - viewCenterY, 2)
      );
      
      if (distFromCenter < visibleMargin) {
        // Panel is already visible enough, don't move
        return;
      }
      
      // Calculate new position to bring panel more into view (not dead center, just visible)
      const targetX = viewCenterX - (panelPos.x * currentScale);
      const targetY = viewCenterY - (panelPos.y * currentScale) - 50; // Offset slightly up
      
      if (smooth) {
        zoomContainerRef.current.style.transition = 'transform 0.35s ease-out';
      }
      setPosition({ x: targetX, y: targetY });
      zoomContainerRef.current.style.transform = `translate(${targetX}px, ${targetY}px) scale(${currentScale})`;
      
      if (smooth) {
        setTimeout(() => {
          if (zoomContainerRef.current) zoomContainerRef.current.style.transition = '';
        }, 350);
      }
    };
    document.addEventListener('pan-to-panel', panToPanel as EventListener);
    
    const onApplyLayout = (e: any) => {
      const map = e?.detail?.positions || {};
      const force = !!e?.detail?.force;
      if (!map || typeof map !== 'object') return;
      setBoardPositions(prev => {
        const next = { ...prev } as Record<string, { x: number; y: number }>;
        Object.keys(map).forEach((id) => {
          const pos = (map as any)[id];
          if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;
          if (force) { next[id] = pos; return; }
          const last = lastUserMoveAtRef.current[id] || 0;
          if (Date.now() - last > 1200) {
            next[id] = pos; // do not override if user just moved it
          }
        });
        return next;
      });
    };
    document.addEventListener('board-layout-apply', onApplyLayout as EventListener);
    const sideMenuHandler = (e: any) => {
      const collapsed = Boolean(e?.detail?.collapsed);
      setIsSideMenuCollapsed(collapsed);
      const root = document.getElementById('infinite-canvas');
      if (root) root.style.pointerEvents = 'auto';
    };
    document.addEventListener('side-menu-collapsed', sideMenuHandler as EventListener);
    return () => {
      document.removeEventListener('panel-editor-open-state', handler as EventListener);
      document.removeEventListener('side-menu-collapsed', sideMenuHandler as EventListener);
      document.removeEventListener('enter-board-mode', enterBoard as EventListener);
      document.removeEventListener('board-layout-apply', onApplyLayout as EventListener);
      document.removeEventListener('pan-to-panel', panToPanel as EventListener);
    };
  }, [scale, position, boardPositions]);

  // Removed auto-logout of Notion on load to prevent unexpected 401s during panel activation

  // Listen for Hon take_notes tool and insert a Notion panel (forces OAuth)
  useEffect(() => {
    const onAddNotion = async (e: any) => {
      try {
        const forceAuth = !!e?.detail?.forceAuth;
        const skipPan = !!e?.detail?.skipPan; // Allow caller to skip panning
        const startFresh = !!e?.detail?.startFresh; // Clear existing pageId for blank panel
        
        if (forceAuth) {
          try { await fetch('/api/notion/logout', { method: 'POST' }); } catch {}
        }
        const { currentComic, currentPageIndex, updatePanel } = useComicStore.getState();
        let notionPanel = (currentComic?.pages[currentPageIndex] || []).find(p => p.type === 'notion');
        const isNewPanel = !notionPanel;
        
        if (!notionPanel) {
          const template = currentComic?.pageTemplates[currentPageIndex] as Template | undefined;
          // Find first empty spot to avoid overlap (prefer bottom-right)
          let pos = template?.layout?.areas?.[0]?.position || { row: 0, col: 0 };
          try {
            const used = new Set((currentComic?.pages[currentPageIndex] || []).map(p => `${p.position.row}:${p.position.col}`));
            const areas = template?.layout?.areas || [];
            for (let i = areas.length - 1; i >= 0; i--) {
              const a = areas[i]?.position;
              if (!a) continue;
              const key = `${a.row}:${a.col}`;
              if (!used.has(key)) { pos = a; break; }
            }
          } catch {}
          notionPanel = { id: nanoid(), type: 'notion', url: '', caption: '', size: 'medium', aspectRatio: 1, position: pos } as any;
          await updatePanel(notionPanel as Panel, currentPageIndex);
        } else if (startFresh && notionPanel.url) {
          // Clear existing pageId so panel starts blank
          notionPanel = { ...notionPanel, url: '' };
          await updatePanel(notionPanel as Panel, currentPageIndex);
        }
        
        // Check if already in board mode - don't switch if we are
        const isAlreadyInBoardMode = scale <= overviewThreshold;
        const needsBoardMode = !isAlreadyInBoardMode;
        
        if (needsBoardMode) {
          // Smoothly transition to board mode
          const target = Math.max(0.1, overviewThreshold - 0.05);
          setScale(target);
          if (zoomContainerRef.current) {
            zoomContainerRef.current.style.transition = 'transform 0.4s ease-out';
            zoomContainerRef.current.style.transform = `translate(${position.x}px, ${position.y}px) scale(${target})`;
            setTimeout(() => {
              if (zoomContainerRef.current) zoomContainerRef.current.style.transition = '';
            }, 400);
          }
        }
        
        // Only pan to the panel if:
        // 1. It's a newly created panel (user hasn't seen it yet)
        // 2. Caller didn't request to skip panning
        // 3. We had to switch to board mode (user was in focus mode)
        // This prevents jarring canvas movement when panel already exists and is visible
        if (!skipPan && (isNewPanel || needsBoardMode)) {
          setTimeout(() => {
            if (notionPanel?.id) {
              document.dispatchEvent(new CustomEvent('pan-to-panel', { detail: { panelId: notionPanel.id, smooth: true } }));
            }
          }, needsBoardMode ? 450 : 50);
        }
        
      } catch (err) {
        console.warn('add-notion-panel handler failed', err);
      }
    };
    document.addEventListener('add-notion-panel', onAddNotion as EventListener);
    return () => document.removeEventListener('add-notion-panel', onAddNotion as EventListener);
  // Note: overviewThreshold is constant (0.6), no need in deps
  }, [scale, position]);

  // Summarize last moodboard request into Notion bullets on first connect
  useEffect(() => {
    const onSummarize = async (e: any) => {
      try {
        const panelId = e?.detail?.panelId;
        const notionPageId = e?.detail?.pageId;
        if (!panelId || !notionPageId) return;
        // Ask service if there is a recent moodboard prompt
        const summary = await (async () => {
          try {
            const svc = (await import('../services/humeEviService')).humeEviService as any;
            const prompt = svc?.lastMoodboardPrompt || '';
            if (!prompt) return '';
            // Let GPT/Hume do a quick client-side bulleting via minimal heuristic
            return `• ${prompt.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim()}`;
          } catch { return ''; }
        })();
        if (!summary) return;
        // Drive an in-panel typing animation instead of instant save
        const bullets = summary
          .split(/\n|•/)
          .map(s => s.trim())
          .filter(Boolean);
        try {
          document.dispatchEvent(new CustomEvent('notion-type-bullets', {
            detail: { panelId, pageId: notionPageId, bullets }
          }));
        } catch {}
      } catch {}
    };
    document.addEventListener('request-notion-summarize', onSummarize as EventListener);
    return () => document.removeEventListener('request-notion-summarize', onSummarize as EventListener);
  }, []);

  // Add useEffect to log recentGenerations state when component mounts
  useEffect(() => {
    console.log('Creator component mounted, recentGenerations from store:', recentGenerations);
    console.log('Creator component mounted, recentGenerations length:', recentGenerations?.length || 0);
    
    // Check if there are existing prompts in localStorage that aren't in the store
    const stored = localStorage.getItem('recent-generations');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        console.log('Creator: Found in localStorage:', parsed);
        console.log('Creator: localStorage length:', parsed?.length || 0);
        
        // If localStorage has more prompts than the store, manually add them
        if (parsed && Array.isArray(parsed) && parsed.length > (recentGenerations?.length || 0)) {
          console.log('Creator: localStorage has more prompts than store, syncing...');
          parsed.forEach(gen => {
            if (!recentGenerations?.some(storeGen => storeGen.url === gen.url)) {
              console.log('Creator: Adding missing generation:', gen);
              addRecentGeneration({
                ...gen,
                timestamp: new Date(gen.timestamp)
              });
            }
          });
        }
      } catch (error) {
        console.warn('Creator: Failed to parse localStorage:', error);
      }
    } else {
      console.log('Creator: No recent-generations found in localStorage');
    }
    
    // Also check for the old localStorage key and migrate if needed
    const oldStored = localStorage.getItem('generatedImages');
    if (oldStored && !stored) {
      try {
        const parsed = JSON.parse(oldStored);
        console.log('Creator: Found old localStorage key "generatedImages":', parsed);
        if (parsed && Array.isArray(parsed) && parsed.length > 0) {
          console.log('Creator: Migrating from old localStorage key...');
          parsed.forEach(gen => {
            addRecentGeneration({
              url: gen.url,
              prompt: gen.prompt,
              timestamp: new Date(gen.timestamp),
              model: gen.model || 'unknown',
              type: 'image'
            });
          });
          // Remove the old key
          localStorage.removeItem('generatedImages');
          console.log('Creator: Migration complete, removed old key');
        }
      } catch (error) {
        console.warn('Creator: Failed to migrate from old localStorage:', error);
      }
    }
  }, []); // Empty dependency array to run only once
  
  // Add useEffect to log when recentGenerations changes
  useEffect(() => {
    console.log('Creator: recentGenerations changed:', recentGenerations);
    console.log('Creator: recentGenerations length:', recentGenerations?.length || 0);
  }, [recentGenerations]);

  // Add useEffect to check for duplicates when recentGenerations changes
  useEffect(() => {
    // Look for any duplicates in recentGenerations
    if (recentGenerations.length > 0) {
      const urls = recentGenerations.map(gen => gen.url);
      const uniqueUrls = new Set(urls);
      
      if (uniqueUrls.size < urls.length) {
        console.log('Creator: Detected duplicate URLs in recentGenerations, cleaning up...');
        // Remove duplicates, keeping the first occurrence
        const uniqueGenerations = recentGenerations.filter(
          (gen, index, self) => index === self.findIndex(g => g.url === gen.url)
        );
        
        if (uniqueGenerations.length !== recentGenerations.length) {
          console.log('Creator: Removed duplicates, new count:', uniqueGenerations.length);
          // The store's addRecentGeneration handles adding, so we just need to update the state
          // setRecentGenerations(uniqueGenerations); // This line is no longer needed
        }
      }
    }
  }, [recentGenerations]);

  const handlePublish = async () => {
    if (!currentComic) return;
    setIsPublishing(true);
    try {
      console.log('🔄 Publishing comic...');
      await publishComic(currentComic);
      console.log('✅ Comic published successfully');
      
      // Navigate first, then clear state - this prevents React hooks error
      // by avoiding a re-render with null currentComic before route change.
      // The entry route then opens a new empty draft.
      navigate('/');
      
      // Clear state after navigation has started
      setTimeout(() => {
        setCurrentComic(null);
        if (isCreatorMode) {
          toggleCreatorMode();
        }
        setIsPublishing(false);
      }, 100);
    } catch (error) {
      console.error('❌ Failed to publish comic:', error);
      alert('Failed to publish comic. Please try again.');
      setIsPublishing(false);
    }
  };

  const handleTemplateSelect = (template: Template) => {
    setPageTemplate(template, currentPageIndex);
  };

  const handleSavePage = async () => {
    if (!currentComic || !currentComic.pageTemplates[currentPageIndex]) return;
    setIsSavingPage(true);
    try {
      console.log('🔄 Saving page...');
      const currentPanels = currentComic.pages[currentPageIndex] || [];
      await savePage(currentPageIndex, currentPanels, currentComic.pageTemplates[currentPageIndex]);
      console.log('✅ Page saved successfully');
    } catch (error) {
      console.error('❌ Failed to save page:', error);
    } finally {
      setTimeout(() => setIsSavingPage(false), 500);
    }
  };

  const handleSaveDraft = async () => {
    if (!currentComic) return;
    setIsSaving(true);
    try {
      console.log('🔄 Saving draft...');
      await saveDraft(currentComic);
      console.log('✅ Draft saved successfully');
    } catch (error) {
      console.error('❌ Failed to save draft:', error);
    } finally {
      setTimeout(() => setIsSaving(false), 500);
    }
  };

  const handleGenerateImage = async (prompt: string, model: GenerationModel): Promise<string> => {
    setLoading(true);
    let generatedUrl = '';
    try {
      if (model === 'flux') {
        generatedUrl = await fluxService.generateImage(prompt);
      } else if (model === 'ideogram') {
        // Assuming ideogramService takes prompt and potentially options
        // You might need to pass style/aspect ratio from AIControls state if required
        generatedUrl = await ideogramService.generateImage(prompt);
      } else if (model === 'flux-dev') {
        console.log('Creator: Generating with Flux-1 Dev...');
        generatedUrl = await fluxDevService.generateImage(prompt);
        console.log('Creator: Flux-1 Dev generation successful:', generatedUrl);
      }

      // Update recent generations state
      const newGeneration: ImageGeneration = {
        url: generatedUrl,
        prompt,
        timestamp: new Date(),
        model,
        type: 'image',
      };

      console.log('Creator: About to call addRecentGeneration with:', newGeneration);
      // Add to state, preventing duplicates
      addRecentGeneration(newGeneration);
      console.log('Creator: addRecentGeneration called successfully');

      return generatedUrl;
    } catch (error) {
      console.error(`Error generating image with ${model}:`, error);
      throw error; // Re-throw to be caught by the calling component (AIControls)
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = async (prompt: string, imageUrl: string) => {
    try {
      console.log('Editing image with prompt:', prompt);
      const url = await fluxService.editImage(prompt, imageUrl);
      if (selectedPanelForEdit) {
        updatePanel({
          ...selectedPanelForEdit,
          url
        }, currentPageIndex);
      }
    } catch (error) {
      console.error('Failed to edit image:', error);
      if (error instanceof Error) {
        throw new Error(`Failed to edit image: ${error.message}`);
      } else {
        throw new Error('Failed to edit image');
      }
    }
  };

  const handleGenerateStory = async (prompt: string, generatedUrl: string, type: 'image' | 'video' | 'gif', panel?: Panel) => {
    if (!currentComic?.pageTemplates[currentPageIndex]) return;
    
    console.log('Creator: handleGenerateStory called with:', { prompt, generatedUrl, type, panel });
    
    // Add to recent generations if it's an image
    if (type === 'image') {
      const newGeneration: ImageGeneration = {
        url: generatedUrl,
        prompt,
        timestamp: new Date(),
        model: 'unknown', // Default for images from other sources
        type: 'image',
      };

      console.log('Creator: Adding to recentGenerations:', newGeneration);
      
      console.log('Creator: About to call addRecentGeneration with:', newGeneration);
      // Add to state, preventing duplicates
      addRecentGeneration(newGeneration);
      console.log('Creator: addRecentGeneration called successfully');
    }
    
    if (panel) {
      // If a panel object is provided, make sure it doesn't use the prompt as caption
      const updatedPanel = {
        ...panel,
        caption: panel.caption || '' // Ensure caption is empty or preserved if already set
      };
      console.log('Creator: Updating panel with provided panel object:', updatedPanel);
      updatePanel(updatedPanel, currentPageIndex);
    } else {
      // Create a new panel for subsequent generations
      const newPanel: Panel = {
        id: nanoid(),
        type,
        url: generatedUrl,
        size: 'medium',
        aspectRatio: 1,
        position: { row: 0, col: type === 'video' ? 2 : 1 },
        caption: '' // Always set empty caption for new panels
      };
      console.log('Creator: Creating and updating new panel:', newPanel);
      updatePanel(newPanel, currentPageIndex);
    }
  };

  const handleUpdatePanel = (panel: Panel, pageIndex: number) => {
    if (!currentComic) return;
    // Find the panel index in the current page
    const currentPage = (currentComic as Comic).pages[pageIndex] || [];
    const panelIndex = currentPage.findIndex((p: Panel) => p.id === panel.id);
    
    // If panel exists, update it; otherwise add it
    if (panelIndex !== -1) {
      const oldPanel = currentPage[panelIndex];
      updatePanel(panel, pageIndex);
      
      // Track panel update event
      getCanvasHistoryBus().emit({
        eventType: 'panel_update',
        eventDescription: `Updated panel: ${panel.type}`,
        eventData: {
          panelId: panel.id,
          pageIndex,
          oldPanel: { type: oldPanel.type, url: oldPanel.url, caption: oldPanel.caption },
          newPanel: { type: panel.type, url: panel.url, caption: panel.caption },
        },
      }).then(() => {
        // Create snapshot after panel update (using fresh state from store)
        const freshComic = useComicStore.getState().currentComic;
        if (freshComic) {
          const state = captureCanvasState(freshComic);
          // Create descriptive snapshot based on panel type
          const panelTypeLabel = panel.type === 'image' ? 'Image edited' : 
                                panel.type === 'video' ? 'Video edited' :
                                panel.type === '3d' ? '3D object edited' :
                                panel.type === 'game' ? 'Game edited' :
                                panel.type === 'text' ? 'Text edited' :
                                `Panel updated: ${panel.type}`;
          getCanvasHistoryBus().createSnapshot(state, 'auto', panelTypeLabel);
        }
      });
    } else {
      const newPanel = {
        ...panel,
        id: nanoid()
      };
      updatePanel(newPanel, pageIndex);
      
      // Track panel create event and create snapshot
      getCanvasHistoryBus().emit({
        eventType: 'panel_create',
        eventDescription: `Created panel: ${newPanel.type}`,
        eventData: {
          panelId: newPanel.id,
          pageIndex,
          panelType: newPanel.type,
        },
      }).then(() => {
        // Create snapshot after panel creation
        const freshComic = useComicStore.getState().currentComic;
        if (freshComic) {
          const state = captureCanvasState(freshComic);
          // Create descriptive snapshot based on panel type
          const panelTypeLabel = newPanel.type === 'image' ? 'Image added' : 
                                newPanel.type === 'video' ? 'Video added' :
                                newPanel.type === '3d' ? '3D object added' :
                                newPanel.type === 'game' ? 'Game added' :
                                newPanel.type === 'text' ? 'Text added' :
                                `Panel created: ${newPanel.type}`;
          getCanvasHistoryBus().createSnapshot(state, 'auto', panelTypeLabel);
        }
      });
    }
  };

  const handlePageChange = (index: number) => {
    setCurrentPageIndex(index);
  };

  const handleAddPage = () => {
    addPage();
    // Navigate to the new page
    if (currentComic) {
      setCurrentPageIndex(currentComic.pages.length);
    }
  };

  const handleDeletePage = (index: number) => {
    removePage(index);
  };

  // Wrapper for removePanel with event tracking
  const handleRemovePanel = (panelId: string, pageIndex: number) => {
    if (!currentComic) return;
    
    // Find panel before removing
    const page = currentComic.pages[pageIndex] || [];
    const panel = page.find(p => p.id === panelId);
    
    if (panel) {
      // Track panel delete event
      getCanvasHistoryBus().emit({
        eventType: 'panel_delete',
        eventDescription: `Deleted panel: ${panel.type}`,
        eventData: {
          panelId,
          pageIndex,
          panelType: panel.type,
        },
      }).then(() => {
        // Create snapshot after panel deletion (using fresh state)
        const freshComic = useComicStore.getState().currentComic;
        if (freshComic) {
          const state = captureCanvasState(freshComic);
          // Create descriptive snapshot based on panel type
          const panelTypeLabel = panel.type === 'image' ? 'Image deleted' : 
                                panel.type === 'video' ? 'Video deleted' :
                                panel.type === '3d' ? '3D object deleted' :
                                panel.type === 'game' ? 'Game deleted' :
                                panel.type === 'text' ? 'Text deleted' :
                                `Panel deleted: ${panel.type}`;
          getCanvasHistoryBus().createSnapshot(state, 'auto', panelTypeLabel);
        }
      });
    }
    
    removePanel(panelId, pageIndex);
  };

  // Add handler for captioning all panels
  const handleCaptionAllPanels = async () => {
    console.log('Adding AI captions to all panels...');
    try {
      await captionAllCurrentPagePanels();
      console.log('✅ All panels have been captioned!');
      alert('All panels have been captioned!');
    } catch (error) {
      console.error('Failed to caption some panels:', error);
      alert('Failed to caption some panels');
    }
  };

  // Handle canvas drag when PanelEditor dispatches grid-drag events
  useEffect(() => {
    const onStart = () => {
      let last = { x: 0, y: 0 };
      const onDown = (md: MouseEvent) => { last = { x: md.clientX, y: md.clientY }; };
      const onMove = (me: MouseEvent) => {
        const speed = 1.6; // increase drag sensitivity
        const dx = ((me.clientX - last.x) / scale) * speed;
        const dy = ((me.clientY - last.y) / scale) * speed;
        last = { x: me.clientX, y: me.clientY };
        const newPos = { x: position.x + dx, y: position.y + dy };
        setPosition(newPos);
        if (zoomContainerRef.current) {
          zoomContainerRef.current.style.transform = `translate(${newPos.x}px, ${newPos.y}px) scale(${scale})`;
        }
      };
      const onUp = () => {
        document.removeEventListener('mousedown', onDown);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousedown', onDown);
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
    document.addEventListener('canvas-start-primary-grid-drag', onStart as EventListener);
    return () => document.removeEventListener('canvas-start-primary-grid-drag', onStart as EventListener);
  }, [position, scale]);

  // ====== Overview Mode (show all pages as nodes when zoomed far out) ======
  const overviewThreshold = 0.6; // when scale <= this, show all pages

  // Deterministic jitter generator (must be defined before layout functions that use it)
  const seeded01 = (id: string, salt: number) => {
    let h = 2166136261 ^ salt;
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
    h += h << 13; h ^= h >>> 7; h += h << 3; h ^= h >>> 17; h += h << 5;
    return ((h >>> 0) % 1000) / 1000;
  };

  // Helper to apply layout and reset state
  const applyLayoutAndReset = useCallback((posMap: Record<string, { x: number; y: number }>) => {
    try { document.dispatchEvent(new CustomEvent('board-layout-apply', { detail: { positions: posMap, force: true } })); } catch {}
    try { (fitView as unknown as Function)(); } catch {}
    try { requestAnimationFrame(() => { try { (fitView as unknown as Function)(); } catch {} }); } catch {}
    try { setTimeout(() => { try { (fitView as unknown as Function)(); } catch {} }, 60); } catch {}
    try { setBoardDragPanelId(null); } catch {}
    try { setSelectedPanelIds([]); document.dispatchEvent(new CustomEvent('board-selection-changed', { detail: { panelIds: [] } })); } catch {}
    try { setActionMenuFor(null); } catch {}
    try { setNotionInteractiveIds({}); } catch {}
    try { const ae = document.activeElement as HTMLElement | null; ae && ae.blur && ae.blur(); } catch {}
  }, []);

  // Helper to collect all panel IDs from all pages
  const getAllPanelIds = useCallback((): string[] => {
    if (!currentComic) return [];
    const ids: string[] = [];
    currentComic.pages.forEach(page => {
      page.forEach(p => {
        if (p && p.type !== 'palette' && p.type !== 'notion') {
          ids.push(p.id);
        }
      });
    });
    return ids;
  }, [currentComic?.id, currentComic?.pages.length]);

  // Arrange ALL board panels (from ALL pages) into centered 3xN grid
  const arrangeBoardGrid = useCallback(() => {
    if (scale > overviewThreshold || !currentComic) return;
    const ids = getAllPanelIds();
    if (ids.length === 0) return;
    
    const cols = 3; 
    const spacingX = BOARD_CELL_W * BOARD_ITEM_SCALE + 24;
    const spacingY = BOARD_CELL_H * BOARD_ITEM_SCALE + 24;
    const halfW = Math.ceil(Math.min(ids.length, cols) / 2) - 0.5;
    const halfH = Math.ceil(Math.ceil(ids.length / cols) / 2) - 0.5;
    const posMap: Record<string, { x: number; y: number }> = {};
    ids.forEach((id, idx) => {
      const r = Math.floor(idx / cols), c = idx % cols;
      posMap[id] = { x: (c - halfW) * spacingX, y: (r - halfH) * spacingY };
    });
    applyLayoutAndReset(posMap);
    
    // Create snapshot with layout description
    setTimeout(() => {
      const state = captureCanvasState(undefined, posMap);
      getCanvasHistoryBus().createSnapshot(state, 'auto', 'Arrange Grid');
    }, 100);
  }, [scale, overviewThreshold, getAllPanelIds, applyLayoutAndReset, captureCanvasState]);

  // Timeline layout: horizontal chronological arrangement
  const arrangeTimeline = useCallback(() => {
    if (scale > overviewThreshold || !currentComic) return;
    const ids = getAllPanelIds();
    if (ids.length === 0) return;
    
    const spacingX = BOARD_CELL_W * BOARD_ITEM_SCALE + 40;
    const startX = -((ids.length - 1) * spacingX) / 2;
    const posMap: Record<string, { x: number; y: number }> = {};
    ids.forEach((id, idx) => {
      posMap[id] = { x: startX + idx * spacingX, y: 0 };
    });
    applyLayoutAndReset(posMap);
    
    // Create snapshot with layout description
    setTimeout(() => {
      const state = captureCanvasState(undefined, posMap);
      getCanvasHistoryBus().createSnapshot(state, 'auto', 'Timeline layout');
    }, 100);
  }, [scale, overviewThreshold, getAllPanelIds, applyLayoutAndReset, captureCanvasState]);

  // Storyboard layout: traditional 2-row grid
  const arrangeStoryboard = useCallback(() => {
    if (scale > overviewThreshold || !currentComic) return;
    const ids = getAllPanelIds();
    if (ids.length === 0) return;
    
    const cols = Math.ceil(ids.length / 2);
    const spacingX = BOARD_CELL_W * BOARD_ITEM_SCALE + 32;
    const spacingY = BOARD_CELL_H * BOARD_ITEM_SCALE + 32;
    const halfW = (cols - 1) * spacingX / 2;
    const halfH = spacingY / 2;
    const posMap: Record<string, { x: number; y: number }> = {};
    ids.forEach((id, idx) => {
      const row = Math.floor(idx / cols);
      const col = idx % cols;
      posMap[id] = { 
        x: col * spacingX - halfW, 
        y: row * spacingY - halfH 
      };
    });
    applyLayoutAndReset(posMap);
    
    // Create snapshot with layout description
    setTimeout(() => {
      const state = captureCanvasState(undefined, posMap);
      getCanvasHistoryBus().createSnapshot(state, 'auto', 'Storyboard layout');
    }, 100);
  }, [scale, overviewThreshold, getAllPanelIds, applyLayoutAndReset, captureCanvasState]);

  // Cluster layout: grouped with padding, more organic spacing
  const arrangeCluster = useCallback(() => {
    if (scale > overviewThreshold || !currentComic) return;
    const ids = getAllPanelIds();
    if (ids.length === 0) return;
    
    const spacing = BOARD_CELL_W * BOARD_ITEM_SCALE + 48;
    const cols = Math.ceil(Math.sqrt(ids.length));
    const rows = Math.ceil(ids.length / cols);
    const halfW = ((cols - 1) * spacing) / 2;
    const halfH = ((rows - 1) * spacing) / 2;
    const posMap: Record<string, { x: number; y: number }> = {};
    ids.forEach((id, idx) => {
      const row = Math.floor(idx / cols);
      const col = idx % cols;
      // Add slight jitter for organic feel
      const jitterX = (seeded01(id, 1) - 0.5) * spacing * 0.15;
      const jitterY = (seeded01(id, 2) - 0.5) * spacing * 0.15;
      posMap[id] = { 
        x: col * spacing - halfW + jitterX, 
        y: row * spacing - halfH + jitterY 
      };
    });
    applyLayoutAndReset(posMap);
    
    // Create snapshot with layout description
    setTimeout(() => {
      const state = captureCanvasState(undefined, posMap);
      getCanvasHistoryBus().createSnapshot(state, 'auto', 'Cluster layout');
    }, 100);
  }, [scale, overviewThreshold, getAllPanelIds, seeded01, applyLayoutAndReset, captureCanvasState]);

  // Helper to group panels by similarity using SAM3 embeddings
  // Now fetches embeddings from Supabase instead of panel.embedding
  const groupPanelsBySimilarity = useCallback(async (panelIds: string[], threshold: number = 0.7): Promise<string[][]> => {
    if (!currentComic) return [panelIds]; // Fallback: single group
    
    // Collect image panels and fetch embeddings from Supabase
    const { getEmbedding } = await import('../services/panelEmbeddingService');
    const panelsWithEmbeddings: Array<{ id: string; embedding: string }> = [];
    
    for (const id of panelIds) {
      for (let pi = 0; pi < currentComic.pages.length; pi++) {
        const panel = currentComic.pages[pi].find(p => p.id === id);
        if (panel && panel.type === 'image' && panel.url) {
          // Fetch embedding from Supabase
          try {
            const embedding = await getEmbedding(panel.id, panel.url);
            if (embedding) {
              panelsWithEmbeddings.push({ id, embedding });
              break;
            }
          } catch (err) {
            console.warn(`[arrangeSimilar] Failed to fetch embedding for panel ${id}:`, err);
          }
        }
      }
    }

    // If no embeddings, return single group
    if (panelsWithEmbeddings.length < 2) {
      return [panelIds];
    }

    // Group panels by similarity
    const groups: string[][] = [];
    const used = new Set<string>();

    for (const panel of panelsWithEmbeddings) {
      if (used.has(panel.id)) continue;

      const group = [panel.id];
      used.add(panel.id);

      // Find similar panels
      for (const other of panelsWithEmbeddings) {
        if (used.has(other.id) || panel.id === other.id) continue;

        try {
          const { calculateSimilarity } = await import('../services/sam3EmbeddingService');
          const similarity = calculateSimilarity(panel.embedding, other.embedding);
          
          if (similarity >= threshold) {
            group.push(other.id);
            used.add(other.id);
          }
        } catch (err) {
          console.warn('[arrangeSimilar] Error calculating similarity:', err);
        }
      }

      groups.push(group);
    }

    // Add panels without embeddings to a separate group
    const panelsWithoutEmbeddings = panelIds.filter(id => !used.has(id));
    if (panelsWithoutEmbeddings.length > 0) {
      groups.push(panelsWithoutEmbeddings);
    }

    return groups;
  }, [currentComic]);

  // Arrange similar panels in groups, then apply layout to each group
  const arrangeSimilarPanels = useCallback(async (baseLayoutType: 'grid' | 'timeline' | 'storyboard' | 'cluster' = 'grid') => {
    if (scale > overviewThreshold || !currentComic) return;
    const ids = getAllPanelIds();
    if (ids.length === 0) return;

    // Group panels by similarity
    const groups = await groupPanelsBySimilarity(ids, 0.7);
    
    if (groups.length === 0) {
      console.warn('[arrangeSimilar] No groups found');
      return;
    }

    const posMap: Record<string, { x: number; y: number }> = {};
    const groupSpacing = BOARD_CELL_W * BOARD_ITEM_SCALE * 4; // Large spacing between groups
    let currentX = 0;
    let maxY = 0;

    // Arrange each group
    for (const group of groups) {
      if (group.length === 0) continue;

      let groupPositions: Record<string, { x: number; y: number }> = {};
      const spacingX = BOARD_CELL_W * BOARD_ITEM_SCALE + 24;
      const spacingY = BOARD_CELL_H * BOARD_ITEM_SCALE + 24;

      if (baseLayoutType === 'grid') {
        const cols = Math.min(3, group.length);
        const rows = Math.ceil(group.length / cols);
        const halfW = Math.ceil(Math.min(group.length, cols) / 2) - 0.5;
        const halfH = Math.ceil(rows / 2) - 0.5;
        group.forEach((id, idx) => {
          const r = Math.floor(idx / cols);
          const c = idx % cols;
          groupPositions[id] = { 
            x: (c - halfW) * spacingX, 
            y: (r - halfH) * spacingY 
          };
        });
      } else if (baseLayoutType === 'timeline') {
        const startX = -((group.length - 1) * spacingX) / 2;
        group.forEach((id, idx) => {
          groupPositions[id] = { x: startX + idx * spacingX, y: 0 };
        });
      } else if (baseLayoutType === 'storyboard') {
        const cols = Math.ceil(group.length / 2);
        const halfW = (cols - 1) * spacingX / 2;
        const halfH = spacingY / 2;
        group.forEach((id, idx) => {
          const row = Math.floor(idx / cols);
          const col = idx % cols;
          groupPositions[id] = { 
            x: col * spacingX - halfW, 
            y: row * spacingY - halfH 
          };
        });
      } else if (baseLayoutType === 'cluster') {
        const cols = Math.ceil(Math.sqrt(group.length));
        const rows = Math.ceil(group.length / cols);
        const halfW = ((cols - 1) * spacingX) / 2;
        const halfH = ((rows - 1) * spacingY) / 2;
        group.forEach((id, idx) => {
          const row = Math.floor(idx / cols);
          const col = idx % cols;
          const jitterX = (seeded01(id, 1) - 0.5) * spacingX * 0.15;
          const jitterY = (seeded01(id, 2) - 0.5) * spacingY * 0.15;
          groupPositions[id] = { 
            x: col * spacingX - halfW + jitterX, 
            y: row * spacingY - halfH + jitterY 
          };
        });
      }

      // Calculate group bounds
      const groupBounds = Object.values(groupPositions).reduce((acc, pos) => {
        return {
          minX: Math.min(acc.minX, pos.x),
          maxX: Math.max(acc.maxX, pos.x),
          minY: Math.min(acc.minY, pos.y),
          maxY: Math.max(acc.maxY, pos.y)
        };
      }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

      const groupWidth = groupBounds.maxX - groupBounds.minX;
      const groupHeight = groupBounds.maxY - groupBounds.minY;

      // Position group relative to current X position
      Object.entries(groupPositions).forEach(([id, pos]) => {
        posMap[id] = {
          x: currentX + pos.x - groupBounds.minX - groupWidth / 2,
          y: pos.y
        };
      });

      // Move to next group position
      currentX += groupWidth + groupSpacing;
      maxY = Math.max(maxY, groupHeight);
    }

    applyLayoutAndReset(posMap);

    // Create snapshot
    setTimeout(() => {
      const state = captureCanvasState(undefined, posMap);
      getCanvasHistoryBus().createSnapshot(state, 'auto', `Similar panels (${baseLayoutType})`);
    }, 100);
  }, [scale, overviewThreshold, getAllPanelIds, groupPanelsBySimilarity, seeded01, applyLayoutAndReset, captureCanvasState]);

  // Back-compat: handle custom events if emitted elsewhere (e.g., from Hon voice commands)
  useEffect(() => {
    const gridHandler = () => arrangeBoardGrid();
    const timelineHandler = () => arrangeTimeline();
    const storyboardHandler = () => arrangeStoryboard();
    const clusterHandler = () => arrangeCluster();
    
    // Similarity-based arrangement handlers
    const similarGridHandler = (e: any) => {
      arrangeSimilarPanels('grid');
    };
    const similarTimelineHandler = (e: any) => {
      arrangeSimilarPanels('timeline');
    };
    const similarStoryboardHandler = (e: any) => {
      arrangeSimilarPanels('storyboard');
    };
    const similarClusterHandler = (e: any) => {
      arrangeSimilarPanels('cluster');
    };
    
    document.addEventListener('board-arrange-grid', gridHandler as EventListener);
    document.addEventListener('board-arrange-timeline', timelineHandler as EventListener);
    document.addEventListener('board-arrange-storyboard', storyboardHandler as EventListener);
    document.addEventListener('board-arrange-cluster', clusterHandler as EventListener);
    document.addEventListener('board-arrange-similar-grid', similarGridHandler as EventListener);
    document.addEventListener('board-arrange-similar-timeline', similarTimelineHandler as EventListener);
    document.addEventListener('board-arrange-similar-storyboard', similarStoryboardHandler as EventListener);
    document.addEventListener('board-arrange-similar-cluster', similarClusterHandler as EventListener);
    
    return () => {
      document.removeEventListener('board-arrange-grid', gridHandler as EventListener);
      document.removeEventListener('board-arrange-timeline', timelineHandler as EventListener);
      document.removeEventListener('board-arrange-storyboard', storyboardHandler as EventListener);
      document.removeEventListener('board-arrange-cluster', clusterHandler as EventListener);
      document.removeEventListener('board-arrange-similar-grid', similarGridHandler as EventListener);
      document.removeEventListener('board-arrange-similar-timeline', similarTimelineHandler as EventListener);
      document.removeEventListener('board-arrange-similar-storyboard', similarStoryboardHandler as EventListener);
      document.removeEventListener('board-arrange-similar-cluster', similarClusterHandler as EventListener);
    };
  }, [arrangeBoardGrid, arrangeTimeline, arrangeStoryboard, arrangeCluster, arrangeSimilarPanels]);


  // Restore canvas from snapshot
  const handleRestoreSnapshot = useCallback(async (snapshotId: string) => {
    try {
      const snapshot = await getCanvasHistoryBus().getSnapshot(snapshotId);
      if (!snapshot || !snapshot.canvasState) {
        console.error('[Creator] Invalid snapshot');
        return;
      }

      const state = snapshot.canvasState;
      
      // Restore comic state
      if (state.comic && currentComic) {
        setCurrentComic({
          ...currentComic,
          pages: state.comic.pages || currentComic.pages,
          pageTemplates: state.comic.pageTemplates || currentComic.pageTemplates,
        });
      }

      // Restore viewport
      if (state.viewport) {
        setScale(state.viewport.scale || scale);
        setPosition(state.viewport.position || position);
      }

      // Restore page index
      if (state.currentPageIndex !== undefined) {
        setCurrentPageIndex(state.currentPageIndex);
      }

      // Restore board state (positions, scales, groups)
      if (state.boardState) {
        if (state.boardState.positions) {
          setBoardPositions(state.boardState.positions);
        }
        if (state.boardState.panelScales) {
          setPanelScales(state.boardState.panelScales);
        }
        if (state.boardState.panelGroups) {
          setPanelGroups(state.boardState.panelGroups);
        }
      }

      // Restore immersive scene state if present
      if (state.immersiveScene) {
        try {
          const { useImmersiveSceneStore } = await import('../store/immersiveSceneStore');
          const immersiveStore = useImmersiveSceneStore.getState();
          
          // Clear existing objects first
          immersiveStore.clearObjects();
          
          // Restore environment settings
          if (state.immersiveScene.environment) {
            immersiveStore.setEnvironment(state.immersiveScene.environment);
          }
          
          // Restore objects
          if (state.immersiveScene.objects && Array.isArray(state.immersiveScene.objects)) {
            for (const obj of state.immersiveScene.objects) {
              // Add each object back to the scene
              // The addObject function will generate new IDs, which is fine
              // since we're recreating the scene state
              immersiveStore.addObject({
                type: obj.type,
                primitiveType: obj.primitiveType,
                modelUrl: obj.modelUrl,
                modelPrompt: obj.modelPrompt,
                lightType: obj.lightType,
                effectType: obj.effectType,
                position: obj.position,
                rotation: obj.rotation,
                scale: obj.scale,
                color: obj.color,
                emissive: obj.emissive,
                emissiveIntensity: obj.emissiveIntensity,
                metalness: obj.metalness,
                roughness: obj.roughness,
                opacity: obj.opacity,
                intensity: obj.intensity,
                range: obj.range,
                animation: obj.animation,
                name: obj.name,
                createdBy: obj.createdBy,
              });
            }
          }
          
          // Restore camera position if present
          if (state.immersiveScene.camera) {
            immersiveStore.updateCamera(state.immersiveScene.camera);
          }
          
          console.log('[Creator] Immersive scene restored:', {
            objectCount: state.immersiveScene.objects?.length || 0,
            hasEnvironment: !!state.immersiveScene.environment,
            hasCamera: !!state.immersiveScene.camera,
          });
          
          // If we're restoring an immersive scene snapshot, switch to world mode
          if (state.isWorldMode && !isWorldMode) {
            setWorldMode(true);
            setWorldModePreference('immersive');
          }
        } catch (immersiveError) {
          console.error('[Creator] Failed to restore immersive scene:', immersiveError);
        }
      }

      // Emit restore event
      await getCanvasHistoryBus().emit({
        eventType: 'restore_point',
        eventDescription: `Restored to snapshot: ${snapshot.description || snapshotId.slice(0, 8)}`,
        eventData: { snapshotId, snapshotType: snapshot.snapshotType },
      });

      // Create snapshot of restored state
      const restoredState = captureCanvasState();
      await canvasHistoryBus.createSnapshot(
        restoredState,
        'restore_point',
        `Restored to: ${snapshot.description || snapshotId.slice(0, 8)}`,
        undefined,
        snapshot.conversationId,
        `Restored canvas state`
      );

      console.log('[Creator] Canvas restored from snapshot:', snapshotId);
    } catch (error) {
      console.error('[Creator] Failed to restore snapshot:', error);
    }
  }, [currentComic, scale, position, setCurrentComic, setCurrentPageIndex, captureCanvasState, isWorldMode, setWorldMode, setWorldModePreference]);
  
  // Reverse lookup: panelId -> groupId
  const panelToGroup = useMemo(() => {
    const map: Record<string, string> = {};
    Object.entries(panelGroups).forEach(([groupId, panelIds]) => {
      panelIds.forEach(panelId => {
        map[panelId] = groupId;
      });
    });
    return map;
  }, [panelGroups]);

  useEffect(() => {
    const onScale = (e: any) => {
      const id = e?.detail?.id; const scaleVal = Number(e?.detail?.scale || 1);
      if (!id || !Number.isFinite(scaleVal)) return;
      
      const newScale = Math.max(0.5, Math.min(4.0, scaleVal));
      
      setPanelScales(prev => {
        const oldScale = prev[id] || 1;
        
        // Track panel resize event (only if scale actually changed significantly)
        if (Math.abs(oldScale - newScale) > 0.01) {
          // Use setTimeout to avoid side-effects during render/state-update
          setTimeout(() => {
            getCanvasHistoryBus().emit({
              eventType: 'panel_resize',
              eventDescription: `Resized panel`,
              eventData: {
                panelId: id,
                oldScale,
                newScale,
                pageIndex: currentPageIndex,
              },
            }).then(() => {
              // Snapshot with new scale, using ref for latest other scales
              const currentScales = panelScalesRef.current;
              const overrides = { ...currentScales, [id]: newScale };
              const state = captureCanvasState(undefined, undefined, overrides);
              getCanvasHistoryBus().createSnapshot(state, 'auto', 'Panel resized');
            });
          }, 0);
        }
        
        return { ...prev, [id]: newScale };
      });
    };
    document.addEventListener('panel-scale-set', onScale as EventListener);
    return () => document.removeEventListener('panel-scale-set', onScale as EventListener);
  }, [currentPageIndex, captureCanvasState]);

  // Always recenter on mode transitions to prevent content drifting off-screen
  useEffect(() => {
    const inBoard = scale <= overviewThreshold;
    
    // Expose board mode state to window for external tools (e.g., HumeEviService notion_action)
    (window as any).__isInBoardMode = inBoard;
    
    // Entering board mode → fit all panels to view and center
    if (inBoard && !wasInBoardRef.current) {
      // Emit view mode change event
      getCanvasHistoryBus().emit({
        eventType: 'view_mode_change',
        eventDescription: 'Switched to Board View',
        eventData: { mode: 'board', scale }
      }).then(() => {
        const state = captureCanvasState();
        getCanvasHistoryBus().createSnapshot(state, 'auto', 'Switched to Board View');
      });

      // Defer to next frame so DOM is ready
      setTimeout(() => {
        // Re-check in case scale changed during timeout
        if (scale <= overviewThreshold) {
          fitView();
        }
      }, 0);
    }
    // Leaving board mode → center page grid at current zoom
    if (!inBoard && wasInBoardRef.current) {
      // Emit view mode change event
      getCanvasHistoryBus().emit({
        eventType: 'view_mode_change',
        eventDescription: 'Switched to Focus View',
        eventData: { mode: 'focus', scale }
      }).then(() => {
        const state = captureCanvasState();
        getCanvasHistoryBus().createSnapshot(state, 'auto', 'Switched to Focus View');
      });

      setPosition({ x: 0, y: 0 });
      if (zoomContainerRef.current) {
        zoomContainerRef.current.style.transform = `translate(0px, 0px) scale(${scale})`;
      }
    }
    wasInBoardRef.current = inBoard;
    // Intentionally omit fitView from deps to avoid early reference before declaration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, overviewThreshold]);
  
  // Refit shortly after an explicit external layout apply, never during simple drags
  const lastLayoutApplyAtRef = React.useRef<number>(0);
  useEffect(() => {
    const onApplied = () => { lastLayoutApplyAtRef.current = (typeof performance !== 'undefined' ? performance.now() : Date.now()); };
    document.addEventListener('board-layout-apply', onApplied as EventListener);
    return () => document.removeEventListener('board-layout-apply', onApplied as EventListener);
  }, []);
  useEffect(() => {
    if (scale > overviewThreshold) return;
    if (boardDragPanelId) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - lastLayoutApplyAtRef.current > 350) return; // only refit right after an explicit layout apply
    const id = requestAnimationFrame(() => {
      try { (fitView as unknown as Function)(); } catch {}
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardPositions, boardDragPanelId]);
  
  // Build stable list of all panel ids in page order (for layout)
  const allPanelIds = React.useMemo(() => {
    if (!currentComic) return [] as string[];
    const ids: string[] = [];
    currentComic.pages.forEach(page => page.forEach(p => ids.push(p.id)));
    return ids;
  }, [currentComic?.id, currentComic?.pages.length]);
  
  // Compute default non-overlapping positions immediately (used as fallback before state fills)
  const computedLayout = React.useMemo(() => {
    const count = allPanelIds.length;
    if (!count) return {} as Record<string, { x: number; y: number }>;
    const cellW = BOARD_CELL_W + BOARD_GAP;
    const cellH = BOARD_CELL_H + BOARD_GAP;
    const cols = Math.max(3, Math.ceil(Math.sqrt(count)));
    const rows = Math.ceil(count / cols);
    const startX = -((cols - 1) * cellW) / 2;
    const startY = -((rows - 1) * cellH) / 2;
    const jitterX = Math.min(BOARD_GAP * 0.3, BOARD_CELL_W * 0.15);
    const jitterY = Math.min(BOARD_GAP * 0.3, BOARD_CELL_H * 0.15);
    const pos: Record<string, { x: number; y: number }> = {};
    allPanelIds.forEach((id, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const jx = (seeded01(id, 1) - 0.5) * jitterX;
      const jy = (seeded01(id, 2) - 0.5) * jitterY;
      pos[id] = { x: startX + col * cellW + jx, y: startY + row * cellH + jy };
    });
    return pos;
  }, [allPanelIds]);

  // Global ordinal labels for board mode: Image N / Video N
  const boardOrdinals = React.useMemo(() => {
    if (!currentComic) return {} as Record<string, { label: string; index: number }>;
    const map: Record<string, { label: string; index: number }> = {};
    let img = 0; let vid = 0;
    currentComic.pages.forEach(page => {
      page.forEach(p => {
        if (!p || p.type === 'palette' || p.type === 'notion') return;
        if (p.type === 'video') { vid += 1; map[p.id] = { label: `Video ${vid}`, index: vid }; }
        else { img += 1; map[p.id] = { label: `Image ${img}`, index: img }; }
      });
    });
    return map;
  }, [currentComic?.id, currentComic?.pages.length]);

  // Ensure pages auto-expand and distribute content panels (one per page, Featured template)
  useEffect(() => {
    if (!currentComic) return;
    if (scale > overviewThreshold) return; // only organize in board mode
    const isContent = (p: Panel) => p && p.type !== 'palette' && p.type !== 'notion' && (p.type === 'image' || p.type === 'video' || p.type === 'gif' || p.type === '3d');
    const flat: Array<{ panel: Panel; from: number }>= [];
    currentComic.pages.forEach((page, pi) => page.forEach(p => { if (isContent(p)) flat.push({ panel: p, from: pi }); }));
    if (flat.length === 0) return;

    // Check if already one content per page with Featured template
    let already = currentComic.pages.length === flat.length;
    if (already) {
      for (let i = 0; i < currentComic.pages.length; i++) {
        const contents = (currentComic.pages[i] || []).filter(isContent);
        if (contents.length !== 1) { already = false; break; }
      }
    }
    if (already) return;

    const featured = { id: 'featured', name: 'Featured Panel', description: 'Single large panel', icon: 'maximize', layout: { rows: 2, cols: 2, areas: [ { size: 'large', position: { row: 0, col: 0, rowSpan: 2, colSpan: 2 } } ] } } as any;

    const newPages: Panel[][] = [];
    const newTemplates: (Template | null)[] = [];
    flat.forEach(({ panel }) => { newPages.push([panel]); newTemplates.push(featured); });

    // Preserve any existing palette and notion panels without allocating extra pages.
    // Keep them on the first page for board mode only (PanelGrid hides 'palette' in focus; Notion stays visible).
    try {
      const palettePanels: Panel[] = [];
      const notionPanels: Panel[] = [];
      currentComic.pages.forEach(page => page.forEach(p => {
        if (!p) return;
        if (p.type === 'palette') palettePanels.push(p);
        if (p.type === 'notion') notionPanels.push(p);
      }));
      if (!newPages.length) newPages.push([]);
      if (palettePanels.length) newPages[0] = [...palettePanels, ...newPages[0]];
      if (notionPanels.length) newPages[0] = [...notionPanels, ...newPages[0]];
    } catch {}

    setCurrentComic({ ...currentComic, pages: newPages, pageTemplates: newTemplates, lastModified: new Date() } as Comic);
  }, [currentComic?.id, currentComic?.pages.length, scale, overviewThreshold, setCurrentComic]);

  const handleQuickEdit = useCallback(async (panel: Panel) => {
    if (isQuickEditLoading) return; // Prevent multiple simultaneous edits
    setIsQuickEditLoading(true);
    try {
      if (!panel || !panel.url) return;
      
      // Find which page this panel is on (board mode can show panels from all pages)
      let panelPageIndex = currentPageIndex;
      if (currentComic) {
        for (let pi = 0; pi < currentComic.pages.length; pi++) {
          if (currentComic.pages[pi].some(p => p.id === panel.id)) {
            panelPageIndex = pi;
            break;
          }
        }
      }
      
      // Enhance prompt with detected objects for context-aware editing
      let enhancedPrompt = actionPrompt || 'enhance details';
      if (panel.detectedObjects && panel.detectedObjects.length > 0) {
        const objectsContext = panel.detectedObjects.slice(0, 5).join(', ');
        if (!actionPrompt) {
          // If no prompt provided, use detected objects as context
          enhancedPrompt = `enhance details, preserve: ${objectsContext}`;
        } else {
          // If prompt provided, append detected objects for context
          enhancedPrompt = `${actionPrompt} (context: ${objectsContext})`;
        }
      }
      
      let resultUrl = '';
      console.log('[Quick Edit] Starting edit with model:', actionModel, 'prompt:', enhancedPrompt);
      if (actionModel === 'nano-banana') {
        const mod = await import('../services/nanoBananaEditService');
        const imgUrls = [panel.url];
        console.log('[Quick Edit] Calling nano-banana with image:', panel.url.slice(0, 60));
        resultUrl = await mod.nanoBananaEditService.editImage(enhancedPrompt, imgUrls, { num_images: 1 });
        console.log('[Quick Edit] nano-banana returned:', resultUrl?.slice(0, 60));
      } else if (actionModel === 'seedream') {
        const { seedreamService } = await import('../services/seedreamService');
        
        // If target object is selected, use SAM3 mask for precise editing
        if (actionTargetObject && actionTargetObject.trim()) {
          try {
            const { generateMask } = await import('../services/sam3MaskService');
            const maskResult = await generateMask(panel.url, actionTargetObject.trim(), 0.3, { mode: 'editing' });
            
            if (maskResult.success && maskResult.mask_url) {
              // Edit with mask for precise object-only editing
              resultUrl = await seedreamService.editImage(enhancedPrompt, { 
                image_url: panel.url,
                mask_url: maskResult.mask_url
              });
            } else {
              // Fallback to regular edit if mask generation fails
              console.warn('[Quick Edit] Mask generation failed, using regular edit:', maskResult.error);
              resultUrl = await seedreamService.editImage(enhancedPrompt, { image_url: panel.url });
            }
          } catch (maskError) {
            console.warn('[Quick Edit] Mask error, using regular edit:', maskError);
            // Fallback to regular edit
            resultUrl = await seedreamService.editImage(enhancedPrompt, { image_url: panel.url });
          }
        } else {
          // No target object selected, use regular edit
          resultUrl = await seedreamService.editImage(enhancedPrompt, { image_url: panel.url });
        }
      } else if (actionModel === 'recraft') {
        const { recraftService } = await import('../services/recraftService');
        resultUrl = await recraftService.generateImage(enhancedPrompt);
      } else if (actionModel === 'flux-kontext') {
        const { fluxKontextService } = await import('../services/fluxKontextService');
        resultUrl = await fluxKontextService.editImage(enhancedPrompt, panel.url);
      } else if (actionModel === 'qwen-edit') {
        const { qwenImageEditService } = await import('../services/qwenImageEditService');
        resultUrl = await qwenImageEditService.editImage(enhancedPrompt, panel.url, {} as any);
      } else if (actionModel === 'ideogram') {
        const { ideogramService } = await import('../services/ideogramService');
        resultUrl = await ideogramService.generateImage(enhancedPrompt);
      }
      if (resultUrl) {
        // Update the panel with the new URL on the correct page
        console.log('[Quick Edit] Updating panel', panel.id, 'on page', panelPageIndex, 'with new URL:', resultUrl.slice(0, 60));
        await updatePanel({ ...panel, url: resultUrl, caption: panel.caption || '' }, panelPageIndex);
        console.log('[Quick Edit] Panel updated successfully');
      } else {
        console.warn('[Quick Edit] No result URL returned from', actionModel);
      }
    } catch (e) {
      console.error('[Quick Edit] Failed:', e);
      alert('Failed to edit image. Please try again.');
    } finally {
      setIsQuickEditLoading(false);
      setActionMenuFor(null);
      setActionPrompt('');
      setActionTargetObject(''); // Reset target object
    }
  }, [actionModel, actionPrompt, currentPageIndex, updatePanel, isQuickEditLoading, currentComic]);

  // Handle game panel editing - sends existing code + edit prompt to AI
  const handleGameEdit = useCallback(async (panel: Panel) => {
    if (isQuickEditLoading) return;
    if (panel.type !== 'game' || !(panel as any).gameCode) {
      alert('No game code to edit');
      return;
    }
    
    setIsQuickEditLoading(true);
    try {
      const existingCode = (panel as any).gameCode;
      const editPrompt = actionPrompt.trim();
      
      if (!editPrompt) {
        alert('Please enter edit instructions');
        return;
      }

      // Find which page this panel is on
      let panelPageIndex = currentPageIndex;
      if (currentComic) {
        for (let pi = 0; pi < currentComic.pages.length; pi++) {
          if (currentComic.pages[pi].some(p => p.id === panel.id)) {
            panelPageIndex = pi;
            break;
          }
        }
      }

      // Set progress indicator
      setPanelGenerationProgress(panel.id, true, 'Editing game code...');

      // Map model selection to API provider
      const provider = gameEditModel === 'claude' ? 'claude' : 'gemini';
      // Use latest model versions
      const model = gameEditModel === 'claude' ? 'claude-opus-4-5-20251101' : 'gemini-3-pro-preview';

      // Stream the edited game code
      const streamResp = await fetch('/api/game/edit-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          existingCode,
          editPrompt,
          provider,
          model,
        }),
      });

      if (!streamResp.ok || !streamResp.body) {
        // Fallback to non-streaming edit
        const fallbackResp = await fetch('/api/game/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ existingCode, editPrompt, provider, model }),
        });
        
        if (!fallbackResp.ok) throw new Error('Game edit failed');
        const data = await fallbackResp.json();
        
        if (data.gameCode) {
          await updatePanel({ ...panel, gameCode: data.gameCode } as any, panelPageIndex);
          // Trigger code update in GameViewer
          document.dispatchEvent(new CustomEvent('panel-game-code-delta', { detail: { panelId: panel.id, text: '', replace: true } }));
        }
      } else {
        // Stream the response
        const reader = streamResp.body.getReader();
        const decoder = new TextDecoder();
        let gameCode = '';
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (!data || data === '[DONE]') continue;

            try {
              const evt = JSON.parse(data);
              if (evt.event === 'delta' && typeof evt.text === 'string') {
                gameCode += evt.text;
                // Broadcast live delta to UI
                document.dispatchEvent(new CustomEvent('panel-game-code-delta', { detail: { panelId: panel.id, text: evt.text } }));
              } else if (evt.event === 'replace' && typeof evt.text === 'string') {
                gameCode = evt.text;
              }
            } catch {}
          }
        }

        if (gameCode) {
          await updatePanel({ ...panel, gameCode } as any, panelPageIndex);
        }
      }

      setPanelGenerationProgress(panel.id, false, '');
      setActionMenuFor(null);
      setActionPrompt('');
    } catch (e) {
      console.error('Game edit failed:', e);
      alert('Failed to edit game. Please try again.');
      setPanelGenerationProgress(panel.id, false, '');
    } finally {
      setIsQuickEditLoading(false);
    }
  }, [actionPrompt, gameEditModel, currentPageIndex, updatePanel, isQuickEditLoading, currentComic, setPanelGenerationProgress]);

  // Save current game as template
  const handleSaveGameTemplate = useCallback((panel: Panel) => {
    if (panel.type !== 'game' || !(panel as any).gameCode) {
      alert('No game code to save');
      return;
    }

    const templateName = newTemplateName.trim();
    if (!templateName) {
      alert('Please enter a template name');
      return;
    }

    const newTemplate = {
      id: `template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: templateName,
      code: (panel as any).gameCode,
      createdAt: new Date().toISOString(),
    };

    const updatedTemplates = [...savedGameTemplates, newTemplate];
    setSavedGameTemplates(updatedTemplates);
    
    // Persist to localStorage
    try {
      localStorage.setItem('hon-game-templates', JSON.stringify(updatedTemplates));
    } catch (e) {
      console.warn('Failed to save template:', e);
    }

    setShowSaveTemplateInput(false);
    setNewTemplateName('');
    alert(`Template "${templateName}" saved!`);
  }, [newTemplateName, savedGameTemplates]);

  // Load a saved template into the game panel
  const handleLoadGameTemplate = useCallback(async (panel: Panel, templateId: string) => {
    const template = savedGameTemplates.find(t => t.id === templateId);
    if (!template) return;

    // Find which page this panel is on
    let panelPageIndex = currentPageIndex;
    if (currentComic) {
      for (let pi = 0; pi < currentComic.pages.length; pi++) {
        if (currentComic.pages[pi].some(p => p.id === panel.id)) {
          panelPageIndex = pi;
          break;
        }
      }
    }

    await updatePanel({ ...panel, gameCode: template.code } as any, panelPageIndex);
    
    // Trigger code update in GameViewer
    document.dispatchEvent(new CustomEvent('panel-game-code-delta', { detail: { panelId: panel.id, text: template.code, replace: true } }));
    
    setSelectedGameTemplate('');
    setActionMenuFor(null);
  }, [savedGameTemplates, currentPageIndex, updatePanel, currentComic]);

  // Delete a saved template
  const handleDeleteGameTemplate = useCallback((templateId: string) => {
    const updatedTemplates = savedGameTemplates.filter(t => t.id !== templateId);
    setSavedGameTemplates(updatedTemplates);
    
    try {
      localStorage.setItem('hon-game-templates', JSON.stringify(updatedTemplates));
    } catch (e) {
      console.warn('Failed to delete template:', e);
    }
  }, [savedGameTemplates]);
  
  // Compute bounds of all page nodes (in world coords)
  const getPageBounds = useCallback(() => {
    if (!currentComic) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    const idxs = currentComic.pages.map((_, i) => i);
    if (idxs.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    const width = 720; // approximate node width in px
    const height = 480; // approximate node height in px
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    idxs.forEach(i => {
      const p = pageNodePositions[i] || { x: 0, y: 0 };
      minX = Math.min(minX, p.x - width / 2);
      maxX = Math.max(maxX, p.x + width / 2);
      minY = Math.min(minY, p.y - height / 2);
      maxY = Math.max(maxY, p.y + height / 2);
    });
    return { minX, maxX, minY, maxY };
  }, [currentComic, pageNodePositions]);

  const getBoardBounds = useCallback(() => {
    if (!currentComic) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    // In board mode, include ALL panels from ALL pages (not just current page)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let hasPanels = false;
    currentComic.pages.forEach(page => {
      page.forEach(p => {
        if (!p || p.type === 'palette' || p.type === 'notion') return;
        hasPanels = true;
        const pos = boardPositions[p.id] || computedLayout[p.id] || { x: 0, y: 0 };
        const s = panelScales[p.id] || 1;
        const halfW = (BOARD_CELL_W * BOARD_ITEM_SCALE * s) / 2;
        const halfH = (BOARD_CELL_H * BOARD_ITEM_SCALE * s) / 2;
        minX = Math.min(minX, pos.x - halfW);
        maxX = Math.max(maxX, pos.x + halfW);
        minY = Math.min(minY, pos.y - halfH);
        maxY = Math.max(maxY, pos.y + halfH);
      });
    });
    if (!hasPanels || minX === Infinity) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    return { minX, maxX, minY, maxY };
  }, [currentComic?.id, currentComic?.pages.length, boardPositions, computedLayout, panelScales]);

  // Compute content-only boxes for minimap (exclude palette/notion) - ALL pages in board mode
  const miniPanelBoxes = React.useMemo(() => {
    if (!currentComic) return [] as Array<{ id: string; x: number; y: number; w: number; h: number; type?: string; isSelected?: boolean }>;
    const boxes: Array<{ id: string; x: number; y: number; w: number; h: number; type?: string; isSelected?: boolean }> = [];
    // In board mode, show ALL panels from ALL pages in the minimap
    currentComic.pages.forEach(page => {
      page.forEach(p => {
        if (!p || p.type === 'palette' || p.type === 'notion') return;
        const pos = boardPositions[p.id] || computedLayout[p.id] || { x: 0, y: 0 } as any;
        const scaleForPanel = panelScales[p.id] || 1;
        boxes.push({ 
          id: p.id, 
          x: pos.x, 
          y: pos.y, 
          w: BOARD_CELL_W * BOARD_ITEM_SCALE * scaleForPanel, 
          h: BOARD_CELL_H * BOARD_ITEM_SCALE * scaleForPanel,
          type: p.type,
          isSelected: selectedPanelIds.includes(p.id)
        });
      });
    });
    return boxes;
  }, [currentComic?.id, currentComic?.pages.length, boardPositions, computedLayout, panelScales, selectedPanelIds]);

  const miniBounds = React.useMemo(() => {
    if (!miniPanelBoxes.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    miniPanelBoxes.forEach(b => {
      minX = Math.min(minX, b.x - b.w / 2);
      maxX = Math.max(maxX, b.x + b.w / 2);
      minY = Math.min(minY, b.y - b.h / 2);
      maxY = Math.max(maxY, b.y + b.h / 2);
    });
    return { minX, minY, maxX, maxY };
  }, [miniPanelBoxes]);

  const fitView = useCallback(() => {
    if (!canvasRef.current) return;
    // Don't auto-fit if minimap is being dragged (check global flag)
    if ((window as any).__minimapDragging) return;
    const { clientWidth: vw, clientHeight: vh } = canvasRef.current;
    const inBoard = scale <= overviewThreshold;
    if (!inBoard) {
      // Fit the current page grid/container
      const pageEl = document.getElementById('comic-page-container');
      if (pageEl) {
        const pw = pageEl.offsetWidth || 1;
        const ph = pageEl.offsetHeight || 1;
        const margin = 0.1;
        const s = Math.max(0.1, Math.min(5, Math.min((vw * (1 - margin)) / pw, (vh * (1 - margin)) / ph)));
        setScale(Math.max(s, overviewThreshold + 0.05));
        setPosition({ x: 0, y: 0 });
        if (zoomContainerRef.current) {
          zoomContainerRef.current.style.transform = `translate(0px, 0px) scale(${Math.max(s, overviewThreshold + 0.05)})`;
        }
        return;
      }
    }
    // Board mode: fit all thumbnails
    const { minX, maxX, minY, maxY } = getBoardBounds();
    const bboxW = Math.max(1, maxX - minX);
    const bboxH = Math.max(1, maxY - minY);
    const margin = 0.15; // 15% padding
    // Reserve vertical space under the top controls so content never appears behind them
    let safeTop = 0;
    const controlsEl = document.getElementById('creator-top-controls');
    if (controlsEl) {
      const rect = controlsEl.getBoundingClientRect();
      safeTop = rect.bottom + 12; // small breathing room
    }
    const availableVh = Math.max(1, vh - safeTop);
    const fitScale = Math.max(0.1, Math.min(5, Math.min((vw * (1 - margin)) / bboxW, (availableVh * (1 - margin)) / bboxH)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const targetScale = Math.min(fitScale, overviewThreshold);
    // Compute downward shift so the top edge sits below the controls
    const topAfterCenterPx = vh / 2 - targetScale * (bboxH / 2);
    const neededShiftPx = Math.max(0, safeTop - topAfterCenterPx);
    const yShiftWorld = neededShiftPx / Math.max(targetScale, 0.0001);
    setScale(targetScale);
    const newPos = { x: -cx, y: -cy + yShiftWorld };
    setPosition(newPos);
    if (zoomContainerRef.current) {
      zoomContainerRef.current.style.transform = `translate(${newPos.x}px, ${newPos.y}px) scale(${targetScale})`;
    }
  }, [getBoardBounds, scale, overviewThreshold]);

  // Center current view without changing zoom
  const centerView = useCallback(() => {
    if (!canvasRef.current) return;
    const inBoard = scale <= overviewThreshold;
    let newPos = { x: 0, y: 0 };
    if (inBoard) {
      const { minX, maxX, minY, maxY } = getBoardBounds();
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      newPos = { x: -cx, y: -cy };
    }
    setPosition(newPos);
    if (zoomContainerRef.current) {
      zoomContainerRef.current.style.transform = `translate(${newPos.x}px, ${newPos.y}px) scale(${scale})`;
    }
  }, [getBoardBounds, scale]);

  // Initialize default positions for page nodes around origin in a grid
  useEffect(() => {
    if (!currentComic) return;
    const total = currentComic.pages.length || 0;
    if (total === 0) return;
    const cols = 2; // simple 2-column layout
    const xGap = 900; // spacing between nodes in world px
    const yGap = 700;
    const startX = -((cols - 1) * xGap) / 2;
    const positions: Record<number, { x: number; y: number }> = {};
    for (let i = 0; i < total; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      positions[i] = { x: startX + col * xGap, y: row * yGap };
    }
    setPageNodePositions(prev => (Object.keys(prev).length ? prev : positions));
  }, [currentComic?.id, currentComic?.pages.length]);

  // Initialize board positions for all panels (only fill missing ids; never override drags)
  useEffect(() => {
    if (!currentComic) return;
    const ids = allPanelIds;
    if (ids.length === 0) return;
    setBoardPositions(prev => {
      const next = { ...prev } as Record<string, { x: number; y: number }>;
      let changed = false;
      ids.forEach(id => {
        if (!next[id]) { next[id] = computedLayout[id]; changed = true; }
      });
      return changed ? next : prev;
    });
  }, [currentComic?.id, currentComic?.pages.length, allPanelIds, computedLayout]);

  // Listen for minimap drag events to prevent fitView interference
  useEffect(() => {
    const onMinimapDragStart = () => {
      (window as any).__minimapDragging = true;
    };
    const onMinimapDragEnd = () => {
      (window as any).__minimapDragging = false;
    };
    document.addEventListener('minimap-drag-start', onMinimapDragStart);
    document.addEventListener('minimap-drag-end', onMinimapDragEnd);
    return () => {
      document.removeEventListener('minimap-drag-start', onMinimapDragStart);
      document.removeEventListener('minimap-drag-end', onMinimapDragEnd);
    };
  }, []);

  // Auto-fit when entering board mode the first time after positions exist
  useEffect(() => {
    if (!currentComic) return;
    if (scale > overviewThreshold) { didBoardFitRef.current = false; return; }
    if (!Object.keys(boardPositions).length) return;
    if (didBoardFitRef.current) return;
    if ((window as any).__minimapDragging) return; // Don't auto-fit during minimap drag
    didBoardFitRef.current = true;
    // Defer to allow DOM to layout
    setTimeout(() => { fitView(); }, 0);
  }, [scale, boardPositions, currentComic?.id, fitView]);

  // Capture grid panel rects before switching to board mode (for FLIP)
  useEffect(() => {
    if (!currentComic) return;
    if (scale <= overviewThreshold) return; // only capture while in canvas mode
    const container = document.getElementById('comic-page-container');
    if (!container) return;
    const map: Record<string, DOMRect> = {};
    container.querySelectorAll('[data-panel-id]')?.forEach((el) => {
      const id = (el as HTMLElement).dataset.panelId;
      if (!id) return;
      map[id] = el.getBoundingClientRect();
    });
    flipMapRef.current = map;
  }, [scale, currentPageIndex, currentComic?.id]);

  // Run FLIP animation when entering board mode
  useEffect(() => {
    if (!currentComic) return;
    if (scale > overviewThreshold) return;
    const fromMap = flipMapRef.current;
    if (!fromMap || !Object.keys(fromMap).length) return;
    requestAnimationFrame(() => {
      const container = document.getElementById('zoom-container');
      if (!container) return;
      const nodes = container.querySelectorAll('[data-board-panel]');
      nodes.forEach((el) => {
        const node = el as HTMLElement;
        const id = node.dataset.boardPanel || '';
        const from = fromMap[id];
        if (!from) return;
        const to = node.getBoundingClientRect();
        const dx = from.left + from.width / 2 - (to.left + to.width / 2);
        const dy = from.top + from.height / 2 - (to.top + to.height / 2);
        const sx = from.width / Math.max(1, to.width);
        const sy = from.height / Math.max(1, to.height);
        node.animate([
          { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.65 },
          { transform: 'translate(0,0) scale(1,1)', opacity: 1 }
        ], { duration: 380, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      });
    });
  }, [scale, currentComic?.id]);

  const onNodeMouseDown = (index: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (scale > overviewThreshold) return; // only draggable in overview
    e.preventDefault();
    setDraggingNode(index);
    setNodeDragLast({ x: e.clientX, y: e.clientY });
    const onMove = (me: MouseEvent) => {
      setPageNodePositions(prev => {
        const pos = prev[index] || { x: 0, y: 0 };
        const dx = (me.clientX - nodeDragLast.x) / scale;
        const dy = (me.clientY - nodeDragLast.y) / scale;
        setNodeDragLast({ x: me.clientX, y: me.clientY });
        return { ...prev, [index]: { x: pos.x + dx, y: pos.y + dy } };
      });
    };
    const onUp = () => {
      setDraggingNode(null);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const onNodeClickFocus = useCallback((index: number) => {
    try {
      if (typeof index !== 'number' || index < 0) {
        console.warn('[Creator] Invalid page index for focus:', index);
        return;
      }
      // Validate page exists before switching
      const currentComic = useComicStore.getState().currentComic;
      if (!currentComic || !currentComic.pages || index >= currentComic.pages.length) {
        console.warn('[Creator] Page index out of bounds:', index, 'pages:', currentComic?.pages?.length);
        return;
      }
      // Jump to that page and zoom back to normal
      setCurrentPageIndex(index);
      setScale(1);
      setPosition({ x: 0, y: 0 });
      if (zoomContainerRef.current) {
        zoomContainerRef.current.style.transform = `translate(0px, 0px) scale(1)`;
      }
    } catch (error) {
      console.error('[Creator] Error in onNodeClickFocus:', error);
    }
  }, []);

  const onBoardPanelMouseDown = (panelId: string, e: React.MouseEvent<HTMLDivElement>) => {
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
    const groupStartPositions: Record<string, { x: number; y: number }> = {};
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
      const guides: { x?: number; y?: number } = {};
      const SNAP_THRESHOLD = 10 / scale; // 10px threshold in world space
      
      if (currentComic) {
        currentComic.pages.forEach(page => {
          page.forEach(p => {
            if (p.id === panelId) return;
            const otherPos = boardPositions[p.id] || computedLayout[p.id] || { x: 0, y: 0 };
            const panelScale = panelScales[p.id] || 1;
            const baseW = BOARD_CELL_W * BOARD_ITEM_SCALE * panelScale;
            const baseH = BOARD_CELL_H * BOARD_ITEM_SCALE * panelScale;
            const currentScale = panelScales[panelId] || 1;
            const currentW = BOARD_CELL_W * BOARD_ITEM_SCALE * currentScale;
            const currentH = BOARD_CELL_H * BOARD_ITEM_SCALE * currentScale;
            
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
          const startPos = groupStartPositions[pid];
          if (pid === panelId) {
            next[pid] = { x: newX, y: newY };
          } else {
            // Other panels in group move by the same delta
            next[pid] = {
              x: startPos.x + dx,
              y: startPos.y + dy
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
      
      // Track panel move event
      const finalPos = boardPositions[panelId] || computedLayout[panelId] || { x: 0, y: 0 };
      if (startPos.x !== finalPos.x || startPos.y !== finalPos.y) {
        getCanvasHistoryBus().emit({
          eventType: 'panel_move',
          eventDescription: `Moved panel${panelsToDrag.length > 1 ? `s (${panelsToDrag.length})` : ''}`,
          eventData: {
            panelId,
            panelIds: panelsToDrag,
            oldPosition: startPos,
            newPosition: finalPos,
            pageIndex: currentPageIndex,
          },
        }).then(() => {
          // Create snapshot after panel move (using current state with potentially stale boardPositions in closure, so we pass current positions)
          // Note: boardPositions state update might not be flushed to closure yet, so we use the state value we just set if we could access it, 
          // but since we can't easily access the pending state update, we rely on the fact that 'boardPositions' ref might be stale.
          // actually, we should pass the 'finalPos' but that's just for one panel.
          // The best we can do is use the current 'boardPositions' from the component scope which is stale, BUT we know the new position of the moved panel(s).
          // For simplicity, we'll rely on captureCanvasState using the 'boardPositions' from the closure, which is technically stale for the moved panel.
          // To fix this, we should construct the overrides.
          
          const overrides: Record<string, {x: number, y: number}> = { ...boardPositions };
          panelsToDrag.forEach(pid => {
            // We need the final position for each dragged panel.
            // In the onMove handler, we updated the state.
            // We can recalculate it here or just assume boardPositions will update soon? 
            // No, snapshot needs it NOW.
            // We can assume the move was successful.
            // Actually, 'boardPositions' in this closure IS the old one.
            // But we calculated 'finalPos' for the main panel.
            // And we know the delta.
            const start = groupStartPositions[pid];
            const dx = finalPos.x - startPos.x;
            const dy = finalPos.y - startPos.y;
            overrides[pid] = { x: start.x + dx, y: start.y + dy };
          });
          
          const state = captureCanvasState(undefined, overrides);
          const moveLabel = panelsToDrag.length > 1 ? `Moved ${panelsToDrag.length} panels` : 'Panel moved';
          getCanvasHistoryBus().createSnapshot(state, 'auto', moveLabel);
        });
      }
      
      // Do not auto-fit after a simple drag; keep user's view stable
    };
    // While dragging a panel, temporarily disable wheel-zoom to avoid accidental zoom jitter
    const onWheelBlock = (w: WheelEvent) => { w.preventDefault(); };
    try { canvasRef.current?.addEventListener('wheel', onWheelBlock, { passive: false }); } catch {}
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    const cleanupWheel = () => { try { canvasRef.current?.removeEventListener('wheel', onWheelBlock as any); } catch {} };
    document.addEventListener('mouseup', cleanupWheel, { once: true });
  };

  const onBoardPanelDoubleClick = useCallback((pageIndex: number) => {
    try {
      if (typeof pageIndex !== 'number' || pageIndex < 0) {
        console.warn('[Creator] Invalid page index for double-click:', pageIndex);
        return;
      }
      // Validate page exists before calling focus
      const currentComic = useComicStore.getState().currentComic;
      if (!currentComic || !currentComic.pages || pageIndex >= currentComic.pages.length) {
        console.warn('[Creator] Page index out of bounds in double-click:', pageIndex, 'pages:', currentComic?.pages?.length);
        return;
      }
      onNodeClickFocus(pageIndex);
    } catch (error) {
      console.error('[Creator] Error in onBoardPanelDoubleClick:', error);
    }
  }, [onNodeClickFocus]);

  // Group selected panels together (board mode only)
  const groupSelectedPanels = useCallback(() => {
    if (scale > overviewThreshold || selectedPanelIds.length < 2) return;
    const groupId = nanoid();
    setPanelGroups(prev => ({ ...prev, [groupId]: [...selectedPanelIds] }));
    
    // Track panel group event
    canvasHistoryBus.emit({
      eventType: 'panel_group',
      eventDescription: `Grouped ${selectedPanelIds.length} panels`,
      eventData: {
        groupId,
        panelIds: selectedPanelIds,
        pageIndex: currentPageIndex,
      },
    }).then(() => {
      // Pass the new group to snapshot
      const newGroups = { ...panelGroups, [groupId]: [...selectedPanelIds] };
      const state = captureCanvasState(undefined, undefined, undefined, newGroups);
      getCanvasHistoryBus().createSnapshot(state, 'auto', `Grouped ${selectedPanelIds.length} panels`);
    });
  }, [scale, overviewThreshold, selectedPanelIds, currentPageIndex]);

  // Ungroup panels (board mode only)
  const ungroupSelectedPanels = useCallback(() => {
    if (scale > overviewThreshold) return;
    // Find all groups that contain any selected panels
    const groupsToRemove = new Set<string>();
    selectedPanelIds.forEach(panelId => {
      const groupId = panelToGroup[panelId];
      if (groupId) groupsToRemove.add(groupId);
    });
    
    if (groupsToRemove.size === 0) return;
    
    const groupIdsArray = Array.from(groupsToRemove);
    const panelIdsInGroups = groupIdsArray.flatMap(groupId => panelGroups[groupId] || []);
    
    setPanelGroups(prev => {
      const next = { ...prev };
      groupsToRemove.forEach(groupId => {
        delete next[groupId];
      });
      return next;
    });
    
    // Track panel ungroup event
    canvasHistoryBus.emit({
      eventType: 'panel_ungroup',
      eventDescription: `Ungrouped ${panelIdsInGroups.length} panels`,
      eventData: {
        groupIds: groupIdsArray,
        panelIds: panelIdsInGroups,
        pageIndex: currentPageIndex,
      },
    }).then(() => {
      // Pass the new groups to snapshot
      const newGroups = { ...panelGroups };
      groupsToRemove.forEach(gid => delete newGroups[gid]);
      const state = captureCanvasState(undefined, undefined, undefined, newGroups);
      getCanvasHistoryBus().createSnapshot(state, 'auto', `Ungrouped ${panelIdsInGroups.length} panels`);
    });
  }, [scale, overviewThreshold, selectedPanelIds, panelToGroup, panelGroups, currentPageIndex]);

  // Keyboard shortcuts for grouping (board mode only)
  useEffect(() => {
    if (scale > overviewThreshold) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+G or Ctrl+G to group selected panels
      if ((e.metaKey || e.ctrlKey) && e.key === 'g' && !e.shiftKey) {
        if (selectedPanelIds.length >= 2) {
          e.preventDefault();
          groupSelectedPanels();
        }
        return;
      }
      // Cmd+Shift+G or Ctrl+Shift+G to ungroup
      if ((e.metaKey || e.ctrlKey) && e.key === 'G' && e.shiftKey) {
        if (selectedPanelIds.length > 0) {
          e.preventDefault();
          ungroupSelectedPanels();
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [scale, overviewThreshold, selectedPanelIds, groupSelectedPanels, ungroupSelectedPanels]);

  if (!currentComic) {
    return (
      <div className="flex items-center justify-center h-screen bg-white dark:bg-gray-900">
        <div className="text-center">
          <p className="text-gray-600 dark:text-gray-400">Opening a new canvas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-gray-100 dark:bg-gray-900 relative">
      {/* Hidden data attributes for Hon's board mode awareness */}
      <div 
        data-board-mode-state={JSON.stringify({
          isInBoardMode: scale <= overviewThreshold,
          scale: scale,
          viewportCenter: {x: -position.x, y: -position.y},
          viewportBounds: canvasRef.current ? {
            minX: -position.x - (canvasRef.current.clientWidth / 2) / scale,
            maxX: -position.x + (canvasRef.current.clientWidth / 2) / scale,
            minY: -position.y - (canvasRef.current.clientHeight / 2) / scale,
            maxY: -position.y + (canvasRef.current.clientHeight / 2) / scale
          } : {minX: 0, maxX: 0, minY: 0, maxY: 0},
          canvasBounds: miniBounds
        })}
        data-board-positions={JSON.stringify(boardPositions)}
        data-panel-scales={JSON.stringify(panelScales)}
        style={{ display: 'none' }}
        aria-hidden="true"
      />
      
      {/* Full viewport dotted canvas background */}
      <div 
        className="absolute inset-0"
        style={{ 
          backgroundImage: "radial-gradient(circle, #444 1px, transparent 1px)", 
          backgroundSize: "40px 40px",
          backgroundPosition: "center"
        }}
      />

            {isWorldMode && (
              <div className="absolute top-4 right-5 z-50 flex items-center gap-3">
                <div className="px-4 py-2 bg-black/60 backdrop-blur-xl text-white rounded-full border border-white/15 text-sm font-medium flex items-center gap-3 shadow-lg">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse" />
                  {worldModePreference === 'map' ? 'Real World Map Active' : 'Immersive Scene Active'}
                </div>
                <button 
                  onClick={() => setWorldMode(false)}
                  className="px-4 py-2 bg-white/15 hover:bg-white/25 text-white rounded-full border border-white/20 text-sm font-medium transition-colors backdrop-blur-xl shadow-lg"
                >
                  Exit World
                </button>
              </div>
            )}

            {/* Unified dropdown next to sidebar at top + Zoom presets */}
            {/* Position relative to side menu state only - not affected by world mode */}
            {/* z-[60] ensures it's above world mode layers */}
            <div id="creator-top-controls" className={`absolute top-4 z-[60] flex items-center gap-3 ${isSideMenuCollapsed ? 'left-4' : 'left-80 ml-6'}`}>
                <UnifiedDropdown
          onSaveDraft={handleSaveDraft}
          onPublish={handlePublish}
          onSavePage={handleSavePage}
          isSaving={isSaving}
          isPublishing={isPublishing}
          isSavingPage={isSavingPage}
        />
        {/* Hide zoom menu in world mode - map has its own controls */}
        {!isWorldMode && (
          <div className="bg-gray-900/70 text-white rounded-lg px-2 py-1 flex items-center gap-2" data-zoom-menu>
            <span className="text-xs opacity-80">Zoom</span>
            <select
              defaultValue="fit"
              className="bg-transparent text-xs outline-none w-[110px]"
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'fit') {
                  fitView();
                  return;
                }
                if (v === 'center') {
                  centerView();
                  e.target.value = 'fit';
                  return;
                }
                if (v === 'arrange-grid' && scale <= overviewThreshold) {
                  arrangeBoardGrid();
                  e.target.value = 'fit';
                  return;
                }
                if (v === 'timeline' && scale <= overviewThreshold) {
                  arrangeTimeline();
                  e.target.value = 'fit';
                  return;
                }
                if (v === 'storyboard' && scale <= overviewThreshold) {
                  arrangeStoryboard();
                  e.target.value = 'fit';
                  return;
                }
                if (v === 'cluster' && scale <= overviewThreshold) {
                  arrangeCluster();
                  e.target.value = 'fit';
                  return;
                }
                const pct = parseInt(v, 10);
                const s = Math.max(0.1, Math.min(5, pct / 100));
                setScale(s);
                if (zoomContainerRef.current) {
                  zoomContainerRef.current.style.transform = `translate(${position.x}px, ${position.y}px) scale(${s})`;
                }
              }}
            >
              <option value="fit">Fit</option>
              <option value="center">Center</option>
              <option value="50">50%</option>
              <option value="75">75%</option>
              <option value="100">100%</option>
              <option value="150">150%</option>
              <option value="200">200%</option>
              {scale <= overviewThreshold && (
                <>
                  <option value="arrange-grid">Arrange Grid</option>
                  <option value="timeline">Timeline</option>
                  <option value="storyboard">Storyboard</option>
                  <option value="cluster">Cluster</option>
                </>
              )}
            </select>
          </div>
        )}
      </div>
      
      {/* Visual alignment guides */}
      {scale <= overviewThreshold && (alignmentGuides.x !== undefined || alignmentGuides.y !== undefined) && zoomContainerRef.current && (
        <div
          className="absolute pointer-events-none z-40"
          style={{
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transformOrigin: '0 0'
          }}
        >
          {alignmentGuides.x !== undefined && (
            <div
              className="absolute bg-blue-500 opacity-60"
              style={{
                left: `${alignmentGuides.x}px`,
                top: '-10000px',
                width: '2px',
                height: '20000px',
                pointerEvents: 'none'
              }}
            />
          )}
          {alignmentGuides.y !== undefined && (
            <div
              className="absolute bg-blue-500 opacity-60"
              style={{
                left: '-10000px',
                top: `${alignmentGuides.y}px`,
                width: '20000px',
                height: '2px',
                pointerEvents: 'none'
              }}
            />
          )}
        </div>
      )}

      {/* Minimap anchored to viewport (board mode only, hidden in world mode) */}
      {scale <= overviewThreshold && currentComic && !isWorldMode && (
        <BoardMinimap
          bounds={miniBounds}
          panelBoxes={miniPanelBoxes}
          viewport={{ widthPx: canvasRef.current?.clientWidth || 1, heightPx: canvasRef.current?.clientHeight || 1, scale, position }}
          onCenterWorld={(wx, wy) => {
            const newPos = { x: -wx, y: -wy };
            // Update position state and transform immediately for smooth dragging
            setPosition(newPos);
            if (zoomContainerRef.current) {
              zoomContainerRef.current.style.transform = `translate(${newPos.x}px, ${newPos.y}px) scale(${scale})`;
            }
          }}
          onCenterPanel={(panelId) => {
            // Find the panel and center it in the viewport
            const panelBox = miniPanelBoxes.find(p => p.id === panelId);
            if (panelBox) {
              const newPos = { x: -panelBox.x, y: -panelBox.y };
              setPosition(newPos);
              if (zoomContainerRef.current) {
                zoomContainerRef.current.style.transform = `translate(${newPos.x}px, ${newPos.y}px) scale(${scale})`;
              }
              // Also select the panel
              setSelectedPanelIds([panelId]);
            }
          }}
        />
      )}

      {/* Sidebar */}
      <CreatorSideMenu
        onTemplateSelect={handleTemplateSelect}
        onGenerate={handleGenerateImage}
        onEdit={handleEdit}
        selectedImageUrl={selectedImage}
        onClearSelection={() => setSelectedImage(null)}
        onAddPanel={() => {}}
        currentTemplate={currentComic?.pageTemplates[currentPageIndex] || null}
        comic={currentComic}
        onUpdateTitle={() => {}}
        recentGenerations={React.useMemo(() => {
          try {
            return (recentGenerations || []).filter((g) => {
              const t = (g as any)?.type;
              const url: string = (g as any)?.url || '';
              if (t === 'video') return false;
              if (/\.(mp4|webm|mov|m4v)$/i.test(url)) return false;
              return true;
            });
          } catch { return recentGenerations; }
        }, [recentGenerations])}
        onSelectGeneration={() => {}}
        onGenerateStory={handleGenerateStory}
      />

      <div className="flex-1 relative">
        <div className="flex h-full">
          {/* Main Content */}
          <main className={`flex-1 relative ${isSideMenuCollapsed ? 'ml-0' : 'ml-80'} dark:bg-transparent`} style={{ contain: 'none' }}>
            
            {/* World Mode Layer */}
            {isWorldMode && (
              <div className="absolute inset-0 z-10">
                {worldModePreference === 'map' ? (
                  <WorldMapCanvas onClose={() => setWorldMode(false)} />
                ) : (
                  <WorldImmersiveCanvas onClose={() => setWorldMode(false)} />
                )}
              </div>
            )}

            <div
              ref={lassoContainerRef}
              className="absolute inset-0 overflow-hidden"
              style={{ opacity: isWorldMode ? 0 : 1, pointerEvents: isWorldMode ? 'none' : 'auto' }}
              onMouseDown={(e) => {
                if (scale > overviewThreshold) return; // only in board mode
                const target = e.target as HTMLElement;
                if (target.closest('[data-board-panel]')) return; // don't start marquee on panel
                if (!lassoContainerRef.current) return;
                const rect = lassoContainerRef.current.getBoundingClientRect();
                marqueeStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                setMarquee({ x: e.clientX - rect.left, y: e.clientY - rect.top, w: 0, h: 0, active: true });
                clearSelection();
              }}
              onMouseMove={(e) => {
                if (scale > overviewThreshold) return;
                if (!marquee.active || !marqueeStartRef.current || !lassoContainerRef.current) return;
                const rect = lassoContainerRef.current.getBoundingClientRect();
                const x2 = e.clientX - rect.left;
                const y2 = e.clientY - rect.top;
                const x1 = marqueeStartRef.current.x;
                const y1 = marqueeStartRef.current.y;
                const x = Math.min(x1, x2);
                const y = Math.min(y1, y2);
                const w = Math.abs(x2 - x1);
                const h = Math.abs(y2 - y1);
                setMarquee({ x, y, w, h, active: true });
              }}
              onMouseUp={(e) => {
                if (scale > overviewThreshold) return;
                if (!marquee.active || !lassoContainerRef.current) return;
                try {
                  const rect = lassoContainerRef.current.getBoundingClientRect();
                  const selBox = new DOMRect(rect.left + marquee.x, rect.top + marquee.y, marquee.w, marquee.h);
                  const newly: string[] = [];
                  // Use data-board-panel elements within zoomContainerRef to avoid capturing non-board elements
                  const nodes = zoomContainerRef.current ? zoomContainerRef.current.querySelectorAll('[data-board-panel]') : lassoContainerRef.current.querySelectorAll('[data-board-panel]');
                  console.log('[lasso] Selection box:', { x: marquee.x, y: marquee.y, w: marquee.w, h: marquee.h, totalNodes: nodes.length });
                  nodes.forEach(node => {
                    const el = node as HTMLElement;
                    const id = el.getAttribute('data-board-panel');
                    if (!id) return;
                    const r = el.getBoundingClientRect();
                    const intersects = !(r.right < selBox.left || r.left > selBox.right || r.bottom < selBox.top || r.top > selBox.bottom);
                    if (intersects) {
                      newly.push(id);
                      console.log('[lasso] Selected panel:', id);
                    }
                  });
            console.log('[lasso] Total selected:', newly.length, newly);
            console.log('[lasso] Setting selectedPanelIds in store...');
                  setSelectedPanelIds(newly);
            // Verify store was updated
            const storeCheck = useComicStore.getState().selectedPanelIds;
            console.log('[lasso] Store updated. Current selectedPanelIds:', storeCheck);
            console.log('[lasso] Dispatching board-selection-changed event...');
                  document.dispatchEvent(new CustomEvent('board-selection-changed', { detail: { panelIds: newly } }));
                  // Suppress panel click re-select immediately after marquee
                  try { justMarqueeSelectAtRef.current = (typeof performance !== 'undefined' ? performance.now() : Date.now()); } catch {}
                } finally {
                  marqueeStartRef.current = null;
                  setMarquee({ x: 0, y: 0, w: 0, h: 0, active: false });
                }
              }}
              onPointerDown={(e) => {
                if (scale > overviewThreshold) return;
                if (e.pointerType !== 'touch') return; // mouse handled by onMouse*
                const target = e.target as HTMLElement;
                if (target.closest('[data-board-panel]')) return;
                if (!lassoContainerRef.current) return;
                activePointerIdRef.current = e.pointerId;
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                const rect = lassoContainerRef.current.getBoundingClientRect();
                marqueeStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                setMarquee({ x: e.clientX - rect.left, y: e.clientY - rect.top, w: 0, h: 0, active: true });
                clearSelection();
              }}
              onPointerMove={(e) => {
                if (scale > overviewThreshold) return;
                if (e.pointerType !== 'touch') return;
                if (!marquee.active || !marqueeStartRef.current || !lassoContainerRef.current) return;
                const rect = lassoContainerRef.current.getBoundingClientRect();
                const x2 = e.clientX - rect.left;
                const y2 = e.clientY - rect.top;
                const x1 = marqueeStartRef.current.x;
                const y1 = marqueeStartRef.current.y;
                const x = Math.min(x1, x2);
                const y = Math.min(y1, y2);
                const w = Math.abs(x2 - x1);
                const h = Math.abs(y2 - y1);
                setMarquee({ x, y, w, h, active: true });
              }}
              onPointerUp={(e) => {
                if (scale > overviewThreshold) return;
                if (e.pointerType !== 'touch') return;
                if (!marquee.active || !lassoContainerRef.current) return;
                try {
                  const rect = lassoContainerRef.current.getBoundingClientRect();
                  const selBox = new DOMRect(rect.left + marquee.x, rect.top + marquee.y, marquee.w, marquee.h);
                  const newly: string[] = [];
                  const nodes = zoomContainerRef.current ? zoomContainerRef.current.querySelectorAll('[data-board-panel]') : lassoContainerRef.current.querySelectorAll('[data-board-panel]');
                  nodes.forEach(node => {
                    const el = node as HTMLElement;
                    const id = el.getAttribute('data-board-panel');
                    if (!id) return;
                    const r = el.getBoundingClientRect();
                    const intersects = !(r.right < selBox.left || r.left > selBox.right || r.bottom < selBox.top || r.top > selBox.bottom);
                    if (intersects) newly.push(id);
                  });
                  setSelectedPanelIds(newly);
                  document.dispatchEvent(new CustomEvent('board-selection-changed', { detail: { panelIds: newly } }));
                  try { justMarqueeSelectAtRef.current = (typeof performance !== 'undefined' ? performance.now() : Date.now()); } catch {}
                } finally {
                  try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
                  activePointerIdRef.current = null;
                  marqueeStartRef.current = null;
                  setMarquee({ x: 0, y: 0, w: 0, h: 0, active: false });
                }
              }}
              onClick={(e) => {
                if (scale > overviewThreshold) return;
                const target = e.target as HTMLElement;
                if (!target.closest('[data-board-panel]')) {
                  clearSelection();
                  document.dispatchEvent(new CustomEvent('board-selection-changed', { detail: { panelIds: [] } }));
                }
              }}
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
                  {scale > overviewThreshold && (
                    <div className="max-w-5xl mx-auto">
                      {currentComic?.pageTemplates[currentPageIndex] ? (
                        currentComic.pageTemplates[currentPageIndex].id === 'custom' ? (
                          <CustomCanvas
                            panels={currentComic.pages[currentPageIndex] || []}
                            onUpdatePanel={handleUpdatePanel}
                            onRemovePanel={(panelId) => handleRemovePanel(panelId, currentPageIndex)}
                            pageIndex={currentPageIndex}
                          />
                        ) : (
                        <PanelGrid
                          panels={currentComic.pages[currentPageIndex] || []}
                          template={currentComic.pageTemplates[currentPageIndex]}
                          onUpdatePanel={handleUpdatePanel}
                          onRemovePanel={(panelId) => removePanel(panelId, currentPageIndex)}
                          onReorderPanels={reorderPanels}
                          pageIndex={currentPageIndex}
                        />
                        )
                      ) : (
                        <div className="text-center text-gray-500 dark:text-gray-400 mt-20">
                          Please select a template to begin
                        </div>
                      )}
                    </div>
                  )}
                  {scale <= overviewThreshold && currentComic && (
                    <div className="relative">
                      {currentComic.pages.map((page, pi) => (
                        page.map((p, panelIndex) => {
                          const pos = boardPositions[p.id] || { x: 0, y: 0 };
                          const baseW = BOARD_CELL_W * BOARD_ITEM_SCALE;
                          const baseH = BOARD_CELL_H * BOARD_ITEM_SCALE;
                          // Ensure panelScale is always a valid number to prevent TDZ issues
                          const rawScale = panelScales[p.id];
                          const panelScale = (typeof rawScale === 'number' && !isNaN(rawScale) && rawScale > 0) ? rawScale : 1;
                          const isGame = p.type === 'game';
                          // Notion panels have internal scale (default 2.5x), so container should be smaller to fit
                          const isNotion = p.type === 'notion';
                          const contentW = baseW * panelScale * (isGame ? 1.2 : 1.0);
                          const contentH = baseH * panelScale * (isGame ? 1.2 : 1.0);
                          const isSelected = p.type !== 'notion' && selectedPanelIds.includes(p.id);
                          const isGrouped = !!panelToGroup[p.id];
                          const groupId = panelToGroup[p.id];
                          const groupMembers = groupId ? panelGroups[groupId] || [] : [];
                          
                          return (
                            <div
                              key={`board-${p.id}-${p.type}-${p.url?.slice(-20) || ''}`}
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
                                // Dynamic color based on Hon indicator state - ENHANCED VISIBILITY
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
                                // Check if we're currently resizing (only for game panels)
                                if (p.type === 'game') {
                                  const panel = e.currentTarget as HTMLElement;
                                  if (panel.getAttribute('data-resizing') === 'true') {
                                    return; // Don't start drag while resizing
                                  }
                                }
                                
                                // 3D: default drag moves wrapper; hold Shift to rotate model (let model-viewer handle)
                                if (p.type === '3d' && e.shiftKey) {
                                  return; // do not start wrapper drag
                                }
                                // Even for notion (non-interactive), allow dragging the whole panel wrapper
                                // If moved more than a few pixels, treat as drag; else it's a click select
                                if (p.type === 'notion') {
                                  // Disable typing while dragging
                                  setNotionInteractiveIds(prev => ({ ...prev, [p.id]: false }));
                                }
                                onBoardPanelMouseDown(p.id, e);
                              }}
                              onClick={(e) => {
                                if (scale > overviewThreshold) return;
                                e.stopPropagation();
                                // If just finished a marquee selection, ignore stray click-up
                                try {
                                  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
                                  if (now - (justMarqueeSelectAtRef.current || 0) < 120) return;
                                } catch {}
                                // Single click selects this panel (replaces selection)
                                if (p.type !== 'notion') {
                                setSelectedPanelIds([p.id]);
                                document.dispatchEvent(new CustomEvent('board-selection-changed', { detail: { panelIds: [p.id] } }));
                                }
                              }}
                              onPointerDown={(e) => {
                                if (scale > overviewThreshold) return;
                                if (e.pointerType !== 'touch') return;
                                e.stopPropagation();
                                if (p.type !== 'notion') {
                                setSelectedPanelIds([p.id]);
                                document.dispatchEvent(new CustomEvent('board-selection-changed', { detail: { panelIds: [p.id] } }));
                                }
                              }}
                              onDoubleClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                try {
                                  if (p.type === 'notion') {
                                    setNotionInteractiveIds(prev => ({ ...prev, [p.id]: true }));
                                    return;
                                  }
                                  if (typeof pi === 'number' && pi >= 0) {
                                    onBoardPanelDoubleClick(pi);
                                  } else {
                                    console.warn('[Creator] Invalid page index in double-click handler:', pi);
                                  }
                                } catch (error) {
                                  console.error('[Creator] Error handling panel double-click:', error);
                                }
                              }}
                              title={p.type === '3d' ? 'Drag to move • Shift+Drag to rotate' : `Page ${pi + 1} • Double-click to open`}
                            >
                              {/* Quick actions: visible on hover or when selected (except Notion/Palette) */}
                              {p.type !== 'notion' && p.type !== 'palette' && (
                                <>
                                  <div className={`absolute z-30 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity duration-100`} style={{ left: '100%', top: 0, transform: 'translate(10px, -10px)', pointerEvents: 'auto' }}>
                                    <button
                                      onClick={(e) => { 
                                        e.stopPropagation(); 
                                        e.preventDefault();
                                        // Remove panel from its page (pi = page index where this panel lives)
                                        handleRemovePanel(p.id, pi); 
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
                                        setActionMenuFor(p.id); 
                                        setActionPrompt(''); 
                                      }}
                                      className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-xs shadow border border-gray-300 dark:border-gray-600 hover:bg-gray-300 dark:hover:bg-gray-600 flex items-center justify-center"
                                      title="Quick edit"
                                      style={{ pointerEvents: 'auto' }}
                                    >
                                      +
                                    </button>
                                  </div>
                                  {actionMenuFor === p.id && (
                                    <div
                                      className="fixed z-50 rounded-xl p-3 bg-white/95 dark:bg-gray-900/95 border border-gray-200 dark:border-gray-700 shadow-2xl"
                                      style={{ 
                                        width: p.type === 'game' ? '320px' : '280px',
                                        left: '50%',
                                        top: '50%',
                                        transform: 'translate(-50%, -50%)',
                                        maxHeight: '80vh',
                                        overflowY: 'auto'
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onPointerDown={(e) => e.stopPropagation()}
                                    >
                                      {/* Game Panel Edit UI */}
                                      {p.type === 'game' ? (
                                        <>
                                          <div className="text-xs font-medium text-gray-800 dark:text-gray-200 mb-2">Edit Game with</div>
                                          <select
                                            value={gameEditModel}
                                            onChange={(e) => setGameEditModel(e.target.value as any)}
                                            onMouseDown={(e) => e.stopPropagation()}
                                            onPointerDown={(e) => e.stopPropagation()}
                                            disabled={isQuickEditLoading}
                                            className="w-full text-sm bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 mb-2 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                                          >
                                            <option value="gemini-3">Gemini 3 Pro</option>
                                            <option value="claude">Claude Opus 4.5</option>
                                          </select>

                                          {/* Saved Templates Dropdown */}
                                          {savedGameTemplates.length > 0 && (
                                            <>
                                              <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Load from Template</label>
                                              <div className="flex gap-1 mb-2">
                                                <select
                                                  value={selectedGameTemplate}
                                                  onChange={(e) => setSelectedGameTemplate(e.target.value)}
                                                  onMouseDown={(e) => e.stopPropagation()}
                                                  onPointerDown={(e) => e.stopPropagation()}
                                                  disabled={isQuickEditLoading}
                                                  className="flex-1 text-sm bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 focus:outline-none disabled:opacity-50"
                                                >
                                                  <option value="">Select a template...</option>
                                                  {savedGameTemplates.map(t => (
                                                    <option key={t.id} value={t.id}>{t.name}</option>
                                                  ))}
                                                </select>
                                                {selectedGameTemplate && (
                                                  <>
                                                    <button
                                                      onClick={() => handleLoadGameTemplate(p, selectedGameTemplate)}
                                                      disabled={isQuickEditLoading}
                                                      className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                                                      title="Load template"
                                                    >
                                                      Load
                                                    </button>
                                                    <button
                                                      onClick={() => {
                                                        if (confirm('Delete this template?')) {
                                                          handleDeleteGameTemplate(selectedGameTemplate);
                                                          setSelectedGameTemplate('');
                                                        }
                                                      }}
                                                      disabled={isQuickEditLoading}
                                                      className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
                                                      title="Delete template"
                                                    >
                                                      ×
                                                    </button>
                                                  </>
                                                )}
                                              </div>
                                            </>
                                          )}

                                          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Edit Instructions</label>
                                          <textarea
                                            value={actionPrompt}
                                            onChange={(e) => { setActionPrompt(e.target.value); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = Math.min(200, e.currentTarget.scrollHeight) + 'px'; }}
                                            onMouseDown={(e) => e.stopPropagation()}
                                            onPointerDown={(e) => e.stopPropagation()}
                                            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && actionPrompt.trim() && !isQuickEditLoading) { e.preventDefault(); handleGameEdit(p); } }}
                                            placeholder="e.g., Add a scoring system, Make the player faster, Add enemy AI..."
                                            rows={3}
                                            disabled={isQuickEditLoading}
                                            className="w-full text-sm bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 mb-2 resize-none focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                                          />

                                          {/* Save as Template */}
                                          {!showSaveTemplateInput ? (
                                            <button
                                              onClick={() => setShowSaveTemplateInput(true)}
                                              disabled={isQuickEditLoading || !(p as any).gameCode}
                                              className="w-full text-xs text-gray-600 dark:text-gray-400 hover:text-purple-500 dark:hover:text-purple-400 mb-2 py-1 border border-dashed border-gray-300 dark:border-gray-600 rounded disabled:opacity-50"
                                            >
                                              💾 Save as Template
                                            </button>
                                          ) : (
                                            <div className="flex gap-1 mb-2">
                                              <input
                                                type="text"
                                                value={newTemplateName}
                                                onChange={(e) => setNewTemplateName(e.target.value)}
                                                onMouseDown={(e) => e.stopPropagation()}
                                                onPointerDown={(e) => e.stopPropagation()}
                                                placeholder="Template name..."
                                                className="flex-1 text-sm bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 focus:outline-none"
                                              />
                                              <button
                                                onClick={() => handleSaveGameTemplate(p)}
                                                disabled={!newTemplateName.trim()}
                                                className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
                                              >
                                                Save
                                              </button>
                                              <button
                                                onClick={() => { setShowSaveTemplateInput(false); setNewTemplateName(''); }}
                                                className="px-2 py-1 text-xs bg-gray-300 dark:bg-gray-600 rounded"
                                              >
                                                ×
                                              </button>
                                            </div>
                                          )}

                                          <div className="flex gap-2 justify-end pt-1 border-t border-gray-200 dark:border-gray-700 mt-2">
                                            <button 
                                              className="px-2 py-1 text-xs rounded bg-gray-200 dark:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed" 
                                              onClick={() => { setActionMenuFor(null); setActionPrompt(''); setShowSaveTemplateInput(false); setNewTemplateName(''); setSelectedGameTemplate(''); }}
                                              disabled={isQuickEditLoading}
                                            >Cancel</button>
                                            <button
                                              className={`px-2 py-1 text-xs rounded flex items-center gap-1.5 ${actionPrompt.trim() && !isQuickEditLoading ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-gray-300 text-gray-600 cursor-not-allowed'}`}
                                              disabled={!actionPrompt.trim() || isQuickEditLoading}
                                              onClick={() => handleGameEdit(p)}
                                            >
                                              {isQuickEditLoading ? (
                                                <>
                                                  <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                  </svg>
                                                  <span>Editing...</span>
                                                </>
                                              ) : (
                                                'Apply Edit'
                                              )}
                                            </button>
                                          </div>
                                          
                                          {/* Show code checkbox */}
                                          <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                                            <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
                                              <input
                                                type="checkbox"
                                                checked={false}
                                                onChange={() => {
                                                  // Dispatch event to show code overlay in GameViewer
                                                  document.dispatchEvent(new CustomEvent('panel-game-show-code', { detail: { panelId: p.id } }));
                                                }}
                                                className="rounded"
                                              />
                                              Show generated code (preview)
                                            </label>
                                          </div>
                                        </>
                                      ) : (
                                        <>
                                          {/* Image/Video Panel Edit UI (existing) */}
                                          <div className="text-xs font-medium text-gray-800 dark:text-gray-200 mb-2">Edit with</div>
                                          <select
                                            value={actionModel}
                                            onChange={(e) => setActionModel(e.target.value as any)}
                                            onMouseDown={(e) => e.stopPropagation()}
                                            onPointerDown={(e) => e.stopPropagation()}
                                            disabled={isQuickEditLoading}
                                            className="w-full text-sm bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 mb-2 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                                          >
                                            <option value="nano-banana">Nano Banana Pro</option>
                                            <option value="recraft">Recraft</option>
                                            <option value="seedream">Seedream 4.5</option>
                                            <option value="flux-kontext">Flux Kontext</option>
                                            <option value="qwen-edit">Qwen Edit</option>
                                            <option value="ideogram">Ideogram</option>
                                          </select>
                                          {/* Object selection dropdown - only show if objects detected and Seedream selected */}
                                          {actionModel === 'seedream' && p.detectedObjects && p.detectedObjects.length > 0 && (
                                            <>
                                              <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Target Object (optional)</label>
                                              <select
                                                value={actionTargetObject}
                                                onChange={(e) => setActionTargetObject(e.target.value)}
                                                onMouseDown={(e) => e.stopPropagation()}
                                                onPointerDown={(e) => e.stopPropagation()}
                                                disabled={isQuickEditLoading}
                                                className="w-full text-sm bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 mb-2 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                                              >
                                                <option value="">Edit entire image</option>
                                                {p.detectedObjects.map((obj, idx) => (
                                                  <option key={idx} value={obj}>
                                                    Edit: {obj}
                                                  </option>
                                                ))}
                                              </select>
                                            </>
                                          )}
                                          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Prompt</label>
                                          <textarea
                                            value={actionPrompt}
                                            onChange={(e)=>{ setActionPrompt(e.target.value); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = Math.min(200, e.currentTarget.scrollHeight) + 'px'; }}
                                            onMouseDown={(e) => e.stopPropagation()}
                                            onPointerDown={(e) => e.stopPropagation()}
                                            onKeyDown={(e)=>{ if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && actionPrompt.trim() && !isQuickEditLoading) { e.preventDefault(); handleQuickEdit(p); } }}
                                            placeholder="Describe the edit..."
                                            rows={2}
                                            disabled={isQuickEditLoading}
                                            className="w-full text-sm bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 mb-2 resize-none focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                                          />
                                          <div className="flex gap-2 justify-end pt-1">
                                            <button 
                                              className="px-2 py-1 text-xs rounded bg-gray-200 dark:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed" 
                                              onClick={()=>{ setActionMenuFor(null); setActionPrompt(''); setActionTargetObject(''); }}
                                              disabled={isQuickEditLoading}
                                            >Cancel</button>
                                            <button
                                              className={`px-2 py-1 text-xs rounded flex items-center gap-1.5 ${actionPrompt.trim() && !isQuickEditLoading ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-gray-300 text-gray-600 cursor-not-allowed'}`}
                                              disabled={!actionPrompt.trim() || isQuickEditLoading}
                                              onClick={()=>handleQuickEdit(p)}
                                            >
                                              {isQuickEditLoading ? (
                                                <>
                                                  <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                  </svg>
                                                  <span>Generating...</span>
                                                </>
                                              ) : (
                                                'Apply'
                                              )}
                                            </button>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </>
                              )}
                              {p.type === 'image' || p.type === 'gif' ? (
                                <>
                                  <img src={p.url} alt="panel" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                  <PanelObjectTags panel={p} position="top-left" compact={true} />
                                  <SAM3MaskOverlay panel={p} />
                                </>
                              ) : p.type === 'video' ? (
                                <video src={p.url} muted loop autoPlay playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              ) : p.type === 'game' ? (
                                <div style={{ position: 'absolute', inset: 0 }}>
                                  <React.Suspense fallback={<div className="w-full h-full flex items-center justify-center text-xs text-gray-500">Loading game...</div>}>
                                    <GameViewerLazy gameCode={(p as any).gameCode || ''} className="w-full h-full" panelId={p.id} />
                                  </React.Suspense>
                                </div>
                              ) : p.type === 'palette' ? (
                                <div
                                  style={{
                                    width: '100%',
                                    height: '100%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: 'transparent',
                                    animation: 'fadeIn 0.7s ease-out forwards'
                                  }}
                                >
                                  {(() => {
                                    let colors: string[] = [];
                                    try {
                                      const parsed = JSON.parse(p.url || p.caption || '{}');
                                      if (Array.isArray(parsed?.colors)) colors = parsed.colors.slice(0, 7);
                                    } catch {}
                                    if (!colors.length) colors = ['#fbbf24','#ef4444','#8b5cf6','#10b981','#60a5fa'];
                                    const circleSize = 56;
                                    const overlap = 20;
                                    return (
                                      <div style={{ position: 'relative', height: circleSize, width: circleSize + (colors.length - 1) * (circleSize - overlap) }}>
                                        {colors.map((c, i) => (
                                          <div key={i} style={{
                                            position: 'absolute', left: i * (circleSize - overlap), top: 0,
                                            width: circleSize, height: circleSize,
                                            borderRadius: '9999px', background: c,
                                            boxShadow: '0 1px 4px rgba(0,0,0,0.25)'
                                          }} />
                                        ))}
                                      </div>
                                    );
                                  })()}
                                </div>
                              ) : p.type === '3d' ? (
                                <model-viewer
                                  src={p.url}
                                  alt="3D Model"
                                  camera-controls="true"
                                  auto-rotate="true"
                                  interaction-prompt="none"
                                  camera-orbit="0deg 75deg auto"
                                  style={{ width: '100%', height: '100%', background: 'transparent', pointerEvents: 'auto' }}
                                  exposure="1.0"
                                  shadow-intensity="0.85"
                                />
                              ) : p.type === 'notion' ? (
                                // In board mode, render Notion panel non-interactive to preserve drag/selection UX
                                <NotionPanel 
                                  panelId={p.id} 
                                  pageId={p.url} 
                                  interactive={!!notionInteractiveIds[p.id]}
                                  onRemove={() => handleRemovePanel(p.id, pi)}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">{p.type}</div>
                              )}
        {/* Resize handle for ALL panels - includes Notion and Palette */}
        {true && (
                                <button
                                  onMouseDown={(e) => {
                                    e.preventDefault(); 
                                    e.stopPropagation();
                                    // Set a flag to prevent panel drag (only for game panels)
                                    if (p.type === 'game') {
                                      const panel = e.currentTarget.closest('[data-panel-id]');
                                      if (panel) panel.setAttribute('data-resizing', 'true');
                                    }
                                    
                                    const startX = e.clientX; 
                                    const startY = e.clientY; 
                                    const start = panelScales[p.id] || 1;
                                    
                                    const move = (ev: MouseEvent) => {
                                      ev.preventDefault();
                                      const dx = ev.clientX - startX; 
                                      const dy = ev.clientY - startY;
                                      const delta = Math.max(dx, dy) / 240; // gentle scale change
                                      const next = Math.max(0.8, Math.min(1.6, Number((start + delta).toFixed(2))));
                                      try { 
                                        document.dispatchEvent(new CustomEvent('panel-scale-set', { detail: { id: p.id, scale: next } })); 
                                      } catch {}
                                    };
                                    
                                    const up = () => { 
                                      window.removeEventListener('mousemove', move); 
                                      window.removeEventListener('mouseup', up);
                                      // Clear the resizing flag (only for game panels)
                                      if (p.type === 'game') {
                                        const panel = document.querySelector(`[data-panel-id="${p.id}"]`);
                                        if (panel) panel.removeAttribute('data-resizing');
                                      }
                                    };
                                    
                                    window.addEventListener('mousemove', move); 
                                    window.addEventListener('mouseup', up);
                                  }}
                                  className="absolute bottom-1 right-1 w-5 h-5 rounded bg-gray-800/90 text-white text-[10px] flex items-center justify-center cursor-nwse-resize shadow z-20"
                                  title="Resize panel"
                                  style={{ pointerEvents: 'auto' }}
                                >↘</button>
                              )}
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
                  )}
                  {/* Hon Indicator - inside panel grid for focus mode highlighting (hidden in world mode) */}
                  {!isWorldMode && (
                    <HonIndicator isOverviewMode={scale <= overviewThreshold} />
                  )}
                </div>
              </div>
              {/* Lasso overlay at container level */}
              {scale <= overviewThreshold && marquee.active && (
                <div
                  className="pointer-events-none absolute border-2 border-blue-400/70 bg-blue-400/10 rounded"
                  style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
                />
              )}
            </div>
            
            {/* Hon Indicator for World Mode - fixed position above world mode layer */}
            {isWorldMode && (
              <div className="absolute bottom-4 right-4 z-[60] pointer-events-auto">
                <HonIndicator isOverviewMode={true} />
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Page Manager positioning: docked bottom normally; vertical side when editor is open */}
      {/* z-[60] ensures it's above world mode layers which use z-10 to z-50 */}
      {!isPanelEditorOpen ? (
        <div className="fixed bottom-0 left-0 right-0 flex items-center pb-4 z-[60]">
          <div className="flex-1 flex justify-center">
            <PageManager
              currentPageIndex={currentPageIndex}
              totalPages={currentComic?.pages.length || 0}
              onPageChange={handlePageChange}
              onAddPage={handleAddPage}
              onDeletePage={handleDeletePage}
              orientation="horizontal"
              onRestoreSnapshot={handleRestoreSnapshot}
            />
          </div>
        </div>
      ) : (
        <div className="fixed top-24 right-4 z-[60] h-[72vh] w-16 flex items-start justify-center">
          <PageManager
            currentPageIndex={currentPageIndex}
            totalPages={currentComic?.pages.length || 0}
            onPageChange={handlePageChange}
            onAddPage={handleAddPage}
            onDeletePage={handleDeletePage}
            orientation="vertical"
            initialPosition={{ x: 96, y: 25 }}
            onRestoreSnapshot={handleRestoreSnapshot}
          />
        </div>
      )}
    </div>
  );
};