import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Panel } from '../../types';
import { PanelEditor } from './PanelEditor';
import { Move } from 'lucide-react';

interface DraggablePanelProps {
  panel: Panel;
  onUpdate: (panel: Panel) => void;
  onRemove: (panelId: string) => void;
  onSelect: (panel: Panel | null) => void;
}

export const DraggablePanel: React.FC<DraggablePanelProps> = ({
  panel,
  onUpdate,
  onRemove,
  onSelect,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: panel.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    height: '100%',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative h-full rounded-lg overflow-hidden"
      onClick={() => onSelect(panel)}
    >
      <div
        {...attributes}
        {...listeners}
        className="absolute top-2 left-2 z-10 p-1.5 bg-white/90 rounded-full shadow-lg cursor-move opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Move size={16} className="text-gray-600" />
      </div>

      <PanelEditor
        panel={panel}
        onUpdate={onUpdate}
        onRemove={onRemove}
      />
    </div>
  );
};