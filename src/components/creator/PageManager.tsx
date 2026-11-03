import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash, Move, HelpCircle, Mic, MicOff, Clock } from 'lucide-react';
import { useComicStore } from '../../store/useComicStore';
// HonTooltips removed globally per UX request
import { ThemeToggle } from '../common/ThemeToggle';
import { Panel, Comic, Template } from '../../types';
import { nanoid } from 'nanoid';
import { ExportButton } from './ExportButton';
import { CollaborationButton } from './CollaborationButton';
import { CollaborationModal } from './CollaborationModal';
import { collaboratorService } from '../../services/collaboratorService';
import { humeEviService, HonSessionStatus } from '../../services/humeEviService';
import { CanvasTimeline } from './CanvasTimeline';

interface PageManagerProps {
  currentPageIndex?: number;
  totalPages?: number;
  onPageChange?: (index: number) => void;
  onAddPage?: () => void;
  onDeletePage?: (index: number) => void;
  orientation?: 'horizontal' | 'vertical';
  initialPosition?: { x: number; y: number };
  onRestoreSnapshot?: (snapshotId: string) => Promise<void>;
}

export const PageManager: React.FC<PageManagerProps> = ({
  currentPageIndex: propCurrentPageIndex,
  totalPages,
  onPageChange,
  onAddPage: propOnAddPage,
  onDeletePage: propOnDeletePage,
  orientation = 'horizontal',
  initialPosition,
  onRestoreSnapshot
}) => {
  const { 
    currentComic, 
    currentPageIndex: storeCurrentPageIndex, 
    setCurrentPageIndex, 
    addPage,
    removePage,
    updatePanel
  } = useComicStore();

  // Use props if provided, otherwise use store values
  const currentPageIndex = propCurrentPageIndex !== undefined ? propCurrentPageIndex : storeCurrentPageIndex;
  
  const comic = currentComic as (Comic | null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [showCollabModal, setShowCollabModal] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [showManualTip, setShowManualTip] = useState(false);
  const [honStatus, setHonStatus] = useState<HonSessionStatus>('idle');
  const [isHonMuted, setIsHonMuted] = useState(false);
  
  // State for draggable functionality
  const [position, setPosition] = useState({ x: 50, y: 90 }); // Default position percentage
  const [isDragging, setIsDragging] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const managerRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [isBoardMode, setIsBoardMode] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [showTimeline, setShowTimeline] = useState(false);
  const [managerWidth, setManagerWidth] = useState<number | undefined>(undefined);

  // Load saved position from localStorage on component mount
  useEffect(() => {
    const savedPosition = localStorage.getItem('pageManagerPosition');
    if (savedPosition) {
      try {
        setPosition(JSON.parse(savedPosition));
      } catch (error) {
        console.error('Error parsing saved position:', error);
      }
    } else if (initialPosition) {
      setPosition(initialPosition);
    }
  }, [initialPosition]);

  // Allow external minimize/restore via event
  useEffect(() => {
    const onSet = (e: any) => {
      const desired = Boolean(e?.detail?.collapsed);
      setCollapsed(desired);
    };
    document.addEventListener('page-manager-set-collapsed', onSet as EventListener);
    return () => document.removeEventListener('page-manager-set-collapsed', onSet as EventListener);
  }, []);

  // Track manager width for timeline
  useEffect(() => {
    if (!managerRef.current) return;
    
    const updateWidth = () => {
      if (managerRef.current) {
        setManagerWidth(managerRef.current.offsetWidth);
      }
    };
    
    updateWidth();
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(managerRef.current);
    
    return () => resizeObserver.disconnect();
  }, [collapsed, showTimeline]);

  // Subscribe to Hon (Hume EVI) status for mic control state
  useEffect(() => {
    const unsubscribe = humeEviService.onStatusChange((status) => {
      setHonStatus(status);
      if (status === 'idle' || status === 'error') {
        setIsHonMuted(false);
      }
    });
    return unsubscribe;
  }, []);

  // Detect board mode via custom events; default false
  useEffect(() => {
    const enter = () => setIsBoardMode(true);
    document.addEventListener('enter-board-mode', enter as EventListener);
    return () => document.removeEventListener('enter-board-mode', enter as EventListener);
  }, []);

  // Close the small add menu on outside click
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (showAddMenu && addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showAddMenu]);

  // When orientation changes to vertical and an initial position is provided, snap near that spot
  useEffect(() => {
    if (orientation === 'vertical' && initialPosition) {
      setPosition(initialPosition);
    }
  }, [orientation, initialPosition]);

  // Save position to localStorage when it changes
  useEffect(() => {
    if (!isDragging) {
      localStorage.setItem('pageManagerPosition', JSON.stringify(position));
    }
  }, [position, isDragging]);

  const handleDragStart = (e: React.MouseEvent) => {
    // Only start dragging if clicking the move handle or its container
    if (!(e.target as HTMLElement).closest('.drag-handle')) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    
    const rect = managerRef.current?.getBoundingClientRect();
    if (rect) {
      setStartPos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
    }
  };

  const handleDragMove = (e: MouseEvent) => {
    if (isDragging) {
      e.preventDefault();
      e.stopPropagation();
      
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      // Calculate new position in viewport percentage
      const newX = ((e.clientX - startPos.x) / viewportWidth) * 100;
      const newY = ((e.clientY - startPos.y) / viewportHeight) * 100;
      
      // Constrain to viewport boundaries
      const boundedX = Math.max(0, Math.min(newX, 90));
      const boundedY = Math.max(0, Math.min(newY, 90));
      
      setPosition({ x: boundedX, y: boundedY });
    }
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  const handlePrevPage = () => {
    if (currentPageIndex > 0) {
      if (onPageChange) {
        onPageChange(currentPageIndex - 1);
      } else {
        setCurrentPageIndex(currentPageIndex - 1);
      }
    }
  };

  const handleNextPage = () => {
    if (comic && currentPageIndex < comic.pages.length - 1) {
      if (onPageChange) {
        onPageChange(currentPageIndex + 1);
      } else {
        setCurrentPageIndex(currentPageIndex + 1);
      }
    }
  };

  const handleAddPage = () => {
    if (propOnAddPage) {
      propOnAddPage();
    } else {
      addPage();
    }
  };

  const handleDeletePage = () => {
    if (propOnDeletePage && currentPageIndex !== undefined) {
      propOnDeletePage(currentPageIndex);
    } else {
      removePage(currentPageIndex);
    }
  };

  const handleGenerateStory = async (prompt: string, generatedUrl: string, type: 'image' | 'video' | 'gif', panel?: Panel) => {
    if (!comic || comic.pageTemplates[currentPageIndex] === undefined) return;
    
    try {
      const template = comic.pageTemplates[currentPageIndex] as Template;
      // Initialize empty page if it doesn't exist
      if (!comic.pages[currentPageIndex]) {
        comic.pages[currentPageIndex] = [];
      }

      if (panel) {
        // If a panel object is provided, use it directly
        console.log('Updating panel with:', panel);
        updatePanel(panel, currentPageIndex);
      } else {
        // Find next available position in template
        const usedPositions = comic.pages[currentPageIndex].map((p: Panel) => `${p.position.row}-${p.position.col}`);
        let nextPosition = template?.layout.areas.find((area: any) => 
          !usedPositions.includes(`${area.position.row}-${area.position.col}`)
        )?.position;

        // If no position found, use the first position
        if (!nextPosition && template?.layout.areas.length > 0) {
          nextPosition = template.layout.areas[0].position;
        }

        // Create a new panel for subsequent generations
        if (nextPosition) {
          const newPanel: Panel = {
            id: nanoid(),
            type,
            url: generatedUrl,
            size: 'medium',
            aspectRatio: 1,
            position: nextPosition,
            caption: prompt
          };
          console.log('Creating new panel:', newPanel);
          updatePanel(newPanel, currentPageIndex);
        }
      }
    } catch (error) {
      console.error('Failed to update panel:', error);
    }
  };

  const checkIs2x2Template = () => {
    if (!comic || comic.pageTemplates[currentPageIndex] === undefined) return false;
    const template = comic.pageTemplates[currentPageIndex] as Template;
    return template?.layout.areas.length === 4;
  };

  const handleOpenCollabModal = () => {
    setShowCollabModal(true);
  };

  const handleCloseCollabModal = () => {
    setShowCollabModal(false);
  };

  const handleInviteCollaborator = async (email: string) => {
    if (!comic?.id) return;
    
    setIsInviting(true);
    
    try {
      const invite = await collaboratorService.inviteCollaborator(comic.id, email);
      console.log('Invitation sent:', invite);
      setShowCollabModal(false);
    } catch (error) {
      console.error('Failed to send invitation:', error);
    } finally {
      setIsInviting(false);
    }
  };

  if (!comic) return null;

  return (
    <>
      {/* Hon Tooltips removed per UX request */}
      
      <div 
        ref={managerRef}
        className={`fixed ${collapsed ? '' : (orientation === 'vertical' ? 'flex flex-col space-y-3' : 'flex items-center space-x-3')} bg-transparent z-50 select-none`}
        style={{
          left: `${position.x}%`,
          top: `${position.y}%`,
          cursor: isDragging ? 'grabbing' : 'auto',
          transform: 'scale(0.81)',
          transformOrigin: 'top left'
        }}
        onMouseDown={handleDragStart}
        onMouseMove={(e) => isDragging && handleDragMove(e.nativeEvent)}
        onMouseUp={handleDragEnd}
        onMouseLeave={handleDragEnd}
      >
        {/* Collapsed dot UI */}
        {collapsed ? (
          <button
            className="drag-handle w-5 h-5 rounded-full bg-gray-800/90 border border-gray-700 shadow flex items-center justify-center hover:bg-gray-700"
            onDoubleClick={() => setCollapsed(false)}
            title="Double-click to expand"
          >
            <Move className="w-3 h-3 text-gray-300" />
          </button>
        ) : (
          <div className="bg-gray-800/90 backdrop-blur-sm rounded-full shadow-lg border border-gray-700 px-3 py-2" onClick={(e) => e.stopPropagation()}>
          <div className={`${orientation === 'vertical' ? 'flex flex-col items-center gap-2' : 'flex items-center gap-2'}`}>
            <div 
              className="p-1 rounded-full hover:bg-gray-700 transition-colors cursor-grab active:cursor-grabbing drag-handle"
            >
              <Move className="w-4 h-4 text-gray-300" />
            </div>
            
          <button 
            onClick={handlePrevPage}
            className="p-1.5 rounded-full hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-gray-300" />
          </button>
          
          <span className="text-xs font-medium text-gray-300">
            Page {currentPageIndex + 1} of {comic.pages.length}
          </span>
          
          <button 
            onClick={handleNextPage}
            className="p-1.5 rounded-full hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-4 h-4 text-gray-300" />
          </button>

          <div className="relative" ref={addMenuRef}>
            <button 
              onClick={() => {
                if (isBoardMode) setShowAddMenu((v) => !v); else handleAddPage();
              }} 
              className="p-1.5 rounded-full hover:bg-gray-700 transition-colors"
              title={isBoardMode ? 'Add…' : 'Add page'}
            >
              <Plus className="w-4 h-4 text-gray-300" />
            </button>
            {isBoardMode && showAddMenu && (
              <div className="absolute bottom-full mb-3 left-0 bg-gray-800/95 text-gray-200 backdrop-blur-sm rounded-lg shadow-xl py-2 min-w-48 z-50 border border-gray-700/60">
                <button
                  onClick={() => { setShowAddMenu(false); handleAddPage(); }}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-700 transition-colors"
                >
                  Add Page
                </button>
                <button
                  onClick={() => {
                    setShowAddMenu(false);
                    try {
                      // Create a Notion page on first insertion
                      (async () => {
                        const { currentComic, currentPageIndex, updatePanel } = useComicStore.getState();
                        const template = currentComic?.pageTemplates[currentPageIndex];
                        const pos = template?.layout?.areas?.[0]?.position || { row: 0, col: 0 };
                        // Do not auto-create a new Notion page here; let the panel manage OAuth and creation
                        const panel = { id: nanoid(), type: 'notion', url: '', caption: '', size: 'medium', aspectRatio: 1, position: pos };
                        updatePanel(panel, currentPageIndex);
                      })();
                    } catch {}
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-700 transition-colors"
                >
                  Add Notion Panel
                </button>
              </div>
            )}
          </div>

          <div className={`${orientation === 'vertical' ? 'h-px w-6' : 'w-px h-4'} bg-gray-700 mx-2`} />

          {/* Mic control (moved from Invite Hon in Collaboration Modal) */}
          <div className="relative group">
            <button
              onClick={async () => { try { await humeEviService.toggleMute(); setIsHonMuted(v => !v); } catch (e) { console.warn('Toggle mute failed', e); } }}
              disabled={honStatus !== 'active'}
              className={`h-8 w-8 rounded-full flex items-center justify-center border transition-colors ${honStatus !== 'active' ? 'opacity-50 cursor-not-allowed border-gray-700 bg-gray-800' : (isHonMuted ? 'bg-purple-700 border-purple-600' : 'bg-purple-600 hover:bg-purple-700 border-purple-500')}`}
              title={honStatus !== 'active' ? 'Start Hon to enable mic' : (isHonMuted ? 'Unmute microphone' : 'Mute microphone')}
              aria-label={isHonMuted ? 'Unmute Microphone' : 'Mute Microphone'}
            >
              {isHonMuted ? <MicOff className="w-4 h-4 text-white" /> : <Mic className="w-4 h-4 text-white" />}
            </button>
            {honStatus !== 'active' ? (
              <div className="pointer-events-none absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1.5 text-xs font-medium text-white bg-purple-500 rounded shadow-lg opacity-0 group-hover:opacity-100 whitespace-nowrap">
                Start Hon to enable mic
              </div>
            ) : (
              <div className="pointer-events-none absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1.5 text-xs font-medium text-white bg-purple-500 rounded shadow-lg opacity-0 group-hover:opacity-100 whitespace-nowrap">
                {isHonMuted ? 'Unmute mic' : 'Mute mic'}
              </div>
            )}
          </div>

          <div className={`${orientation === 'vertical' ? 'h-px w-6' : 'w-px h-4'} bg-gray-700 mx-2`} />
          
          <button 
            onClick={() => setShowManualTip(true)}
            className="p-1.5 rounded-full hover:bg-gray-700 transition-colors"
            title="Show Hon communication tips"
          >
            <HelpCircle className="w-4 h-4 text-gray-300" />
          </button>
          
          <button 
            onClick={handleDeletePage}
            className="p-1.5 rounded-full hover:bg-gray-700 transition-colors"
            title="Delete page"
          >
            <Trash className="w-4 h-4 text-gray-300" />
          </button>
          
          <CollaborationButton onClick={handleOpenCollabModal} />
          
          <ExportButton containerId="comic-page-container" />
          
          <div className="relative">
            <button
              onClick={() => setShowTimeline(!showTimeline)}
              className={`p-1.5 rounded-full hover:bg-gray-700 transition-colors ${showTimeline ? 'bg-gray-700' : ''}`}
              title="Show canvas timeline"
            >
              <Clock className="w-4 h-4 text-gray-300" />
            </button>
            {showTimeline && comic && managerWidth && (
              <CanvasTimeline
                projectId={comic.id}
                onRestore={onRestoreSnapshot}
                onClose={() => setShowTimeline(false)}
                parentWidth={managerWidth}
              />
            )}
          </div>
          
          <ThemeToggle />
          {/* tiny collapse toggle */}
          <button
            onClick={() => setCollapsed(true)}
            className="ml-1 w-4 h-4 rounded-full bg-gray-700 text-gray-300 text-[10px] flex items-center justify-center hover:bg-gray-600"
            title="Collapse"
          >
            –
          </button>
          </div>
        </div>
        )}
      </div>

      <CollaborationModal 
        isOpen={showCollabModal}
        onClose={handleCloseCollabModal}
        onInvite={handleInviteCollaborator}
        isInviting={isInviting}
      />
    </>
  );
};