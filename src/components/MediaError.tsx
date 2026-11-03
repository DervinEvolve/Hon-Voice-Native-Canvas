import React from 'react';
import { AlertCircle } from 'lucide-react';

interface MediaErrorProps {
  message: string;
  onRetry: () => void;
}

export const MediaError: React.FC<MediaErrorProps> = React.memo(({ message, onRetry }) => (
  <div className="w-full h-full flex flex-col items-center justify-center bg-gray-800 text-white gap-4 p-4">
    <AlertCircle className="w-8 h-8 text-red-500" />
    <p className="text-sm text-gray-300 text-center">{message}</p>
    <button 
      onClick={onRetry}
      className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
    >
      Retry
    </button>
  </div>
));

MediaError.displayName = 'MediaError';