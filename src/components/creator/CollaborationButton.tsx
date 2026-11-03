import React, { useState } from 'react';
import { Users } from 'lucide-react';
import { Tooltip } from '../common/Tooltip';

interface CollaborationButtonProps {
  onClick: () => void;
}

export const CollaborationButton: React.FC<CollaborationButtonProps> = ({ onClick }) => {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className="relative">
      <button 
        onClick={onClick}
        className="p-1.5 rounded-full hover:bg-gray-700 transition-colors"
        title="Invite to Collab"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <Users className="w-4 h-4 text-gray-300" />
      </button>
      
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1.5 bg-purple-500 text-white text-xs rounded shadow-lg whitespace-normal z-50 min-w-max">
          Invite to Collab
        </div>
      )}
    </div>
  );
}; 