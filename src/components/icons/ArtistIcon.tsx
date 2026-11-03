import React from 'react';

export const ArtistIcon: React.FC<{ className?: string }> = ({ className = "w-6 h-6" }) => {
  return (
    <svg 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
      className={className}
    >
      {/* Head */}
      <circle cx="12" cy="7" r="3" />
      
      {/* Body */}
      <path d="M12 10v4" />
      
      {/* Arms - one holding a paintbrush */}
      <path d="M9 12l-2 2" /> {/* Left arm */}
      <path d="M15 12l3 2" /> {/* Right arm */}
      
      {/* Paintbrush */}
      <path d="M18 14l3 1" /> {/* Brush handle */}
      <path d="M21 15c0.5 0.2 0.5 0.8 0 1" /> {/* Brush tip */}
      
      {/* Legs */}
      <path d="M9 14l-1 4" />
      <path d="M15 14l1 4" />
    </svg>
  );
}; 