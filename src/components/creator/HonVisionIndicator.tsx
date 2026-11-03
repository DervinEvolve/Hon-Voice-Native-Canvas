/**
 * HonVisionIndicator - Animated eye icon that appears when Hon is "looking" at the scene
 * 
 * Shows a subtle eye with an animated iris that looks around while Hon analyzes the scene.
 * Fades in when pc_look is called, fades out when analysis completes.
 * Color syncs with Hon's processing state.
 * 
 * Listens to custom events:
 * - 'hon-vision-start': Show the eye indicator
 * - 'hon-vision-end': Hide the eye indicator
 */

import React, { useEffect, useState } from 'react';

interface HonVisionIndicatorProps {
  color?: string; // Syncs with Hon indicator color
}

// Default Hon colors
const HON_COLORS = {
  generating: 'rgba(139, 92, 246, 1.0)',   // Purple
  editing: 'rgba(34, 197, 94, 1.0)',       // Green
  dreaming: 'rgba(236, 72, 153, 1.0)',     // Pink
  idle: 'rgba(6, 182, 212, 1.0)',          // Cyan
  looking: 'rgba(139, 92, 246, 1.0)',      // Purple (default for looking)
};

export const HonVisionIndicator: React.FC<HonVisionIndicatorProps> = ({ 
  color = HON_COLORS.looking 
}) => {
  const [isLooking, setIsLooking] = useState(false);
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState<'in' | 'out' | null>(null);

  // Listen for vision events from humeEviService
  useEffect(() => {
    const handleVisionStart = () => {
      console.log('[HonVisionIndicator] Vision started');
      setIsLooking(true);
    };
    
    const handleVisionEnd = () => {
      console.log('[HonVisionIndicator] Vision ended');
      setIsLooking(false);
    };
    
    window.addEventListener('hon-vision-start', handleVisionStart);
    window.addEventListener('hon-vision-end', handleVisionEnd);
    
    return () => {
      window.removeEventListener('hon-vision-start', handleVisionStart);
      window.removeEventListener('hon-vision-end', handleVisionEnd);
    };
  }, []);

  useEffect(() => {
    if (isLooking) {
      // Fade in
      setVisible(true);
      setFading('in');
    } else if (visible) {
      // Fade out after a short delay
      setFading('out');
      const timeout = setTimeout(() => {
        setVisible(false);
        setFading(null);
      }, 800); // Match fade-out duration
      return () => clearTimeout(timeout);
    }
  }, [isLooking, visible]);

  if (!visible) return null;

  return (
    <div
      className={`
        fixed bottom-6 left-6 z-50
        flex items-center gap-2
        pointer-events-none
        transition-opacity duration-500 ease-out
        ${fading === 'in' ? 'animate-fade-in' : ''}
        ${fading === 'out' ? 'animate-fade-out' : ''}
      `}
      style={{
        opacity: fading === 'out' ? 0 : 1,
      }}
    >
      {/* Eye container */}
      <div
        className="relative w-10 h-10 flex items-center justify-center"
        style={{
          filter: `drop-shadow(0 0 8px ${color}) drop-shadow(0 0 16px ${color}40)`,
        }}
      >
        {/* Eye outline (sclera) */}
        <svg
          viewBox="0 0 40 24"
          className="w-10 h-6"
          style={{ overflow: 'visible' }}
        >
          {/* Eye shape */}
          <ellipse
            cx="20"
            cy="12"
            rx="18"
            ry="10"
            fill="rgba(0, 0, 0, 0.6)"
            stroke={color}
            strokeWidth="1.5"
          />
          
          {/* Iris */}
          <g className="hon-iris-animate">
            <circle
              cx="20"
              cy="12"
              r="6"
              fill={color}
              opacity="0.9"
            />
            {/* Pupil */}
            <circle
              cx="20"
              cy="12"
              r="2.5"
              fill="rgba(0, 0, 0, 0.9)"
            />
            {/* Highlight */}
            <circle
              cx="22"
              cy="10"
              r="1.2"
              fill="rgba(255, 255, 255, 0.8)"
            />
          </g>
        </svg>
      </div>

      {/* Optional "Looking..." text */}
      <span
        className="text-xs font-medium tracking-wide opacity-70"
        style={{ color }}
      >
        Looking...
      </span>

      {/* CSS for iris animation */}
      <style>{`
        @keyframes hon-iris-look {
          0%, 100% { transform: translate(0, 0); }
          15% { transform: translate(2px, -1px); }
          30% { transform: translate(-2.5px, 0.5px); }
          45% { transform: translate(1.5px, 1px); }
          60% { transform: translate(-1px, -1.5px); }
          75% { transform: translate(2px, 0.5px); }
          90% { transform: translate(-1.5px, -0.5px); }
        }

        @keyframes hon-fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes hon-fade-out {
          from { opacity: 1; transform: translateY(0); }
          to { opacity: 0; transform: translateY(10px); }
        }

        .hon-iris-animate {
          animation: hon-iris-look 3s ease-in-out infinite;
          transform-origin: center;
        }

        .animate-fade-in {
          animation: hon-fade-in 0.4s ease-out forwards;
        }

        .animate-fade-out {
          animation: hon-fade-out 0.8s ease-out forwards;
        }
      `}</style>
    </div>
  );
};

export default HonVisionIndicator;

