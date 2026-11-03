import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { humeEviService, HonProcessingState } from '../../services/humeEviService';
import { Lightbulb, X } from 'lucide-react';

interface HonTooltipProps {
  pageManagerPosition: { x: number; y: number };
  manualTrigger?: boolean;
  onManualClose?: () => void;
}

const HELPFUL_TIPS = [
  {
    category: 'Video Generation',
    tips: [
      "Say 'Generate a cinematic video of...' for high-quality results",
      "Try 'Create a video in the next panel' to auto-place videos",
      "Ask for 'Turn this image into a video' for image-to-video conversion",
      "Mention specific durations: '8 seconds of...' or '5 second video'",
      "Use Seedance for fast generation: 'Make a quick video of...'",
      "Try atmospheric prompts: 'aerial drone shot over city at night'"
    ]
  },
  {
    category: 'Image Creation',
    tips: [
      "Be specific: 'Draw a detailed portrait of...' works better than 'Draw a person'",
      "Mention art styles: 'anime style', 'photorealistic', 'watercolor painting'",
      "Include lighting: 'with dramatic lighting', 'in golden hour light'",
      "Specify compositions: 'close-up shot', 'wide angle view', 'bird's eye view'",
      "Add mood descriptors: 'mysterious', 'vibrant', 'dark and gritty'",
      "Try 'in the style of comic book art' for perfect panel aesthetics"
    ]
  },
  {
    category: 'Panel Management',
    tips: [
      "Say 'Put this in panel 2' to target specific panels",
      "Use 'Fill the empty panels with...' for bulk generation",
      "Try 'Make panel 1 into a video' for targeted conversions",
      "Ask 'Show me the canvas' to get an overview of your comic",
      "Use 'Replace panel 3 with...' to update existing content",
      "Say 'Add captions to all panels' for automatic descriptions"
    ]
  },
  {
    category: 'Storytelling',
    tips: [
      "Set the mood: 'Create a dark, mysterious scene with...'",
      "Build sequences: 'Continue the story from the previous panel'",
      "Add character emotions: 'Show the hero looking determined'",
      "Include action: 'with dynamic movement', 'in the middle of action'",
      "Create transitions: 'Show the same character 5 minutes later'",
      "Use environmental storytelling: 'abandoned cityscape tells the story'"
    ]
  },
  {
    category: 'Quality Control',
    tips: [
      "Request specific resolutions: 'in 1080p quality' or 'high resolution'",
      "Ask for consistency: 'Keep the same character from panel 1'",
      "Specify camera angles: 'from a low angle', 'overhead shot'",
      "Add technical details: 'with shallow depth of field', 'wide lens distortion'",
      "Use 'professional cinematography' for polished video results",
      "Try 'hyper-detailed' or 'ultra-realistic' for enhanced image quality"
    ]
  },
  {
    category: 'Natural Communication',
    tips: [
      "Speak naturally: 'Hey Hon, can you make a video of a sunset?'",
      "Ask follow-ups: 'Make it more dramatic' or 'Add more characters'",
      "Use conversational tone: 'I want something scary for panel 2'",
      "Be polite: 'Please create...' and 'Thank you!' work great",
      "Ask for help: 'What would look good in this empty panel?'",
      "Give feedback: 'That's perfect!' or 'Can you make it darker?'"
    ]
  }
];

export const HonTooltips: React.FC<HonTooltipProps> = ({ pageManagerPosition, manualTrigger, onManualClose }) => {
  const [isHonActive, setIsHonActive] = useState(false);
  const [processingState, setProcessingState] = useState<HonProcessingState>('idle');
  const [currentTip, setCurrentTip] = useState<string | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  // Subscribe to Hon's state changes
  useEffect(() => {
    const unsubscribe = humeEviService.onVisualIndicatorChange((active, state) => {
      setIsHonActive(active);
      setProcessingState(state);
    });

    return unsubscribe;
  }, []);

  // Handle manual trigger
  useEffect(() => {
    if (manualTrigger) {
      const randomCategory = HELPFUL_TIPS[Math.floor(Math.random() * HELPFUL_TIPS.length)];
      const randomTip = randomCategory.tips[Math.floor(Math.random() * randomCategory.tips.length)];
      
      setCurrentTip(`💡 ${randomCategory.category}: ${randomTip}`);
      setShowTooltip(true);
      setIsVisible(true);

      // Auto-hide after 12 seconds for manual triggers (longer than auto)
      const hideTimer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(() => {
          setShowTooltip(false);
          onManualClose?.();
        }, 300);
      }, 12000);

      return () => clearTimeout(hideTimer);
    }
  }, [manualTrigger, onManualClose]);

  // Show tooltip randomly when Hon becomes active (only if not manually triggered)
  useEffect(() => {
    if (!manualTrigger && isHonActive && processingState === 'idle') {
      // Random chance to show tooltip when Hon becomes active
      const shouldShow = Math.random() < 0.3; // 30% chance
      
      if (shouldShow) {
        const randomCategory = HELPFUL_TIPS[Math.floor(Math.random() * HELPFUL_TIPS.length)];
        const randomTip = randomCategory.tips[Math.floor(Math.random() * randomCategory.tips.length)];
        
        setCurrentTip(`💡 ${randomCategory.category}: ${randomTip}`);
        setShowTooltip(true);
        setIsVisible(true);

        // Auto-hide after 8 seconds
        const hideTimer = setTimeout(() => {
          setIsVisible(false);
          setTimeout(() => setShowTooltip(false), 300); // Allow fade out animation
        }, 8000);

        return () => clearTimeout(hideTimer);
      }
    } else if (!isHonActive && !manualTrigger) {
      // Hide tooltip when Hon goes inactive (but not if manually triggered)
      setIsVisible(false);
      setTimeout(() => setShowTooltip(false), 300);
    }
  }, [isHonActive, processingState, manualTrigger]);

  // Don't show during processing states unless manually triggered
  if ((!manualTrigger && processingState !== 'idle') || !showTooltip || !currentTip) {
    return null;
  }

  // Calculate tooltip position above PageManager
  const tooltipStyle = {
    left: `${pageManagerPosition.x + 5}%`, // Slightly offset
    top: `${Math.max(pageManagerPosition.y - 12, 5)}%`, // Above PageManager, with boundary check
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="fixed z-[60] pointer-events-auto"
          style={tooltipStyle}
        >
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-gray-800 dark:to-gray-700 rounded-lg shadow-lg border border-blue-200 dark:border-gray-600 p-4 max-w-sm">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <Lightbulb className="w-5 h-5 text-blue-500 dark:text-blue-400" />
              </div>
              
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                  {currentTip}
                </p>
              </div>

              <button
                onClick={() => {
                  setIsVisible(false);
                  setTimeout(() => {
                    setShowTooltip(false);
                    if (manualTrigger) {
                      onManualClose?.();
                    }
                  }, 300);
                }}
                className="flex-shrink-0 p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                aria-label="Close tip"
              >
                <X className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              </button>
            </div>

            {/* Small arrow pointing down toward PageManager */}
            <div className="absolute bottom-0 left-8 transform translate-y-full">
              <div className="w-0 h-0 border-l-[8px] border-r-[8px] border-t-[8px] border-l-transparent border-r-transparent border-t-blue-200 dark:border-t-gray-600"></div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}; 