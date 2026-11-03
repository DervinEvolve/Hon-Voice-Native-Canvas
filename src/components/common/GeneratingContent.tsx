import { BookOpen } from 'lucide-react';
import { motion } from 'framer-motion';

export const GeneratingContent = () => {
  return (
    <div className="flex items-center justify-center h-full">
      <motion.div
        animate={{
          rotateY: [0, 180],
          transition: {
            duration: 1.5,
            repeat: Infinity,
            ease: "easeInOut"
          }
        }}
        className="text-blue-400"
      >
        <BookOpen className="w-12 h-12" />
      </motion.div>
      <p className="text-sm text-gray-500 mt-2">Generating content...</p>
    </div>
  );
}; 