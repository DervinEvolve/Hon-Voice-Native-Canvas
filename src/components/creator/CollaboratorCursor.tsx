import React, { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { Tooltip } from '../common/Tooltip';
import { Collaborator } from '../../types';

interface CollaboratorCursorProps {
  collaborator: Collaborator;
  position?: { x: number; y: number };
}

// Generate a consistent color based on username
const generateUserColor = (username: string): string => {
  const colors = [
    'text-red-500', 'text-blue-500', 'text-green-500', 'text-yellow-500', 
    'text-purple-500', 'text-pink-500', 'text-indigo-500', 'text-teal-500'
  ];
  
  // Simple hash function to get a consistent index
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  return colors[Math.abs(hash) % colors.length];
};

export const CollaboratorCursor: React.FC<CollaboratorCursorProps> = ({ 
  collaborator,
  position = { x: 0, y: 0 }
}) => {
  const cursorColor = generateUserColor(collaborator.username);
  
  // We're not showing the cursor at all now
  return null;
}; 