/**
 * Canvas Thumbnail Generation Utility
 * Generates thumbnail images from canvas state snapshots
 */

import html2canvas from 'html2canvas';
import { Panel } from '../types';

interface CanvasState {
  comic?: {
    id: string;
    title: string;
    pages: Panel[][];
    pageTemplates?: any[];
  };
  viewport?: {
    scale: number;
    position: { x: number; y: number };
  };
  boardState?: {
    positions: Record<string, { x: number; y: number }>;
    panelScales: Record<string, number>;
    panelGroups: Record<string, string[]>;
  };
  panels?: Panel[];
  currentPageIndex?: number;
  // Immersive scene state
  isWorldMode?: boolean;
  immersiveScene?: {
    screenshotUrl?: string;
    objects?: any[];
    environment?: any;
    camera?: any;
  };
}

const BOARD_CELL_W = 307;
const BOARD_CELL_H = 307;
const BOARD_ITEM_SCALE = 1.19;

/**
 * Generate a thumbnail from canvas state
 */
export async function generateCanvasThumbnail(
  canvasState: CanvasState,
  width: number = 120,
  height: number = 80
): Promise<string | null> {
  try {
    // For immersive scene snapshots, use the captured screenshot directly
    if (canvasState.isWorldMode && canvasState.immersiveScene?.screenshotUrl) {
      // The screenshot is already a data URL or uploaded URL
      // Resize it to thumbnail dimensions
      return await resizeImageToThumbnail(canvasState.immersiveScene.screenshotUrl, width, height);
    }
    
    // Create a temporary container for rendering
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '-9999px';
    container.style.width = '800px';
    container.style.height = '600px';
    container.style.backgroundColor = '#1f2937'; // gray-800
    container.style.overflow = 'hidden';
    document.body.appendChild(container);

    // Determine if we're in board mode or grid mode
    const isBoardMode = canvasState.boardState && Object.keys(canvasState.boardState.positions).length > 0;
    const pages = canvasState.comic?.pages || [];
    const currentPageIndex = canvasState.currentPageIndex ?? 0;
    const currentPage = pages[currentPageIndex] || [];

    if (isBoardMode && canvasState.boardState) {
      // Render board mode: panels positioned absolutely
      const positions = canvasState.boardState.positions;
      const panelScales = canvasState.boardState.panelScales;
      
      // Calculate bounds
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let hasPanels = false;
      
      pages.forEach(page => {
        page.forEach(panel => {
          if (!panel || panel.type === 'palette' || panel.type === 'notion') return;
          hasPanels = true;
          const pos = positions[panel.id] || { x: 0, y: 0 };
          const scale = panelScales[panel.id] || 1;
          const halfW = (BOARD_CELL_W * BOARD_ITEM_SCALE * scale) / 2;
          const halfH = (BOARD_CELL_H * BOARD_ITEM_SCALE * scale) / 2;
          minX = Math.min(minX, pos.x - halfW);
          maxX = Math.max(maxX, pos.x + halfW);
          minY = Math.min(minY, pos.y - halfH);
          maxY = Math.max(maxY, pos.y + halfH);
        });
      });

      if (!hasPanels) {
        document.body.removeChild(container);
        return null;
      }

      const boundsWidth = maxX - minX;
      const boundsHeight = maxY - minY;
      const scale = Math.min(
        (container.clientWidth - 40) / boundsWidth,
        (container.clientHeight - 40) / boundsHeight
      );

      // Render panels
      pages.forEach(page => {
        page.forEach(panel => {
          if (!panel || panel.type === 'palette' || panel.type === 'notion') return;
          
          const pos = positions[panel.id] || { x: 0, y: 0 };
          const panelScale = panelScales[panel.id] || 1;
          const panelWidth = BOARD_CELL_W * BOARD_ITEM_SCALE * panelScale;
          const panelHeight = BOARD_CELL_H * BOARD_ITEM_SCALE * panelScale;
          
          const panelEl = document.createElement('div');
          panelEl.style.position = 'absolute';
          panelEl.style.left = `${(pos.x - minX) * scale + 20}px`;
          panelEl.style.top = `${(pos.y - minY) * scale + 20}px`;
          panelEl.style.width = `${panelWidth * scale}px`;
          panelEl.style.height = `${panelHeight * scale}px`;
          panelEl.style.backgroundColor = '#374151'; // gray-700
          panelEl.style.borderRadius = '8px';
          panelEl.style.overflow = 'hidden';
          panelEl.style.border = '2px solid #4b5563'; // gray-600

          // Add panel content preview
          if (panel.type === 'image' && panel.url) {
            const img = document.createElement('img');
            img.crossOrigin = "anonymous"; // Critical for CORS support
            img.src = panel.url;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            panelEl.appendChild(img);
          } else if (panel.type === 'video' && panel.url) {
            const video = document.createElement('video');
            video.crossOrigin = "anonymous"; // Critical for CORS support
            video.src = panel.url;
            video.style.width = '100%';
            video.style.height = '100%';
            video.style.objectFit = 'cover';
            video.muted = true;
            video.currentTime = 1; // Get frame at 1 second
            panelEl.appendChild(video);
          } else {
            const label = document.createElement('div');
            label.textContent = panel.type.toUpperCase();
            label.style.display = 'flex';
            label.style.alignItems = 'center';
            label.style.justifyContent = 'center';
            label.style.width = '100%';
            label.style.height = '100%';
            label.style.color = '#9ca3af'; // gray-400
            label.style.fontSize = '10px';
            panelEl.appendChild(label);
          }

          container.appendChild(panelEl);
        });
      });
    } else {
      // Render grid mode: use template layout
      const template = canvasState.comic?.pageTemplates?.[currentPageIndex];
      if (!template) {
        document.body.removeChild(container);
        return null;
      }

      // Create grid layout
      const gridEl = document.createElement('div');
      gridEl.style.display = 'grid';
      gridEl.style.gridTemplateRows = `repeat(${template.layout.rows}, 1fr)`;
      gridEl.style.gridTemplateColumns = `repeat(${template.layout.cols}, 1fr)`;
      gridEl.style.width = '100%';
      gridEl.style.height = '100%';
      gridEl.style.gap = '8px';
      gridEl.style.padding = '20px';

      template.layout.areas.forEach((area: any, index: number) => {
        const panel = currentPage[index];
        const cellEl = document.createElement('div');
        cellEl.style.gridRow = `${area.position.row + 1} / span ${area.position.rowSpan || 1}`;
        cellEl.style.gridColumn = `${area.position.col + 1} / span ${area.position.colSpan || 1}`;
        cellEl.style.backgroundColor = '#374151'; // gray-700
        cellEl.style.borderRadius = '8px';
        cellEl.style.overflow = 'hidden';
        cellEl.style.border = '2px solid #4b5563'; // gray-600

        if (panel && panel.type === 'image' && panel.url) {
          const img = document.createElement('img');
          img.crossOrigin = "anonymous"; // Critical for CORS support
          img.src = panel.url;
          img.style.width = '100%';
          img.style.height = '100%';
          img.style.objectFit = 'cover';
          cellEl.appendChild(img);
        } else if (panel && panel.type === 'video' && panel.url) {
          const video = document.createElement('video');
          video.crossOrigin = "anonymous"; // Critical for CORS support
          video.src = panel.url;
          video.style.width = '100%';
          video.style.height = '100%';
          video.style.objectFit = 'cover';
          video.muted = true;
          video.currentTime = 1;
          cellEl.appendChild(video);
        }

        gridEl.appendChild(cellEl);
      });

      container.appendChild(gridEl);
    }

    // Wait for all images to load before capturing
    const imagePromises: Promise<void>[] = [];
    const images = container.querySelectorAll('img');
    const loadedImages: HTMLImageElement[] = [];
    
    images.forEach((img) => {
      if (img.complete && img.naturalWidth > 0) {
        // Image already loaded successfully
        loadedImages.push(img);
      } else {
        // Wait for image to load
        imagePromises.push(new Promise((resolve) => {
          let resolved = false;
          const timeout = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              // If image failed to load, remove it to avoid blank space
              if (img.naturalWidth === 0) {
                img.style.display = 'none';
              }
              resolve();
            }
          }, 3000); // Increased timeout for slow images
          
          img.onload = () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              loadedImages.push(img);
              resolve();
            }
          };
          img.onerror = () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              // Hide failed images
              img.style.display = 'none';
              resolve();
            }
          };
        }));
      }
    });
    
    if (imagePromises.length > 0) {
      await Promise.all(imagePromises);
    }
    
    // Verify at least some images loaded successfully
    if (loadedImages.length === 0 && images.length > 0) {
      console.warn('[CanvasThumbnail] No images loaded successfully, thumbnail may be blank');
    }
    
    // Small buffer after images load for layout stability
    await new Promise(resolve => setTimeout(resolve, 200));

    // Ensure container is visible for html2canvas (needs to be in viewport)
    container.style.visibility = 'visible';
    container.style.opacity = '1';
    
    // Capture with html2canvas
    const canvas = await html2canvas(container, {
      scale: 1,
      useCORS: true,
      allowTaint: false, // Ensure canvas is not tainted so toDataURL works
      backgroundColor: '#1f2937',
      width: container.clientWidth,
      height: container.clientHeight,
      logging: false, // Disable logging for production
      ignoreElements: (element) => {
        // Ignore video tags and failed images
        if (element.tagName === 'VIDEO') return true;
        if (element.tagName === 'IMG' && (element as HTMLImageElement).style.display === 'none') return true;
        return false;
      },
    });

    // Resize to thumbnail dimensions
    const thumbnailCanvas = document.createElement('canvas');
    thumbnailCanvas.width = width;
    thumbnailCanvas.height = height;
    const ctx = thumbnailCanvas.getContext('2d');
    if (!ctx) {
      document.body.removeChild(container);
      return null;
    }

    ctx.drawImage(canvas, 0, 0, width, height);
    
    // Use error handling for toDataURL (tainted canvas throws here)
    try {
      const dataUrl = thumbnailCanvas.toDataURL('image/jpeg', 0.8);
      document.body.removeChild(container);
      return dataUrl;
    } catch (e) {
      console.warn('[CanvasThumbnail] Canvas tainted, cannot export data URL. Using fallback color.', e);
      document.body.removeChild(container);
      return null;
    }
  } catch (error) {
    console.error('[CanvasThumbnail] Failed to generate thumbnail:', error);
    return null;
  }
}

/**
 * Resize an image (data URL or HTTP URL) to thumbnail dimensions
 */
async function resizeImageToThumbnail(
  imageUrl: string,
  width: number,
  height: number
): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        
        // Draw image scaled to fit thumbnail
        ctx.drawImage(img, 0, 0, width, height);
        
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        resolve(dataUrl);
      } catch (e) {
        console.warn('[CanvasThumbnail] Failed to resize image:', e);
        resolve(null);
      }
    };
    
    img.onerror = () => {
      console.warn('[CanvasThumbnail] Failed to load image for resize:', imageUrl.substring(0, 50));
      resolve(null);
    };
    
    // Set a timeout in case image loading hangs
    setTimeout(() => {
      if (!img.complete) {
        console.warn('[CanvasThumbnail] Image load timeout');
        resolve(null);
      }
    }, 5000);
    
    img.src = imageUrl;
  });
}

