import React, { useState, useRef, useEffect } from 'react';
import { useMediaLoader } from '../hooks/useMediaLoader';
import { Loader2, RefreshCw, Volume2, VolumeX } from 'lucide-react';
import { Model3DViewer } from './media/Model3DViewer';

// @ts-ignore
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        alt?: string;
        'camera-controls'?: boolean;
        'auto-rotate'?: boolean;
        'camera-orbit'?: string;
        exposure?: string;
        'shadow-intensity'?: string;
        ar?: boolean;
        style?: React.CSSProperties;
      };
    }
  }
}

interface MediaContentProps {
  url: string;
  type: 'image' | 'video' | 'gif' | '3d';
  className?: string;
  onLoad?: () => void;
  onError?: () => void;
  style?: React.CSSProperties;
  preventClickThrough?: boolean; // For Feed/Profile cards only
}

const MediaContent: React.FC<MediaContentProps> = ({ 
  url, 
  type, 
  className = '',
  onLoad,
  onError,
  style,
  preventClickThrough = false
}) => {
  const { isLoading, error, objectUrl, retry } = useMediaLoader({
    url,
    onLoad,
    onError
  });
  
  const [videoError, setVideoError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [showMuteButton, setShowMuteButton] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Reset video error state when url changes
  useEffect(() => {
    setVideoError(false);
    setRetryCount(0);
  }, [url]);
  
  // Handle video error with retry logic
  const handleVideoError = () => {
    if (retryCount < 3) {
      setVideoError(true);
      setRetryCount(prev => prev + 1);
      
      // Add a small delay before retry
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.load();
        }
      }, 1000);
    } else {
      onError?.();
    }
  };

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error || videoError) {
    return (
      <div 
        className={`flex flex-col items-center justify-center ${className}`}
        onClick={(e) => {
          e.stopPropagation();
          setVideoError(false);
          setRetryCount(0);
          retry();
        }}
      >
        <p className="text-sm text-red-400">Failed to load media</p>
        <button className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      </div>
    );
  }

  const commonProps = {
    src: objectUrl,
    className: `${className} object-cover`,
    style: {
      objectFit: 'cover' as const,
      width: '100%',
      height: '100%',
      backgroundColor: '#1a1a1a',
      ...style
    }
  };

  if (type === 'video' || type === 'gif') {
    return (
      <div 
        className="relative w-full h-full"
        onMouseEnter={() => setShowMuteButton(true)}
        onMouseLeave={() => setShowMuteButton(false)}
      >
      <video
        ref={videoRef}
        {...commonProps}
        autoPlay
        loop
          muted={isMuted}
        playsInline
        preload="metadata"
        poster={url.replace('/video/upload/', '/video/upload/q_auto:low,f_jpg,so_0/')}
        onLoadedData={() => onLoad?.()}
        onError={handleVideoError}
      />
        {showMuteButton && (
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="absolute bottom-2 right-2 bg-black bg-opacity-50 text-white p-2 rounded-full hover:bg-opacity-70 transition-all z-10"
          >
            {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        )}
      </div>
    );
  }

  if (type === '3d') {
    return (
      <Model3DViewer
        src={objectUrl}
        alt="3D Model"
        className={className}
        autoRotate={true}
        cameraControls={true}
        loading="lazy"
        preventClickThrough={preventClickThrough}
      />
    );
  }

  return (
    <img
      {...commonProps}
      alt=""
      loading="lazy"
      decoding="async"
      onLoad={() => onLoad?.()}
      onError={() => onError?.()}
    />
  );
};

export default MediaContent;