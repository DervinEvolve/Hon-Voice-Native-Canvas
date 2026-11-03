import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ProgressiveImageProps {
  partialImageUrl?: string;
  finalImageUrl?: string;
  isGenerating: boolean;
  className?: string;
}

export const ProgressiveImage: React.FC<ProgressiveImageProps> = ({
  partialImageUrl,
  finalImageUrl,
  isGenerating,
  className = ''
}) => {
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null);
  const [blurLevel, setBlurLevel] = useState(20);

  useEffect(() => {
    if (finalImageUrl) {
      // Final high-quality image
      setCurrentImageUrl(finalImageUrl);
      setBlurLevel(0);
    } else if (partialImageUrl && isGenerating) {
      // Progressive streaming image
      setCurrentImageUrl(partialImageUrl);
      // Gradually reduce blur as more data comes in
      setBlurLevel(prev => Math.max(0, prev - 3));
    }
  }, [partialImageUrl, finalImageUrl, isGenerating]);

  if (!currentImageUrl) {
    return (
      <div className={`bg-gray-200 dark:bg-gray-700 rounded-lg flex items-center justify-center ${className}`}>
        <div className="text-gray-500 dark:text-gray-400 text-sm">
          Preparing generation...
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-lg ${className}`}>
      <AnimatePresence>
        <motion.img
          key={currentImageUrl}
          src={currentImageUrl}
          alt="Generated image"
          className="w-full h-full object-cover"
          style={{
            filter: `blur(${blurLevel}px)`,
            transition: 'filter 0.5s ease-out'
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        />
      </AnimatePresence>

      {/* Progress overlay */}
      {isGenerating && (
        <motion.div
          initial={{ opacity: 1 }}
          animate={{ opacity: finalImageUrl ? 0 : 1 }}
          className="absolute inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center"
        >
          <div className="text-white text-sm bg-black/50 px-3 py-1 rounded-full">
            {blurLevel > 0 ? 'Refining...' : 'Almost done...'}
          </div>
        </motion.div>
      )}

      {/* Generation watermark (hidden for SFX; shown only when ProgressiveImage is used for image gen) */}
      {isGenerating && (
        <div className="absolute bottom-2 right-2 text-[10px] bg-black/50 text-white px-2 py-0.5 rounded">
          Generating
        </div>
      )}
    </div>
  );
}; 