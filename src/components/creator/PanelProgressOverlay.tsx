import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useComicStore } from '../../store/useComicStore';

interface PanelProgressOverlayProps {
  panelId?: string;
  progress?: { status: string; progress: number } | { isGenerating: boolean; progress: string; partialImageUrl?: string };
}

export const PanelProgressOverlay: React.FC<PanelProgressOverlayProps> = ({ panelId, progress }) => {
  const storeProgress = useComicStore(state => panelId ? state.panelGenerationProgress[panelId] : null);
  const panelProgress = storeProgress || progress;
  
  // Track blur level for progressive reveal animation
  const [blurLevel, setBlurLevel] = useState(20);
  
  const isGenerating = panelProgress 
    ? ('isGenerating' in panelProgress ? panelProgress.isGenerating : true)
    : false;
  
  const progressMessage = panelProgress
    ? ('progress' in panelProgress && typeof panelProgress.progress === 'string' 
        ? panelProgress.progress 
        : ('status' in panelProgress ? panelProgress.status : 'Processing...'))
    : 'Processing...';

  // Determine if this is an image editing operation
  const isImageEdit = progressMessage.toLowerCase().includes('edit') || 
                      progressMessage.toLowerCase().includes('transform') ||
                      progressMessage.toLowerCase().includes('modifying') ||
                      progressMessage.toLowerCase().includes('flux') ||
                      progressMessage.toLowerCase().includes('generating');

  // Determine if this is SFX operation
  const isSfx = progressMessage.toLowerCase().includes('sound') || 
                progressMessage.toLowerCase().includes('sfx') ||
                progressMessage.toLowerCase().includes('audio');

  // Progressive blur reduction to simulate streaming
  useEffect(() => {
    if (!isGenerating || !isImageEdit) {
      setBlurLevel(20); // Reset for next time
      return;
    }

    // Start with heavy blur and progressively reduce it
    setBlurLevel(20);
    
    // Animate blur reduction over ~8 seconds (typical edit time)
    // Blur: 20 → 16 → 12 → 8 → 5 → 3
    const intervals = [
      { delay: 1500, blur: 16 },
      { delay: 3000, blur: 12 },
      { delay: 4500, blur: 8 },
      { delay: 6000, blur: 5 },
      { delay: 7500, blur: 3 },
    ];

    const timeouts = intervals.map(({ delay, blur }) => 
      setTimeout(() => {
        if (isGenerating) setBlurLevel(blur);
      }, delay)
    );

    return () => timeouts.forEach(clearTimeout);
  }, [isGenerating, isImageEdit]);

  if (!isGenerating) {
    return null;
  }

  // For image editing: progressive blur that simulates streaming
  if (isImageEdit) {
    return (
      <AnimatePresence>
        <motion.div
          key="blur-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="absolute inset-0 z-50 rounded-lg overflow-hidden pointer-events-none"
          style={{
            backdropFilter: `blur(${blurLevel}px)`,
            WebkitBackdropFilter: `blur(${blurLevel}px)`,
            transition: 'backdrop-filter 0.8s ease-out, -webkit-backdrop-filter 0.8s ease-out',
          }}
        />
      </AnimatePresence>
    );
  }

  // For SFX: keep the audio animation
  if (isSfx) {
    return (
      <AnimatePresence>
        <motion.div
          key="sfx-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="absolute inset-0 z-50 rounded-lg overflow-hidden"
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center">
              <div className="relative w-24 h-16 flex items-end justify-between mb-3">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <motion.span
                    key={i}
                    className="w-1.5 rounded-sm bg-gradient-to-b from-purple-400 to-pink-500"
                    initial={{ height: 6 }}
                    animate={{ height: [6, 24, 10, 28, 12, 20, 8, 26, 6] }}
                    transition={{ duration: 1.4 + i * 0.05, repeat: Infinity, ease: 'easeInOut' }}
                  />
                ))}
              </div>
              <p className="text-sm text-gray-200 font-medium">{progressMessage}</p>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    );
  }

  // Default: simple spinner for other operations
  return (
    <AnimatePresence>
      <motion.div
        key="default-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="absolute inset-0 z-50 rounded-lg overflow-hidden"
      >
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center">
            <motion.div
              className="w-10 h-10 border-3 border-purple-400 border-t-transparent rounded-full mb-3"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            />
            <p className="text-sm text-gray-200 font-medium">{progressMessage}</p>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
