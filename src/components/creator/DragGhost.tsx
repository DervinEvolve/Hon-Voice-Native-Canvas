/**
 * DragGhost - Semi-transparent drag preview component
 * 
 * Shows a ghost outline of the panel being dragged.
 */

import React from 'react';
import { createPortal } from 'react-dom';

export interface DragGhostProps {
  /** Whether the ghost is visible */
  visible: boolean;
  /** X position (client coordinates) */
  x: number;
  /** Y position (client coordinates) */
  y: number;
  /** Width of the ghost */
  width: number;
  /** Height of the ghost */
  height: number;
  /** Optional thumbnail URL */
  thumbnailUrl?: string;
  /** Optional label */
  label?: string;
}

export const DragGhost: React.FC<DragGhostProps> = ({
  visible,
  x,
  y,
  width,
  height,
  thumbnailUrl,
  label,
}) => {
  if (!visible || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="fixed pointer-events-none z-[9999] transition-opacity duration-100"
      style={{
        left: x,
        top: y,
        width,
        height,
        opacity: visible ? 0.7 : 0,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div
        className="w-full h-full rounded-xl border-2 border-dashed border-purple-500 bg-purple-500/10 backdrop-blur-sm overflow-hidden"
        style={{
          boxShadow: '0 0 20px 5px rgba(139, 92, 246, 0.3)',
        }}
      >
        {thumbnailUrl && (
          <img
            src={thumbnailUrl}
            alt=""
            className="w-full h-full object-cover opacity-50"
            draggable={false}
          />
        )}
        {label && (
          <div className="absolute bottom-2 left-2 right-2 text-xs font-medium px-2 py-1 rounded bg-purple-600/80 text-white truncate">
            {label}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default DragGhost;

