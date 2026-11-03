import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Panel } from '../../types';
import { PanelEditor } from './PanelEditor';
import { nanoid } from 'nanoid';
import { Plus, Minus, Trash2 } from 'lucide-react';
import { mediaService } from '../../utils/mediaService';
import { useComicStore } from '../../store/useComicStore';
import { motion, AnimatePresence } from 'framer-motion';

interface CustomCanvasProps {
  panels: Panel[];
  onUpdatePanel: (panel: Panel, pageIndex: number) => void;
  onRemovePanel: (panelId: string) => void;
  pageIndex: number;
}

export const CustomCanvas: React.FC<CustomCanvasProps> = ({
  panels,
  onUpdatePanel,
  onRemovePanel,
  pageIndex
}) => {
  // Use global selectedPanelId from store for Hon Assistant tool integration
  const { selectedPanelId } = useComicStore();
  const setSelectedPanelId = useComicStore(state => state.setSelectedPanelId);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, panelId: '' });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, panelId: '', originalSize: { width: 0, height: 0 } });
  const gridRef = useRef<HTMLDivElement>(null);
  
  // Tooltip state
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);

  // Default panel size
  const DEFAULT_PANEL_SIZE = { width: 300, height: 200 };
  
  // Force grid expansion by updating state
  const [minGridCells, setMinGridCells] = useState(4); // Minimum 4 cells to start
  
  // Calculate optimal grid layout that fills space efficiently
  const calculateGridLayout = () => {
    // Always start with minGridCells as the base
    const baseArea = Math.max(4, minGridCells); // Never go below 4 cells
    
    if (panels.length === 0) {
      // No content - use minGridCells to determine size
      const cols = Math.ceil(Math.sqrt(baseArea));
      const rows = Math.ceil(baseArea / cols);
      const result = { rows: Math.max(2, rows), cols: Math.max(2, cols) };
      console.log(`Grid calc (empty): minCells=${minGridCells}, result=${result.rows}x${result.cols}`);
      return result;
    }

    // Calculate total span area needed by all panels
    const totalSpanArea = panels.reduce((total, panel) => {
      const colSpan = panel.position.colSpan || 1;
      const rowSpan = panel.position.rowSpan || 1;
      return total + (colSpan * rowSpan);
    }, 0);

    // Only use minGridCells - don't auto-expand for content
    // If content doesn't fit, user must click + to add space
    const requiredArea = baseArea;
    
    // Calculate optimal grid dimensions
    const cols = Math.ceil(Math.sqrt(requiredArea * 1.1)); // Slightly wider ratio
    const rows = Math.ceil(requiredArea / cols);
    
    const result = { rows: Math.max(2, rows), cols: Math.max(2, cols) };
    console.log(`Grid calc: panels=${panels.length}, spanArea=${totalSpanArea}, minCells=${minGridCells}, required=${requiredArea}, result=${result.rows}x${result.cols}`);
    
    return result;
  };

  const gridLayout = calculateGridLayout();

  // Intelligent panel repositioning to avoid overlaps
  const reflowPanels = useCallback(() => {
    console.log('Reflow triggered - repositioning panels to avoid overlaps');
    
    if (!selectedPanelId || panels.length <= 1) {
      return; // Nothing to reposition
    }
    
    // Create collision detection function
    const checkCollision = (panel1: Panel, panel2: Panel) => {
      const p1Row = panel1.position.row;
      const p1Col = panel1.position.col;
      const p1RowSpan = panel1.position.rowSpan || 1;
      const p1ColSpan = panel1.position.colSpan || 1;
      
      const p2Row = panel2.position.row;
      const p2Col = panel2.position.col;
      const p2RowSpan = panel2.position.rowSpan || 1;
      const p2ColSpan = panel2.position.colSpan || 1;
      
      // Check if rectangles overlap
      return !(p1Row >= p2Row + p2RowSpan || 
               p2Row >= p1Row + p1RowSpan || 
               p1Col >= p2Col + p2ColSpan || 
               p2Col >= p1Col + p1ColSpan);
    };
    
    // Find next available position for a panel
    const findAvailablePosition = (panelToPlace: Panel, excludePanels: Panel[]) => {
      const rowSpan = panelToPlace.position.rowSpan || 1;
      const colSpan = panelToPlace.position.colSpan || 1;
      
      for (let r = 0; r <= gridLayout.rows - rowSpan; r++) {
        for (let c = 0; c <= gridLayout.cols - colSpan; c++) {
          const testPanel = {
            ...panelToPlace,
            position: { ...panelToPlace.position, row: r, col: c }
          };
          
          // Check if this position conflicts with any existing panels
          const hasCollision = excludePanels.some(otherPanel => 
            checkCollision(testPanel, otherPanel)
          );
          
          if (!hasCollision) {
            return { row: r, col: c };
          }
        }
      }
      
      // If no position found, expand grid
      console.log('Need to expand grid for panel repositioning');
      setMinGridCells(prev => prev + 2);
      return { row: panelToPlace.position.row, col: panelToPlace.position.col };
    };
    
    // Keep selected panel in place, reposition others that collide
    const selectedPanel = panels.find(p => p.id === selectedPanelId);
    if (!selectedPanel) return;
    
    const otherPanels = panels.filter(p => p.id !== selectedPanelId);
    const repositionedPanels: Panel[] = [selectedPanel];
    
    // Check each panel for collision with selected panel
    otherPanels.forEach(panel => {
      if (checkCollision(selectedPanel, panel)) {
        const newPosition = findAvailablePosition(panel, repositionedPanels);
        const repositionedPanel = {
          ...panel,
          position: { ...panel.position, ...newPosition }
        };
        console.log(`Moving panel ${panel.id} from ${panel.position.row},${panel.position.col} to ${newPosition.row},${newPosition.col}`);
        repositionedPanels.push(repositionedPanel);
        
        // Update the panel
        setTimeout(() => onUpdatePanel(repositionedPanel, pageIndex), 0);
      } else {
        repositionedPanels.push(panel);
      }
    });
  }, [panels, selectedPanelId, gridLayout, onUpdatePanel, pageIndex, setMinGridCells]);

  // Add new empty grid space - just expand grid to have more drop zones
  const handleExpandGrid = useCallback(() => {
    console.log(`Expanding grid: ${minGridCells} → ${minGridCells + 2}`);
    setMinGridCells(prev => prev + 2); // Add 2 cells for better layout
  }, [minGridCells]);

    // Remove empty grid space - shrink grid if there are empty zones
  const handleShrinkGrid = useCallback(() => {
    const totalCells = gridLayout.rows * gridLayout.cols;
    
    console.log(`Shrink attempt: current=${gridLayout.rows}x${gridLayout.cols} (${totalCells} cells), panels=${panels.length}, minCells=${minGridCells}`);
    
    // Simple approach: if we have more than 6 total cells and more than 4 minGridCells, we can shrink
    if (totalCells > 6 && minGridCells > 4) {
      const newMinCells = Math.max(4, minGridCells - 2);
      console.log(`Shrinking grid: ${minGridCells} → ${newMinCells}`);
      setMinGridCells(newMinCells);
    } else {
      console.log(`Cannot shrink: totalCells=${totalCells}, minCells=${minGridCells} (need totalCells > 6 and minCells > 4)`);
    }
  }, [gridLayout, minGridCells]);

  // Drop zone handlers (like PanelGrid)
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // Helper function to find next available position
  const findNextAvailablePosition = useCallback(() => {
    // Look for truly empty cells (not occupied by any panel or its spans)
    for (let r = 0; r < gridLayout.rows; r++) {
      for (let c = 0; c < gridLayout.cols; c++) {
        // Check if this cell is occupied by any panel (including spans)
        const isOccupied = panels.some(panel => {
          const pRow = panel.position.row;
          const pCol = panel.position.col;
          const pRowSpan = panel.position.rowSpan || 1;
          const pColSpan = panel.position.colSpan || 1;
          
          return r >= pRow && r < pRow + pRowSpan &&
                 c >= pCol && c < pCol + pColSpan;
        });
        
        if (!isOccupied) {
          console.log(`Found available position: ${r}, ${c}`);
          return { row: r, col: c };
        }
      }
    }
    
    // If no empty position found, return null (don't auto-expand!)
    console.log('No available position found - grid is full');
    return null;
  }, [panels, gridLayout]);

  const handleDrop = useCallback(async (e: React.DragEvent, row: number, col: number) => {
    e.preventDefault();
    
    console.log(`Drop attempted at position: row=${row}, col=${col}`);
    
    // Always find next available position instead of using the drop zone position
    const availablePosition = findNextAvailablePosition();
    
    if (!availablePosition) {
      console.log('Grid is full - cannot add more content. Use + button to add more drop zones.');
      // Could show a user-friendly message here
      return;
    }
    
    console.log(`Using available position: row=${availablePosition.row}, col=${availablePosition.col}`);
    
    try {
      // First try JSON data (from video controls, image-to-video, etc.)
      const jsonData = e.dataTransfer.getData('application/json');
      if (jsonData) {
        console.log('Dropping JSON data:', jsonData);
        const panelData = JSON.parse(jsonData);
        const newPanel: Panel = {
          ...panelData,
          id: nanoid(),
          position: {
            row: availablePosition.row,
            col: availablePosition.col,
            rowSpan: 1,
            colSpan: 1
          }
        };
        console.log('Creating new panel from JSON:', newPanel);
        onUpdatePanel(newPanel, pageIndex);
        setSelectedPanelId(newPanel.id);
        return;
      }

      // Try text/plain data (from AI controls)
      const textData = e.dataTransfer.getData('text/plain');
      if (textData && textData.startsWith('http')) {
        console.log('Dropping text data (URL):', textData);
        const newPanel: Panel = {
          id: nanoid(),
          type: 'image', // AI controls typically generate images
          url: textData,
          size: 'medium',
          aspectRatio: 1,
          position: {
            row: availablePosition.row,
            col: availablePosition.col,
            rowSpan: 1,
            colSpan: 1
          }
        };
        console.log('Creating new panel from text URL:', newPanel);
        onUpdatePanel(newPanel, pageIndex);
        setSelectedPanelId(newPanel.id);
        return;
      }

      // Handle file drops (external files)
      const files = Array.from(e.dataTransfer.files);
      console.log('Dropping files:', files);
      if (files.length > 0) {
        const file = files[0];
        console.log('Uploading file:', file.name, file.type);
        
        // Upload to Cloudinary first
        const uploadedUrl = await mediaService.upload(file);
        
        if (uploadedUrl) {
          // Determine file type more accurately
          let panelType: 'image' | 'video' | 'gif' | '3d' = 'image';
          if (file.type.startsWith('video/')) {
            panelType = 'video';
          } else if (file.type.includes('gif')) {
            panelType = 'gif';
          } else if (file.name.toLowerCase().endsWith('.glb') || 
                     file.name.toLowerCase().endsWith('.gltf') ||
                     file.type.includes('model/gltf')) {
            panelType = '3d';
          }

          const newPanel: Panel = {
            id: nanoid(),
            type: panelType,
            url: uploadedUrl,
            size: 'medium',
            aspectRatio: 1,
            position: {
              row: availablePosition.row,
              col: availablePosition.col,
              rowSpan: 1,
              colSpan: 1
            }
          };
          console.log('Creating file panel:', newPanel);
          onUpdatePanel(newPanel, pageIndex);
          setSelectedPanelId(newPanel.id);
        }
      }
    } catch (error) {
      console.error('Error handling drop:', error);
    }
  }, [onUpdatePanel, pageIndex, findNextAvailablePosition]);

  // Handle panel selection
  const handlePanelClick = useCallback((panelId: string) => {
    setSelectedPanelId(selectedPanelId === panelId ? null : panelId);
  }, [selectedPanelId]);

  // Start dragging
  const handleMouseDown = useCallback((e: React.MouseEvent, panelId: string) => {
    e.stopPropagation();
    setSelectedPanelId(panelId);
    setIsDragging(true);
    setDragStart({ 
      x: e.clientX, 
      y: e.clientY, 
      panelId 
    });
  }, []);

  // Handle mouse move for dragging and resizing
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging && dragStart.panelId && gridRef.current) {
      // Calculate new grid position based on mouse movement
      const rect = gridRef.current.getBoundingClientRect();
      const cellWidth = rect.width / gridLayout.cols;
      const cellHeight = rect.height / gridLayout.rows;
      
      const relativeX = e.clientX - rect.left;
      const relativeY = e.clientY - rect.top;
      
      const newCol = Math.max(0, Math.min(gridLayout.cols - 1, Math.floor(relativeX / cellWidth)));
      const newRow = Math.max(0, Math.min(gridLayout.rows - 1, Math.floor(relativeY / cellHeight)));
      
      const panel = panels.find(p => p.id === dragStart.panelId);
      if (panel && (panel.position.row !== newRow || panel.position.col !== newCol)) {
        const updatedPanel = {
          ...panel,
          position: {
            ...panel.position,
            row: newRow,
            col: newCol
          }
        };
        onUpdatePanel(updatedPanel, pageIndex);
      }
    }
    
    if (isResizing && resizeStart.panelId) {
      // Calculate resize based on mouse movement
      const deltaX = e.clientX - resizeStart.x;
      const deltaY = e.clientY - resizeStart.y;
      
      // Convert pixel movement to grid cells (rough calculation)
      const cellsX = Math.round(deltaX / 100); // Adjust sensitivity as needed
      const cellsY = Math.round(deltaY / 100);
      
      const newColSpan = Math.max(1, resizeStart.originalSize.width + cellsX);
      const newRowSpan = Math.max(1, resizeStart.originalSize.height + cellsY);
      
      // Constrain to reasonable aspect ratios to prevent content distortion
      const maxAspectRatio = 3; // Max 3:1 ratio in either direction
      const constrainedColSpan = Math.min(newColSpan, newRowSpan * maxAspectRatio);
      const constrainedRowSpan = Math.min(newRowSpan, newColSpan * maxAspectRatio);
      
      const panel = panels.find(p => p.id === resizeStart.panelId);
      if (panel && (panel.position.colSpan !== constrainedColSpan || panel.position.rowSpan !== constrainedRowSpan)) {
        const updatedPanel = {
          ...panel,
          position: {
            ...panel.position,
            colSpan: Math.min(constrainedColSpan, gridLayout.cols - panel.position.col), // Don't exceed grid
            rowSpan: Math.min(constrainedRowSpan, gridLayout.rows - panel.position.row)
          }
        };
        onUpdatePanel(updatedPanel, pageIndex);
        
        // Trigger reflow after a short delay to allow panel update to complete
        setTimeout(() => reflowPanels(), 100);
      }
    }
  }, [isDragging, isResizing, dragStart.panelId, resizeStart, gridLayout, panels, onUpdatePanel, pageIndex]);

  // Stop dragging/resizing
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
  }, []);

  // Content addition is handled by PanelEditor - same as other templates

  // Grid style - ensure reasonable cell proportions
  const gridStyle = {
    display: 'grid',
    gridTemplateRows: `repeat(${gridLayout.rows}, minmax(150px, 1fr))`, // Minimum 150px per row
    gridTemplateColumns: `repeat(${gridLayout.cols}, minmax(150px, 1fr))`, // Minimum 150px per column
    gap: '1rem',
    minHeight: '600px',
    width: '100%',
    aspectRatio: 'auto' // Let grid adjust naturally
  };

  return (
    <div className="relative w-full">
      {/* Main Grid Container */}
      <div 
        ref={gridRef}
        style={gridStyle}
        className="bg-gray-50 dark:bg-gray-900 rounded-lg p-6 border-2 border-dashed border-gray-300 dark:border-gray-700"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Render panels in grid */}
        {Array.from({ length: gridLayout.rows * gridLayout.cols }).map((_, index) => {
          const row = Math.floor(index / gridLayout.cols);
          const col = index % gridLayout.cols;
          
          // Find panel at this grid position (accounting for spans)
          const panel = panels.find(p => {
            const pRow = p.position.row;
            const pCol = p.position.col;
            const pRowSpan = p.position.rowSpan || 1;
            const pColSpan = p.position.colSpan || 1;
            
            // Check if this grid cell is occupied by the panel (including spans)
            return row >= pRow && row < pRow + pRowSpan &&
                   col >= pCol && col < pCol + pColSpan;
          });
          
          const isSelected = selectedPanelId === panel?.id;
          
          if (panel) {
            // Only render panel at its origin position, skip spanned cells
            if (panel.position.row !== row || panel.position.col !== col) {
              return null; // This cell is part of a spanned panel, skip it
            }
            return (
              <div 
                key={panel.id} 
                style={{
                  gridRow: `${row + 1} / span ${panel.position.rowSpan || 1}`,
                  gridColumn: `${col + 1} / span ${panel.position.colSpan || 1}`,
                }} 
                className="relative group"
              >
                {/* Render PanelEditor exactly like other templates */}
                <PanelEditor
                  panel={panel}
                  onUpdate={(updatedPanel) => onUpdatePanel(updatedPanel, pageIndex)}
                  onRemove={onRemovePanel}
                />
                
                {/* Custom Canvas Controls - Show drag handle always, resize when selected */}
                <>
                  {/* Always show drag handle for identification */}
                                      <div 
                      className="absolute top-2 left-2 w-6 h-6 bg-purple-500 text-white rounded flex items-center justify-center cursor-grab hover:bg-purple-600 transition-colors shadow-md z-30"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPanelId(selectedPanelId === panel.id ? null : panel.id);
                      }}
                      onMouseDown={(e) => handleMouseDown(e, panel.id)}
                      onMouseEnter={() => setActiveTooltip('drag-handle')}
                      onMouseLeave={() => setActiveTooltip(null)}
                  >
                    <div className="w-2 h-2 bg-white rounded-full" />
                  </div>

                                     {/* Resize handle - only when selected */}
                   {isSelected && (
                     <div
                       className="absolute bottom-0 right-0 w-4 h-4 bg-green-500 cursor-se-resize hover:bg-green-600 transition-colors z-30"
                       style={{ 
                         clipPath: 'polygon(100% 0%, 0% 100%, 100% 100%)',
                       }}
                       onMouseDown={(e) => {
                         e.stopPropagation();
                         setSelectedPanelId(panel.id);
                         setIsResizing(true);
                         setResizeStart({
                           x: e.clientX,
                           y: e.clientY,
                           panelId: panel.id,
                           originalSize: { 
                             width: panel.position.colSpan || 1, 
                             height: panel.position.rowSpan || 1 
                           }
                         });
                       }}
                       onMouseEnter={() => setActiveTooltip('resize-handle')}
                       onMouseLeave={() => setActiveTooltip(null)}
                     />
                   )}
                 </>
               </div>
             );
           }
          
                               // Empty grid cell with drop zone functionality
          return (
            <div
              key={`empty-${row}-${col}`}
              className="bg-gray-100 dark:bg-gray-800 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 flex items-center justify-center hover:border-blue-400 transition-colors group"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, row, col)}
              onMouseEnter={() => setActiveTooltip('drop-zone')}
              onMouseLeave={() => setActiveTooltip(null)}
            >
              <div className="text-center p-6">
                <p className="text-sm text-gray-500 group-hover:text-gray-700">Drop here</p>
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Grid Control Buttons - Bottom Right */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2 z-10">
        {/* Shrink Grid Button */}
        {(() => {
          const totalCells = gridLayout.rows * gridLayout.cols;
          const canShrink = totalCells > 6 && minGridCells > 4;
          
          return (
            <button
              onClick={handleShrinkGrid}
              disabled={!canShrink}
              onMouseEnter={() => canShrink && setActiveTooltip('shrink-button')}
              onMouseLeave={() => setActiveTooltip(null)}
              className={`w-12 h-12 ${canShrink 
                ? 'bg-red-500 hover:bg-red-600' 
                : 'bg-gray-400 cursor-not-allowed'
              } text-white rounded-full shadow-lg flex items-center justify-center transition-colors`}
            >
              <Minus size={24} />
            </button>
          );
        })()}
        
        {/* Expand Grid Button */}
        <button
          onClick={handleExpandGrid}
          onMouseEnter={() => setActiveTooltip('expand-button')}
          onMouseLeave={() => setActiveTooltip(null)}
          className="w-12 h-12 bg-purple-500 hover:bg-purple-600 text-white rounded-full shadow-lg flex items-center justify-center transition-colors"
        >
          <Plus size={24} />
        </button>
      </div>

      {/* Tooltip Container - Appears around canvas edges */}
      <AnimatePresence>
        {activeTooltip && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className={`absolute px-3 py-2 bg-purple-500 text-white text-sm rounded-lg shadow-lg whitespace-nowrap z-50 pointer-events-none ${
              activeTooltip === 'drop-zone' ? '-top-12 left-1/2 -translate-x-1/2' :
              activeTooltip === 'drag-handle' ? '-left-48 top-4' :
              activeTooltip === 'resize-handle' ? '-right-32 bottom-8' :
              activeTooltip === 'expand-button' ? '-left-40 bottom-4' :
              activeTooltip === 'shrink-button' ? '-left-48 bottom-20' :
              '-top-12 left-1/2 -translate-x-1/2'
            }`}
          >
            {activeTooltip === 'drop-zone' && 'Drop content here or click + to add panels'}
            {activeTooltip === 'drag-handle' && 'Click to select, drag to move panel'}
            {activeTooltip === 'resize-handle' && 'Drag to resize panel'}
            {activeTooltip === 'expand-button' && 'Add more drop zones'}
            {activeTooltip === 'shrink-button' && 'Remove empty drop zones'}
            
            {/* Tooltip arrow */}
            <div className={`absolute w-0 h-0 border-4 border-transparent ${
              activeTooltip === 'drop-zone' ? 'top-full left-1/2 -translate-x-1/2 border-t-purple-500' :
              activeTooltip === 'drag-handle' ? 'right-0 top-1/2 -translate-y-1/2 border-l-purple-500 translate-x-full' :
              activeTooltip === 'resize-handle' ? 'left-0 top-1/2 -translate-y-1/2 border-r-purple-500 -translate-x-full' :
              activeTooltip === 'expand-button' ? 'right-0 top-1/2 -translate-y-1/2 border-l-purple-500 translate-x-full' :
              activeTooltip === 'shrink-button' ? 'right-0 top-1/2 -translate-y-1/2 border-l-purple-500 translate-x-full' :
              'top-full left-1/2 -translate-x-1/2 border-t-purple-500'
            }`}></div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}; 