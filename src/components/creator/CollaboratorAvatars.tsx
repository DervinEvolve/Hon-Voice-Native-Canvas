import React from 'react';
import { Collaborator } from '../../types';
import { Tooltip } from '../common/Tooltip';
import { BookOpen } from 'lucide-react';

interface CollaboratorAvatarsProps {
  collaborators: Collaborator[];
}

// Generate a consistent color based on username
const generateUserColor = (username: string): string => {
  const colors = [
    'bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-yellow-500', 
    'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 'bg-teal-500'
  ];
  
  // Simple hash function to get a consistent index
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  return colors[Math.abs(hash) % colors.length];
};

export const CollaboratorAvatars: React.FC<CollaboratorAvatarsProps> = ({ collaborators }) => {
  if (!collaborators || collaborators.length === 0) return null;

  return (
    <div className="flex -space-x-3 overflow-visible">
      {collaborators.map((collaborator) => {
        const userColor = generateUserColor(collaborator.username);
        const cursorColor = userColor.replace('bg-', 'text-');
        
        return (
          <Tooltip
            key={collaborator.id}
            content={
              <div className="flex items-center space-x-2">
                <div className={`p-1 rounded-full ${userColor} flex items-center justify-center`}>
                  <BookOpen className="h-3 w-3 text-white" />
                </div>
                <span>{collaborator.username}</span>
                <span className={`h-2 w-2 rounded-full inline-block ${
                  collaborator.status === 'online' ? 'bg-green-500' : 
                  collaborator.status === 'away' ? 'bg-yellow-500' : 'bg-gray-300'
                }`}></span>
              </div>
            }
            position="bottom"
          >
            <div className="relative group">
              <div 
                className={`relative inline-block h-10 w-10 rounded-full ring-2 ring-white dark:ring-gray-800 ${userColor} transition-all duration-300 transform group-hover:scale-110 flex items-center justify-center`}
              >
                <BookOpen className="h-5 w-5 text-white" />
                
                {/* Status indicator */}
                <span 
                  className={`absolute bottom-0 right-0 block h-3 w-3 rounded-full border-2 border-white dark:border-gray-800 ${
                    collaborator.status === 'online' ? 'bg-green-500' : 
                    collaborator.status === 'away' ? 'bg-yellow-500' : 'bg-gray-300'
                  }`}
                />
              </div>
              
              {/* Animated cursor trail effect */}
              <div className={`absolute -bottom-1 -right-1 h-2 w-2 rounded-full ${userColor} opacity-70 animate-ping`}></div>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}; 