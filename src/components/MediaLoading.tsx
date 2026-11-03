import React from 'react';

export const MediaLoading: React.FC = React.memo(() => (
  <div className="w-full h-full flex items-center justify-center bg-gray-800">
    <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
  </div>
));

MediaLoading.displayName = 'MediaLoading';