/**
 * FocusCanvas - Focus mode panel rendering component
 * 
 * Extracted from Creator.tsx for better code organization.
 * Renders panels in template-based grid layout.
 */

import React from 'react';
import { Panel, Template, Comic } from '../../types';
import { PanelGrid } from './PanelGrid';
import { CustomCanvas } from './CustomCanvas';

export interface FocusCanvasProps {
  /** Current comic data */
  currentComic: Comic | null;
  /** Current page index */
  currentPageIndex: number;
  /** Handler for panel update */
  onUpdatePanel: (panel: Panel, pageIndex: number) => void;
  /** Handler for panel remove */
  onRemovePanel: (panelId: string, pageIndex: number) => void;
  /** Handler for panel reorder */
  onReorderPanels: (startIndex: number, endIndex: number, pageIndex: number) => void;
}

export const FocusCanvas: React.FC<FocusCanvasProps> = ({
  currentComic,
  currentPageIndex,
  onUpdatePanel,
  onRemovePanel,
  onReorderPanels,
}) => {
  if (!currentComic) {
    return null;
  }

  const template = currentComic.pageTemplates[currentPageIndex];
  const panels = currentComic.pages[currentPageIndex] || [];

  if (!template) {
    return (
      <div className="text-center text-gray-500 dark:text-gray-400 mt-20">
        Please select a template to begin
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      {template.id === 'custom' ? (
        <CustomCanvas
          panels={panels}
          onUpdatePanel={onUpdatePanel}
          onRemovePanel={(panelId) => onRemovePanel(panelId, currentPageIndex)}
          pageIndex={currentPageIndex}
        />
      ) : (
        <PanelGrid
          panels={panels}
          template={template}
          onUpdatePanel={onUpdatePanel}
          onRemovePanel={(panelId) => onRemovePanel(panelId, currentPageIndex)}
          onReorderPanels={onReorderPanels}
          pageIndex={currentPageIndex}
        />
      )}
    </div>
  );
};

export default FocusCanvas;

