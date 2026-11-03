import React from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { Panel, Template } from '../../types';
import { DraggablePanel } from './DraggablePanel';
import { PanelEditor } from './PanelEditor';

interface LayoutGridProps {
  template: Template;
  panels: Panel[];
  onUpdatePanel: (panel: Panel) => void;
  onRemovePanel: (panelId: string) => void;
  onReorderPanels: (startIndex: number, endIndex: number) => void;
}

export const LayoutGrid: React.FC<LayoutGridProps> = ({
  template,
  panels,
  onUpdatePanel,
  onRemovePanel,
  onReorderPanels,
}) => {
  const [activeId, setActiveId] = React.useState<string | null>(null);
  
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = panels.findIndex((panel) => panel.id === active.id);
      const newIndex = panels.findIndex((panel) => panel.id === over.id);
      
      // Get the panels being swapped
      const activePanel = panels[oldIndex];
      const overPanel = panels[newIndex];
      
      // Swap their positions in the template layout
      const activeArea = template.layout.areas[oldIndex];
      const overArea = template.layout.areas[newIndex];
      
      // Update both panels with their new positions
      onUpdatePanel({
        ...activePanel,
        position: {
          row: overArea.position.row,
          col: overArea.position.col,
          rowSpan: overArea.position.rowSpan,
          colSpan: overArea.position.colSpan,
        }
      });
      
      onUpdatePanel({
        ...overPanel,
        position: {
          row: activeArea.position.row,
          col: activeArea.position.col,
          rowSpan: activeArea.position.rowSpan,
          colSpan: activeArea.position.colSpan,
        }
      });
      
      // Update the array order
      onReorderPanels(oldIndex, newIndex);
    }

    setActiveId(null);
  };

  const activePanel = activeId ? panels.find((panel) => panel.id === activeId) : null;

  const gridStyle = {
    display: 'grid',
    gridTemplateRows: `repeat(${template.layout.rows}, minmax(0, 1fr))`,
    gridTemplateColumns: `repeat(${template.layout.cols}, minmax(0, 1fr))`,
    gap: '1rem',
    padding: '1rem',
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div style={gridStyle} className="bg-gray-50 rounded-lg min-h-[600px]">
        <SortableContext items={panels.map((p) => p.id)} strategy={rectSortingStrategy}>
          {panels.map((panel, index) => {
            const area = template.layout.areas[index];
            if (!area) return null;

            const gridItemStyle = {
              gridRow: `${area.position.row + 1} / span ${area.position.rowSpan || 1}`,
              gridColumn: `${area.position.col + 1} / span ${area.position.colSpan || 1}`,
            };

            return (
              <div key={panel.id} style={gridItemStyle}>
                <DraggablePanel
                  panel={panel}
                  onUpdate={onUpdatePanel}
                  onRemove={onRemovePanel}
                />
              </div>
            );
          })}
        </SortableContext>
      </div>

      <DragOverlay>
        {activePanel ? (
          <PanelEditor
            panel={activePanel}
            onUpdate={onUpdatePanel}
            onRemove={onRemovePanel}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};