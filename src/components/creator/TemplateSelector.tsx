import React from 'react';
import { Layout, Grid, Maximize, PanelTop, LayoutPanelLeft, Columns, Move } from 'lucide-react';
import type { Template } from '../../types';

interface TemplateSelectorProps {
  onSelect: (template: Template) => void;
  selectedTemplate: Template | null;
}

// Define template with additional iconComponent property for rendering
interface ExtendedTemplate extends Omit<Template, 'icon'> {
  icon: string;
  iconComponent: React.ElementType;
}

export const TemplateSelector: React.FC<TemplateSelectorProps> = ({
  onSelect,
  selectedTemplate
}) => {
  const templates: ExtendedTemplate[] = [
    // Original templates - keep these exactly as they were
    {
      id: 'manga',
      name: 'Manga Style (3x1)',
      description: 'Horizontal layout with three equal panels side by side',
      icon: 'layout',
      iconComponent: Layout,
      layout: { 
        rows: 1, 
        cols: 3,
        areas: [
          { size: "medium", position: { row: 0, col: 0 } },
          { size: "medium", position: { row: 0, col: 1 } },
          { size: "medium", position: { row: 0, col: 2 } }
        ]
      }
    },
    {
      id: 'grid',
      name: 'Grid Layout (2x2)',
      description: 'Classic grid with four equal panels',
      icon: 'grid',
      iconComponent: Grid,
      layout: { 
        rows: 2, 
        cols: 2,
        areas: [
          { size: "medium", position: { row: 0, col: 0 } },
          { size: "medium", position: { row: 0, col: 1 } },
          { size: "medium", position: { row: 1, col: 0 } },
          { size: "medium", position: { row: 1, col: 1 } }
        ]
      }
    },
    {
      id: 'featured',
      name: 'Featured Panel',
      description: 'Single large panel for impact',
      icon: 'maximize',
      iconComponent: Maximize,
      layout: { 
        rows: 2, 
        cols: 2,
        areas: [
          { size: "large", position: { row: 0, col: 0, rowSpan: 2, colSpan: 2 } }
        ]
      }
    },
    
    // Just three new templates
    {
      id: 'horizontal-split',
      name: 'Horizontal Split (3 Panels)',
      description: 'One large panel on top with two smaller panels below',
      icon: 'panel-top',
      iconComponent: PanelTop,
      layout: { 
        rows: 2, 
        cols: 2,
        areas: [
          { size: "large", position: { row: 0, col: 0, colSpan: 2 } },
          { size: "medium", position: { row: 1, col: 0 } },
          { size: "medium", position: { row: 1, col: 1 } }
        ]
      }
    },
    {
      id: 'vertical-split',
      name: 'Vertical Split (3 Panels)',
      description: 'One large panel on left with two smaller panels on right',
      icon: 'layout-panel-left',
      iconComponent: LayoutPanelLeft,
      layout: { 
        rows: 2, 
        cols: 2,
        areas: [
          { size: "large", position: { row: 0, col: 0, rowSpan: 2 } },
          { size: "medium", position: { row: 0, col: 1 } },
          { size: "medium", position: { row: 1, col: 1 } }
        ]
      }
    },
    {
      id: 'staggered',
      name: 'Staggered (4 Panels)',
      description: 'Four panels with staggered layout for dynamic storytelling',
      icon: 'columns',
      iconComponent: Columns,
      layout: { 
        rows: 3, 
        cols: 2,
        areas: [
          { size: "medium", position: { row: 0, col: 0 } },
          { size: "medium", position: { row: 0, col: 1 } },
          { size: "medium", position: { row: 1, col: 0, rowSpan: 2 } },
          { size: "medium", position: { row: 1, col: 1, rowSpan: 2 } }
        ]
      }
    },
    {
      id: 'custom',
      name: 'Custom Canvas',
      description: 'Free-form canvas - resize, drag, add/remove panels anywhere',
      icon: 'move',
      iconComponent: Move,
      layout: { 
        rows: 1, 
        cols: 1,
        areas: [] // Empty areas for free-form layout
      }
    }
  ];

  return (
    <div className="grid grid-cols-1 gap-3 max-h-[500px] overflow-y-auto pr-2">
      <h3 className="font-medium text-gray-700 mb-1">Select a Template</h3>
      {templates.map((template) => {
        const Icon = template.iconComponent;
        // Create a Template object without the iconComponent property
        const templateForSelection: Template = {
          id: template.id,
          name: template.name,
          description: template.description,
          icon: template.icon,
          layout: template.layout
        };
        
        return (
          <button
            key={template.id}
            onClick={() => onSelect(templateForSelection)}
            className={`w-full p-3 text-sm text-left border rounded-lg transition-colors flex items-center gap-3
              ${selectedTemplate?.id === template.id 
                ? 'bg-purple-900 border-purple-700' 
                : 'hover:bg-gray-700 border-gray-700'}`}
          >
            <Icon className="w-5 h-5 text-gray-400 flex-shrink-0" />
            <span className="font-medium text-gray-300">{template.name}</span>
          </button>
        )
      })}
    </div>
  );
};