/**
 * PanelSkeleton - Loading skeleton for panels
 * 
 * Shows a shimmer animation effect while panel content is loading.
 */

import React from 'react';

export interface PanelSkeletonProps {
  /** Width of the skeleton */
  width?: number | string;
  /** Height of the skeleton */
  height?: number | string;
  /** Whether to show rounded corners */
  rounded?: boolean;
  /** Custom class name */
  className?: string;
}

export const PanelSkeleton: React.FC<PanelSkeletonProps> = ({
  width = '100%',
  height = '100%',
  rounded = true,
  className = '',
}) => {
  return (
    <div
      className={`relative overflow-hidden bg-gray-200 dark:bg-gray-700 ${rounded ? 'rounded-xl' : ''} ${className}`}
      style={{ width, height }}
    >
      {/* Shimmer effect */}
      <div
        className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite]"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)',
        }}
      />
      
      {/* Content placeholder lines */}
      <div className="absolute inset-4 flex flex-col justify-end gap-2">
        <div className="h-2 bg-gray-300 dark:bg-gray-600 rounded w-3/4" />
        <div className="h-2 bg-gray-300 dark:bg-gray-600 rounded w-1/2" />
      </div>
    </div>
  );
};

// Inject shimmer animation styles
if (typeof document !== 'undefined') {
  const styleId = 'panel-skeleton-animations';
  if (!document.getElementById(styleId)) {
    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = `
      @keyframes shimmer {
        100% { transform: translateX(100%); }
      }
    `;
    document.head.appendChild(styleEl);
  }
}

export default PanelSkeleton;

