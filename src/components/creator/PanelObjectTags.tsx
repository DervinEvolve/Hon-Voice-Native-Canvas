/**
 * Component to display detected objects as tags on panels
 * Shows SAM3-detected objects for canvas awareness
 */

import React from 'react';
import { Panel } from '../../types';
import { useSAM3Detection } from '../../hooks/useSAM3Detection';
import { useComicStore } from '../../store/useComicStore';

interface PanelObjectTagsProps {
  panel: Panel;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  maxVisible?: number;
  compact?: boolean;
  focusMode?: boolean; // If true, position tags below buttons (for focus mode)
}

export const PanelObjectTags: React.FC<PanelObjectTagsProps> = ({
  panel,
  position = 'top-left',
  maxVisible = 5,
  compact = false,
  focusMode = false,
}) => {
  const showObjectTags = useComicStore(state => state.showObjectTags);
  const { detectedObjects, isDetecting } = useSAM3Detection(panel, { autoDetect: true });

  // Only show for image panels and if preference is enabled
  if (!showObjectTags || panel.type !== 'image' || !detectedObjects.length) {
    return null;
  }

  const visibleObjects = detectedObjects.slice(0, maxVisible);
  const remainingCount = detectedObjects.length - maxVisible;

  // In focus mode with top-left position, position tags below the "Create more" button
  const positionClasses = {
    'top-left': focusMode ? 'top-12 left-2' : 'top-2 left-2',
    'top-right': focusMode ? 'top-12 right-2' : 'top-2 right-2',
    'bottom-left': 'bottom-2 left-2',
    'bottom-right': 'bottom-2 right-2',
  };

  return (
    <div className={`absolute ${positionClasses[position]} z-10 flex flex-wrap gap-1 max-w-[80%]`}>
      {isDetecting && (
        <span className="px-2 py-1 bg-blue-500/80 text-white text-xs rounded-full backdrop-blur-sm">
          Detecting...
        </span>
      )}
      {visibleObjects.map((object, index) => (
        <span
          key={`${object}-${index}`}
          className={`px-2 py-1 bg-black/60 text-white text-xs rounded-full backdrop-blur-sm ${
            compact ? 'text-[10px] px-1.5 py-0.5' : ''
          }`}
          title={object}
        >
          {object}
        </span>
      ))}
      {remainingCount > 0 && (
        <span className="px-2 py-1 bg-gray-600/80 text-white text-xs rounded-full backdrop-blur-sm">
          +{remainingCount}
        </span>
      )}
    </div>
  );
};

