import React, { useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { Image, Video } from 'lucide-react';
import { useComicStore } from '../../store/useComicStore';

interface ContentUploaderProps {
  onUpload?: (files: File[]) => void;
}

export const ContentUploader: React.FC<ContentUploaderProps> = ({ onUpload }) => {
  const { currentComic, currentPageIndex, updatePanel } = useComicStore();
  const blobUrlsRef = useRef<string[]>([]);

  // Cleanup blob URLs when component unmounts
  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach(url => {
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, []);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    console.log('Files dropped:', acceptedFiles);
    
    acceptedFiles.forEach((file) => {
      const type = file.type.startsWith('video/') ? 'video' : 
                  file.type.includes('gif') ? 'gif' : 'image';

      const blobUrl = URL.createObjectURL(file);
      blobUrlsRef.current.push(blobUrl);

      const panel = {
        id: crypto.randomUUID(),
        type,
        url: blobUrl,
        file,
        aspectRatio: 1,
        size: 'medium',
        position: { row: 0, col: 0 }
      };

      if (currentComic && typeof currentPageIndex === 'number') {
        updatePanel(panel, currentPageIndex);
      }
    });

    if (onUpload) {
      onUpload(acceptedFiles);
    }
  }, [currentComic, currentPageIndex, updatePanel, onUpload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif'],
      'video/*': ['.mp4', '.webm']
    }
  });

  return (
    <div 
      {...getRootProps()} 
      className={`w-full p-8 border-2 border-dashed border-gray-300 rounded-lg 
        ${isDragActive ? 'bg-blue-50 border-blue-300' : 'bg-gray-50'} 
        flex flex-col items-center justify-center cursor-pointer transition-colors`}
    >
      <input {...getInputProps()} />
      <div className="flex space-x-2 mb-2">
        <Image className="w-6 h-6 text-gray-400" />
        <Video className="w-6 h-6 text-gray-400" />
      </div>
      <p className="text-sm text-gray-500">
        {isDragActive
          ? "Drop your files here..."
          : "Drag & drop or click to add images and videos to your comic"}
      </p>
      <p className="text-xs text-gray-400 mt-1">
        You can also drag files directly onto the panels below
      </p>
    </div>
  );
};
