import React from 'react';
import { Panel } from '../../types';
import { Maximize2, Minimize2 } from 'lucide-react';

interface PanelResizerProps {
  panel: Panel;
  onUpdate: (panel: Panel) => void;
}

export const PanelResizer: React.FC<PanelResizerProps> = ({ panel, onUpdate }) => {
  const handleSizeChange = (size: Panel['size']) => {
    onUpdate({ ...panel, size });
  };

  return (
    <div className="absolute bottom-2 right-2 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={() => handleSizeChange('small')}
        className={`p-1 rounded-full shadow-lg ${
          panel.size === 'small' 
            ? 'bg-blue-500 text-white' 
            : 'bg-white text-gray-700 hover:bg-gray-100'
        }`}
      >
        <Minimize2 size={14} />
      </button>
      <button
        onClick={() => handleSizeChange('medium')}
        className={`p-1 rounded-full shadow-lg ${
          panel.size === 'medium' 
            ? 'bg-blue-500 text-white' 
            : 'bg-white text-gray-700 hover:bg-gray-100'
        }`}
      >
        <Maximize2 size={14} />
      </button>
      <button
        onClick={() => handleSizeChange('large')}
        className={`p-1 rounded-full shadow-lg ${
          panel.size === 'large' 
            ? 'bg-blue-500 text-white' 
            : 'bg-white text-gray-700 hover:bg-gray-100'
        }`}
      >
        <Maximize2 size={16} />
      </button>
    </div>
  );
};