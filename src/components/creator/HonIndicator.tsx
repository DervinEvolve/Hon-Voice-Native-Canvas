import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { humeEviService } from '../../services/humeEviService';
import { HonProcessingState } from '../../types/hume';
import { createPortal } from 'react-dom';
import OphanimIndicator from './OphanimIndicator';

// CSS-based animation styles (moved from JS setInterval for better performance)
const pulseAnimationStyles = `
@keyframes hon-pulse-purple {
  0%, 100% { box-shadow: 0 0 25px 8px rgba(139, 92, 246, 0.8); }
  50% { box-shadow: 0 0 40px 16px rgba(139, 92, 246, 1.0); }
}
@keyframes hon-pulse-green {
  0%, 100% { box-shadow: 0 0 25px 8px rgba(34, 197, 94, 0.8); }
  50% { box-shadow: 0 0 40px 16px rgba(34, 197, 94, 1.0); }
}
@keyframes hon-pulse-pink {
  0%, 100% { box-shadow: 0 0 25px 8px rgba(236, 72, 153, 0.8); }
  50% { box-shadow: 0 0 40px 16px rgba(236, 72, 153, 1.0); }
}
@keyframes hon-pulse-blue {
  0%, 100% { box-shadow: 0 0 25px 8px rgba(59, 130, 246, 0.8); }
  50% { box-shadow: 0 0 40px 16px rgba(59, 130, 246, 1.0); }
}
`;

// Inject styles once
if (typeof document !== 'undefined') {
  const styleId = 'hon-indicator-animations';
  if (!document.getElementById(styleId)) {
    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = pulseAnimationStyles;
    document.head.appendChild(styleEl);
  }
}

interface HonIndicatorProps {
  isActive?: boolean;
  isOverviewMode?: boolean;
}

export const HonIndicator: React.FC<HonIndicatorProps> = ({ isActive: propIsActive, isOverviewMode }) => {
  const [isActive, setIsActive] = useState(propIsActive || false);
  const [processingState, setProcessingState] = useState<HonProcessingState>('idle');

  useEffect(() => {
    // If prop is provided, use it
    if (propIsActive !== undefined) {
      setIsActive(propIsActive);
    } else {
      const unsubscribe = humeEviService.onVisualIndicatorChange((active, state) => {
        setIsActive(active);
        setProcessingState(state);
      });

      return () => {
        unsubscribe();
      };
    }
  }, [propIsActive]);

  // Get the glow color based on the processing state (memoized)
  const glowColor = useMemo(() => {
    switch (processingState) {
      case 'generating':
        return 'rgba(139, 92, 246, 1.0)'; // Purple
      case 'editing':
        return 'rgba(34, 197, 94, 1.0)'; // Green
      case 'dreaming':
        return 'rgba(236, 72, 153, 1.0)'; // Pink
      case 'speaking':
      case 'inspiring':
        return 'rgba(59, 130, 246, 1.0)'; // Blue - Hon is speaking
      case 'reasoning':
      case 'processing':
        return 'rgba(139, 92, 246, 1.0)'; // Purple
      default:
        return 'rgba(59, 130, 246, 1.0)'; // Default blue for idle
    }
  }, [processingState]);

  // Get animation name based on processing state (CSS-based, no JS interval)
  const pulseAnimation = useMemo(() => {
    switch (processingState) {
      case 'generating':
      case 'reasoning':
      case 'processing':
        return 'hon-pulse-purple 1.5s ease-in-out infinite';
      case 'editing':
        return 'hon-pulse-green 1.5s ease-in-out infinite';
      case 'dreaming':
        return 'hon-pulse-pink 1.5s ease-in-out infinite';
      case 'speaking':
      case 'inspiring':
        return 'hon-pulse-blue 1.5s ease-in-out infinite';
      default:
        return 'none';
    }
  }, [processingState]);

  // Get border style with CSS animation instead of JS-driven updates
  const getBorderStyle = useMemo(() => {
    if (processingState !== 'idle') {
      return {
        border: '5px solid',
        borderColor: glowColor,
        animation: pulseAnimation,
      };
    } else {
      return {
        border: `5px solid rgba(59, 130, 246, 1.0)`,
        boxShadow: `0 0 30px 8px rgba(59, 130, 246, 0.8)`,
      };
    }
  }, [processingState, glowColor, pulseAnimation]);

  // Map HonProcessingState to OphanimState
  const ophanimState = useMemo(() => {
    switch (processingState) {
      case 'generating':
        return 'generating';
      case 'editing':
        return 'editing';
      case 'dreaming':
        return 'dreaming';
      case 'speaking':
        return 'speaking';
      case 'inspiring':
        return 'inspiring';
      case 'reasoning':
        return 'reasoning';
      case 'processing':
        return 'processing';
      default:
        return 'idle';
    }
  }, [processingState]);

  const loaderPortal = useMemo(() => {
    if (typeof document === 'undefined') return null;
    // Hard gate: never render if EVI session is not active
    try {
      if (!humeEviService.isSessionActive()) return null;
    } catch {}
    return createPortal(
      <AnimatePresence>
        {isOverviewMode && isActive && (
          <motion.div
            className="pointer-events-none fixed bottom-8 right-8 z-40"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            <OphanimIndicator state={ophanimState} size={80} showLabel={true} />
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
    );
  }, [isOverviewMode, isActive, ophanimState]);

  if (isOverviewMode) {
    return <>{loaderPortal}</>;
  }

  // Never render indicator if session is not active
  if (!humeEviService.isSessionActive()) {
    return null;
  }

  return (
    <>
      {loaderPortal}
      <AnimatePresence>
        {isActive && (
          <motion.div
            className="absolute inset-0 pointer-events-none rounded-lg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={getBorderStyle}
          />
        )}
      </AnimatePresence>
    </>
  );
};