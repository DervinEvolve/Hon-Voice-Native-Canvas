import React, { useEffect, useRef, useState } from 'react';

interface WorldBounds {
  minX: number; minY: number; maxX: number; maxY: number;
}

interface PanelBox {
  id: string;
  x: number; // world center x
  y: number; // world center y
  w: number; // world width
  h: number; // world height
  type?: string; // panel type (image, video, game, etc.)
  isSelected?: boolean; // whether this panel is selected
}

interface ViewportState {
  widthPx: number; // canvas viewport px
  heightPx: number;
  scale: number; // world->screen scale factor used by main canvas
  position: { x: number; y: number }; // world translation used by main canvas
}

interface BoardMinimapProps {
  bounds: WorldBounds;
  panelBoxes: PanelBox[];
  viewport: ViewportState;
  onCenterWorld: (wx: number, wy: number) => void;
  onCenterPanel?: (panelId: string) => void; // center a specific panel
  width?: number; // minimap px
  height?: number;
}

export const BoardMinimap: React.FC<BoardMinimapProps> = ({
  bounds,
  panelBoxes,
  viewport,
  onCenterWorld,
  onCenterPanel,
  width = 240,
  height = 150,
}) => {
  const pad = 16; // more padding for clearer visuals
  // Add padding to world bounds to avoid edge clipping
  const worldPad = 100;
  const wWorld = Math.max(1, bounds.maxX - bounds.minX + worldPad * 2);
  const hWorld = Math.max(1, bounds.maxY - bounds.minY + worldPad * 2);
  const scaleMini = Math.min((width - pad * 2) / wWorld, (height - pad * 2) / hWorld);

  const toMini = (wx: number, wy: number) => ({
    x: pad + (wx - (bounds.minX - worldPad)) * scaleMini,
    y: pad + (wy - (bounds.minY - worldPad)) * scaleMini,
  });

  const toWorld = (mx: number, my: number) => ({
    x: (bounds.minX - worldPad) + (mx - pad) / scaleMini,
    y: (bounds.minY - worldPad) + (my - pad) / scaleMini,
  });

  // Viewport rectangle in world units
  const vpWWorld = Math.max(1, viewport.widthPx / Math.max(0.0001, viewport.scale));
  const vpHWorld = Math.max(1, viewport.heightPx / Math.max(0.0001, viewport.scale));
  const vpCenterWorld = { x: -viewport.position.x, y: -viewport.position.y };
  const vpTopLeftWorld = { x: vpCenterWorld.x - vpWWorld / 2, y: vpCenterWorld.y - vpHWorld / 2 };
  const vpMiniTL = toMini(vpTopLeftWorld.x, vpTopLeftWorld.y);
  const vpMiniW = Math.max(16, vpWWorld * scaleMini);
  const vpMiniH = Math.max(16, vpHWorld * scaleMini);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ 
    startMiniX: number; 
    startMiniY: number; 
    initialCenterX: number; 
    initialCenterY: number;
  } | null>(null);
  const movedRef = useRef(false);
  const [hoveredPanelId, setHoveredPanelId] = useState<string | null>(null);
  const [isDraggingViewport, setIsDraggingViewport] = useState(false);
  
  // Track if we're actively dragging to prevent external position resets
  const isDraggingRef = useRef(false);

  const onMiniClick = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (movedRef.current) { movedRef.current = false; return; }
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const w = toWorld(mx, my);
    onCenterWorld(w.x, w.y);
  };

  const onRectPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as any).setPointerCapture?.(e.pointerId);
    if (!svgRef.current) return;
    
    // Get pointer position in SVG/minimap coordinate space
    const svgRect = svgRef.current.getBoundingClientRect();
    const miniX = e.clientX - svgRect.left;
    const miniY = e.clientY - svgRect.top;
    
    // Store initial viewport center in world coords (captured at drag start, won't change)
    dragRef.current = { 
      startMiniX: miniX, 
      startMiniY: miniY,
      initialCenterX: vpCenterWorld.x,
      initialCenterY: vpCenterWorld.y
    };
    movedRef.current = false;
    isDraggingRef.current = true;
    setIsDraggingViewport(true);
    
    // Dispatch event to prevent fitView and other position resets during drag
    try {
      document.dispatchEvent(new CustomEvent('minimap-drag-start'));
    } catch {}
  };

  const onRectPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !svgRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    movedRef.current = true;
    
    // Get current pointer position in SVG/minimap coordinate space
    const svgRect = svgRef.current.getBoundingClientRect();
    const currentMiniX = e.clientX - svgRect.left;
    const currentMiniY = e.clientY - svgRect.top;
    
    // Calculate delta in minimap coordinate space
    const dxMini = currentMiniX - dragRef.current.startMiniX;
    const dyMini = currentMiniY - dragRef.current.startMiniY;
    
    // Convert minimap delta to world delta using minimap scale
    const dxWorld = dxMini / scaleMini;
    const dyWorld = dyMini / scaleMini;
    
    // Apply delta to the initial center (captured at drag start, stable reference)
    const newCenterX = dragRef.current.initialCenterX + dxWorld;
    const newCenterY = dragRef.current.initialCenterY + dyWorld;
    
    onCenterWorld(newCenterX, newCenterY);
  };

  const onRectPointerUp = (e: React.PointerEvent) => {
    try { (e.currentTarget as any).releasePointerCapture?.(e.pointerId); } catch {}
    dragRef.current = null;
    isDraggingRef.current = false;
    setIsDraggingViewport(false);
    
    // Dispatch event to allow fitView and other position updates again
    try {
      document.dispatchEvent(new CustomEvent('minimap-drag-end'));
    } catch {}
  };

  // Safety: if pointerup/cancel occurs off the rect, stop dragging
  useEffect(() => {
    const end = () => { 
      if (dragRef.current) {
        dragRef.current = null;
        movedRef.current = false;
        isDraggingRef.current = false;
        setIsDraggingViewport(false);
        try {
          document.dispatchEvent(new CustomEvent('minimap-drag-end'));
        } catch {}
      }
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);

  // Get panel type color
  const getPanelColor = (type?: string, isSelected?: boolean, isHovered?: boolean): { fill: string; stroke: string } => {
    if (isSelected) {
      return { fill: 'rgba(34, 197, 94, 0.5)', stroke: 'rgba(34, 197, 94, 1)' }; // Green for selected
    }
    if (isHovered) {
      return { fill: 'rgba(139, 92, 246, 0.5)', stroke: 'rgba(139, 92, 246, 1)' }; // Purple for hover
    }
    // Color by type
    switch (type) {
      case 'image':
        return { fill: 'rgba(139, 92, 246, 0.35)', stroke: 'rgba(139, 92, 246, 0.95)' }; // Purple
      case 'video':
        return { fill: 'rgba(59, 130, 246, 0.35)', stroke: 'rgba(59, 130, 246, 0.95)' }; // Blue
      case 'game':
        return { fill: 'rgba(236, 72, 153, 0.35)', stroke: 'rgba(236, 72, 153, 0.95)' }; // Pink
      case 'text':
        return { fill: 'rgba(251, 191, 36, 0.35)', stroke: 'rgba(251, 191, 36, 0.95)' }; // Yellow
      default:
        return { fill: 'rgba(139, 92, 246, 0.35)', stroke: 'rgba(139, 92, 246, 0.95)' }; // Default purple
    }
  };

  // Handle panel click to center it
  const onPanelClick = (e: React.MouseEvent, panel: PanelBox) => {
    e.stopPropagation();
    if (onCenterPanel && panel) {
      onCenterPanel(panel.id);
    }
  };

  // Slightly shrink panel boxes and clamp to a minimum size so they remain visible
  const panelBoxScale = 0.85;
  const minBoxSize = 8; // minimum visible size in minimap pixels

  return (
    <div className="absolute top-4 right-6 z-40 select-none pointer-events-auto" aria-hidden>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="rounded-xl shadow-lg border bg-white/80 dark:bg-gray-900/80 border-gray-300/60 dark:border-gray-700/60 backdrop-blur-sm text-gray-800 dark:text-gray-100"
        onClick={onMiniClick}
        style={{ pointerEvents: 'auto' }}
      >
        {/* Panels */}
        {panelBoxes.map((p) => {
          // Centered rectangle in mini space with clamped size
          const center = toMini(p.x, p.y);
          const w = Math.max(minBoxSize, p.w * scaleMini * panelBoxScale);
          const h = Math.max(minBoxSize, p.h * scaleMini * panelBoxScale);
          const x = center.x - w / 2;
          const y = center.y - h / 2;
          const isHovered = hoveredPanelId === p.id;
          const colors = getPanelColor(p.type, p.isSelected, isHovered);
          
          return (
            <rect
              key={p.id}
              x={x}
              y={y}
              width={w}
              height={h}
              fill={colors.fill}
              stroke={colors.stroke}
              strokeWidth={p.isSelected ? 2.5 : (isHovered ? 2 : 1.5)}
              rx={2}
              style={{ 
                cursor: onCenterPanel ? 'pointer' : 'default',
                transition: 'all 0.15s ease-out'
              }}
              onMouseEnter={() => setHoveredPanelId(p.id)}
              onMouseLeave={() => setHoveredPanelId(null)}
              onClick={(e) => onPanelClick(e, p)}
            />
          );
        })}
        {/* Viewport */}
        <rect
          x={vpMiniTL.x}
          y={vpMiniTL.y}
          width={vpMiniW}
          height={vpMiniH}
          fill="rgba(139,92,246,0.18)"
          stroke="rgba(139,92,246,0.9)"
          strokeWidth={1.5}
          onPointerDown={onRectPointerDown}
          onPointerMove={onRectPointerMove}
          onPointerUp={onRectPointerUp}
          onPointerCancel={onRectPointerUp}
          style={{ 
            cursor: isDraggingViewport ? 'grabbing' : 'grab',
            transition: isDraggingViewport ? 'none' : 'all 0.2s ease-out'
          }}
          className="touch-none"
        />
      </svg>
    </div>
  );
};

export default BoardMinimap;


