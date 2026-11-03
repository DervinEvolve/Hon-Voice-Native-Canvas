import React, { useState, useEffect, useRef } from 'react';
import { Panel, Template } from '../../types';
import { PanelEditor } from './PanelEditor';
import { nanoid } from 'nanoid';
import { mediaService } from '../../utils/mediaService';
import { Loader2, Users, Lock, ArrowUpRight } from 'lucide-react';
import { useCollaboration } from '../../contexts/CollaborationContext';
import { useHonPresence } from '../../hooks/useHonPresence';
// HonPresenceTooltip removed globally per UX request
import { useComicStore } from '../../store/useComicStore';
import { SAM3MaskOverlay } from './SAM3MaskOverlay';

interface Props {
  panels: Panel[];
  template: Template | null;
  onUpdatePanel: (panel: Panel, pageIndex: number) => void;
  onRemovePanel: (panelId: string) => void;
  onReorderPanels: (startIndex: number, endIndex: number, pageIndex: number) => void;
  onAddPanel?: (index: number) => void;
  pageIndex: number;
  compact?: boolean;
}

export const PanelGrid: React.FC<Props> = ({
  panels,
  template,
  onUpdatePanel,
  onRemovePanel,
  onReorderPanels,
  onAddPanel,
  pageIndex,
  compact = false
}) => {
  const visionOverlays = useComicStore(s => s.visionOverlays);
  const panelGenerationProgress = useComicStore(s => s.panelGenerationProgress);
  const [uploadingPanels, setUploadingPanels] = useState<Record<number, boolean>>({});
  
  // Disable collaboration features temporarily
  const disableCollaboration = true;
  
  // Add collaboration context
  const { isPanelLocked, activeCollaborators, updatePresence, collaborators } = useCollaboration();
  const honPresence = useHonPresence();
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [isHover, setIsHover] = useState(false);
  const selectedPanelIds = useComicStore(s => s.selectedPanelIds || []);
  
  // Only update presence with current page when the page changes if collaboration is active
  useEffect(() => {
    // Skip if collaboration is disabled
    if (disableCollaboration) return;
    
    // Only enable collaboration features if there are actual collaborators
    const hasCollaborators = collaborators && collaborators.length > 0;
    
    if (hasCollaborators) {
      updatePresence({ currentPageIndex: pageIndex });
    }
  }, [pageIndex, updatePresence, collaborators]);

  if (!template) {
    return (
      <div className="min-h-[700px] bg-gray-50 rounded-lg p-4 flex items-center justify-center">
        <p className="text-gray-500">Select a template to start</p>
      </div>
    );
  }

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateRows: `repeat(${template.layout.rows}, minmax(0, 1fr))`,
    gridTemplateColumns: `repeat(${template.layout.cols}, minmax(0, 1fr))`,
    gap: compact ? '0.5rem' : '1.5rem',
    padding: compact ? '0.5rem' : '1.5rem',
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (compact) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.add('border-blue-500', 'bg-blue-50');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (compact) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50');
  };

  // Modify handleDrop to check if panel is being edited by someone else
  const handleDrop = async (e: React.DragEvent, index: number) => {
    if (compact) return;
    e.preventDefault();
    e.stopPropagation();
    
    e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50');
    
    // Check if panel exists and is locked (skip if collaboration is disabled)
    const existingPanel = panels[index];
    if (!disableCollaboration && existingPanel && isPanelLocked(existingPanel.id)) {
      // Find who's editing this panel
      const editor = activeCollaborators.find(c => c.selectedPanelId === existingPanel.id);
      const editorName = editor ? editor.username : 'someone else';
      
      // Show a visual indication that the panel is locked (could use a toast here)
      console.warn(`Panel is currently being edited by ${editorName}`);
      return;
    }
    
    // Try to get panel data first
    const jsonData = e.dataTransfer.getData('application/json');
    if (jsonData) {
      try {
        const panel = JSON.parse(jsonData);
        panel.position = { ...template.layout.areas[index].position };
        onUpdatePanel(panel, pageIndex);
        return;
      } catch (error) {
        console.error('Failed to parse panel data:', error);
      }
    }
    
    // Fall back to file handling
    if (e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      
      if (uploadingPanels[index]) {
        return;
      }

      try {
        setUploadingPanels(prev => ({ ...prev, [index]: true }));
        
        // Upload to Cloudinary first
        const cloudinaryUrl = await mediaService.upload(file);
        
        // Create panel with final URL only
        const panel: Panel = {
          id: nanoid(),
          type: file.type.startsWith('video/') ? 'video' : 
                file.type.includes('gif') ? 'gif' : 'image',
          url: cloudinaryUrl,
          size: 'medium',
          aspectRatio: 1,
          position: { ...template.layout.areas[index].position },
          caption: ''
        };
        
        // Single update with final URL
        onUpdatePanel(panel, pageIndex);
        setUploadingPanels(prev => ({ ...prev, [index]: false }));

      } catch (error) {
        console.error('Failed to upload file:', error);
        alert('Failed to upload file. Please try again.');
        setUploadingPanels(prev => ({ ...prev, [index]: false }));
      }
    } else if (onAddPanel) {
      onAddPanel(index);
    }
  };

  // Function to render collaborator indicators for empty panels
  const renderCollaboratorIndicator = (index: number) => {
    // Skip if collaboration is disabled
    if (disableCollaboration) return null;
    
    // Only show collaborator indicators if there are actual collaborators
    const hasCollaborators = collaborators && collaborators.length > 0;
    if (!hasCollaborators) return null;
    
    // Check if this panel position has any active collaborators viewing/editing it
    const panelAtPosition = panels[index];
    if (!panelAtPosition) return null;
    
    const editor = activeCollaborators.find(c => c.selectedPanelId === panelAtPosition.id);
    if (!editor) return null;
    
    return (
      <div className="absolute top-2 right-2 z-10 bg-gray-800/80 backdrop-blur-sm p-1.5 rounded-full flex items-center space-x-1">
        <Lock className="w-4 h-4 text-red-400" />
        {editor.avatarUrl ? (
          <img 
            src={editor.avatarUrl} 
            alt={editor.username}
            className="w-4 h-4 rounded-full"
          />
        ) : (
          <Users className="w-4 h-4 text-blue-400" />
        )}
      </div>
    );
  };

  // Quick action: Create more images in the same style and location
  const renderQuickAction = (panel: Panel) => {
    if (panel.type !== 'image') return null;
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          try {
            // Fire UI entrypoint on the EVI service without opening chat
            // @ts-ignore
              import('../../services/humeEviService').then(m => m.humeEviService.createMoodBoardFromUI({
              reference_image_url: panel.url,
              count: 7,
              include_videos: true,
              aspect_ratio: '1:1',
              style_prompt: 'same style and location (environment first)'
            }));
          } catch (err) {
            console.warn('Quick action failed', err);
          }
        }}
        className="absolute top-2 left-2 z-10 px-2.5 py-1.5 rounded-full bg-white/85 dark:bg-gray-900/85 text-gray-800 dark:text-gray-100 shadow hover:bg-white transition text-xs font-medium flex items-center gap-1"
        title="Create more images in the same style and location"
      >
        <ArrowUpRight className="w-3.5 h-3.5" />
        Create more in this style
      </button>
    );
  };

  return (
    <div className="relative">
      {/* Grid container */}
      <div 
        id="comic-page-container"
        ref={gridRef}
        style={gridStyle} 
        className={`${compact ? '' : 'min-h-[700px]'} bg-gray-50 dark:bg-gray-900 rounded-lg`}
        onMouseEnter={() => setIsHover(true)}
        onMouseLeave={() => setIsHover(false)}
        // Lasso selection is only for board mode; no marquee handlers here
      >
      {template.layout.areas.map((area, index) => {
        const panel = panels[index]?.type === 'palette' ? null : panels[index];
        const gridItemStyle = {
          gridRow: `${area.position.row + 1} / span ${area.position.rowSpan || 1}`,
          gridColumn: `${area.position.col + 1} / span ${area.position.colSpan || 1}`,
        };

        if (!panel) {
          return (
            <div 
              key={`empty-${index}`} 
              style={gridItemStyle} 
              className="relative bg-gray-100 dark:bg-gray-800 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 flex items-center justify-center group transition-colors duration-200"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
            >
              <div className="text-center p-6">
                <p className="text-sm text-gray-500 group-hover:text-gray-700">Drop here</p>
              </div>
            </div>
          );
        }

        // Selection highlight should only appear in board mode; PanelGrid is focus mode, so ignore selection ring
        const isSelected = false;
        const genState = panelGenerationProgress[panel.id];
        return (
          <div key={panel.id} data-panel-id={panel.id} style={gridItemStyle} className={`relative group ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-50 dark:ring-offset-gray-900' : ''}`}>
            {renderQuickAction(panel)}
            {genState?.isGenerating && (
              <div
                className="pointer-events-none absolute inset-0 z-10 rounded-lg"
                style={{
                  boxShadow: '0 0 30px 10px rgba(139, 92, 246, 0.6)',
                  outline: '6px solid rgba(139, 92, 246, 1.0)'
                }}
              />
            )}
            {uploadingPanels[index] && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
                <Loader2 className="w-6 h-6 animate-spin text-white" />
              </div>
            )}
            
            {/* Add collaboration indicator */}
            {renderCollaboratorIndicator(index)}
            
            <PanelEditor
              panel={panel}
              onUpdate={(updatedPanel) => onUpdatePanel(updatedPanel, pageIndex)}
              onRemove={onRemovePanel}
              compact={compact}
            />
            {/* Isaac vision overlay */}
            {panel.type === 'image' && visionOverlays[panel.id] && (
              <div className="pointer-events-none absolute inset-0 z-10">
                {visionOverlays[panel.id].responseStyle === 'box' && Array.isArray(visionOverlays[panel.id].boxes) && visionOverlays[panel.id].boxes!.map((b, i) => (
                  <div key={i} className="absolute border border-orange-400/80 bg-orange-500/10 rounded-sm" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.width * 100}%`, height: `${b.height * 100}%` }} />
                ))}
                {visionOverlays[panel.id].responseStyle === 'point' && Array.isArray(visionOverlays[panel.id].points) && visionOverlays[panel.id].points!.map((p, i) => (
                  <div key={i} className="absolute w-2 h-2 -ml-1 -mt-1 rounded-full bg-orange-400 shadow" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} />
                ))}
                {visionOverlays[panel.id].responseStyle === 'polygon' && Array.isArray(visionOverlays[panel.id].polygons) && visionOverlays[panel.id].polygons!.map((poly, i) => (
                  <svg key={i} className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                    <polygon points={poly.points.map(pt => `${pt.x * 100},${pt.y * 100}`).join(' ')} fill="rgba(249,115,22,0.15)" stroke="rgba(251,146,60,0.9)" strokeWidth="0.5" />
                  </svg>
                ))}
              </div>
            )}
            {/* SAM3 mask boundaries overlay */}
            {panel.type === 'image' && (() => {
              return <SAM3MaskOverlay panel={panel} />;
            })()}
          </div>
        );
      })}
      </div>
      {/* Tooltip removed */}
    </div>
  );
};