import React, { useEffect, useRef, useState } from 'react';

interface Model3DViewerProps {
  src: string;
  alt?: string;
  className?: string;
  autoRotate?: boolean;
  cameraControls?: boolean;
  loading?: 'lazy' | 'eager';
  poster?: string; // Placeholder image while loading
  preventClickThrough?: boolean; // Prevent parent click events when interacting
}

export const Model3DViewer: React.FC<Model3DViewerProps> = ({ 
  src, 
  alt = '3D Model',
  className = '',
  autoRotate = false,
  cameraControls = true,
  loading = 'lazy',
  poster,
  preventClickThrough = true
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const modelViewerRef = useRef<HTMLElement>(null);
  const [isInView, setIsInView] = useState(loading === 'eager');
  const [isLoaded, setIsLoaded] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hasError, setHasError] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  
  // Lazy load with Intersection Observer
  useEffect(() => {
    if (loading === 'eager' || !containerRef.current) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            setIsInView(true);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: '200px' // Start loading 200px before entering viewport
      }
    );
    
    observer.observe(containerRef.current);
    
    return () => observer.disconnect();
  }, [loading]);
  
  // Load model-viewer script dynamically
  useEffect(() => {
    if (!isInView) return;
    
    // Check if model-viewer is already loaded
    if (customElements.get('model-viewer')) {
      setIsLoaded(true);
      return;
    }
    
    // index.html loads the pinned model-viewer build with an integrity hash.
    // Wait for it instead of injecting a second, unverified copy.
    let active = true;
    const timeout = window.setTimeout(() => { if (active) setHasError(true); }, 20000);
    customElements.whenDefined('model-viewer').then(() => {
      window.clearTimeout(timeout);
      if (active) setIsLoaded(true);
    });

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [isInView]);

  // Listen for model-viewer load/progress events to control custom progress bar
  useEffect(() => {
    const el = modelViewerRef.current as any;
    if (!el) return;
    const handleLoad = () => setModelLoaded(true);
    const handleProgress = (e: any) => {
      const p = e?.detail?.totalProgress;
      if (typeof p === 'number') setProgress(p);
    };
    el.addEventListener('load', handleLoad);
    el.addEventListener('progress', handleProgress);
    return () => {
      el.removeEventListener('load', handleLoad);
      el.removeEventListener('progress', handleProgress);
    };
  }, [isInView, isLoaded]);
  
  // Add event listeners to model-viewer to prevent click-through
  useEffect(() => {
    if (!modelViewerRef.current || !preventClickThrough || !cameraControls) return;
    
    const modelViewer = modelViewerRef.current;
    
    const handlePointerDown = (e: Event) => {
      setIsInteracting(true);
      e.stopPropagation();
    };
    
    const handlePointerUp = (e: Event) => {
      e.stopPropagation();
      setTimeout(() => setIsInteracting(false), 100);
    };
    
    const handleClick = (e: Event) => {
      if (isInteracting) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    
    modelViewer.addEventListener('pointerdown', handlePointerDown);
    modelViewer.addEventListener('pointerup', handlePointerUp);
    modelViewer.addEventListener('click', handleClick);
    modelViewer.addEventListener('mousedown', (e) => e.stopPropagation());
    
    return () => {
      modelViewer.removeEventListener('pointerdown', handlePointerDown);
      modelViewer.removeEventListener('pointerup', handlePointerUp);
      modelViewer.removeEventListener('click', handleClick);
    };
  }, [preventClickThrough, cameraControls, isInteracting]);
  
  if (hasError) {
    return (
      <div className={`flex items-center justify-center bg-gray-800 ${className}`}>
        <p className="text-gray-400 text-sm">Failed to load 3D model</p>
      </div>
    );
  }
  
  if (!isInView) {
    return (
      <div 
        ref={containerRef} 
        className={`flex items-center justify-center bg-gray-800 ${className}`}
        style={{ minHeight: '200px' }}
      >
        {poster ? (
          <img src={poster} alt={alt} className="w-full h-full object-cover opacity-50" />
        ) : (
          <div className="text-gray-400 text-sm">Loading 3D model...</div>
        )}
      </div>
    );
  }
  
  if (!isLoaded) {
    return (
      <div className={`flex items-center justify-center bg-gray-800 ${className}`}>
        <div className="animate-pulse text-gray-400 text-sm">Initializing 3D viewer...</div>
      </div>
    );
  }
  
  return (
    <div 
      ref={containerRef} 
      className={className}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      <model-viewer
        ref={modelViewerRef as any}
        src={src}
        alt={alt}
        auto-rotate={autoRotate ? 'true' : undefined}
        camera-controls={cameraControls ? 'true' : undefined}
        poster={poster}
        loading="eager"
        reveal="auto"
        interaction-prompt="none"
        style={{
          width: '100%',
          height: '100%',
          minHeight: '200px',
          cursor: cameraControls ? 'grab' : 'default'
        }}
        // Performance optimizations
        shadow-intensity="1"
        exposure="1"
        environment-image="neutral"
      >
        {/* Loading slot - only render while model reports not loaded */}
        {!modelLoaded && (
          <div slot="progress-bar" className="w-full h-1 bg-gray-700 overflow-hidden">
            <div className="h-full bg-purple-500" style={{ width: `${Math.max(10, Math.min(100, Math.round(progress * 100)))}%` }}></div>
          </div>
        )}
      </model-viewer>
      
      {/* Visual hint for interaction - only show on hover */}
      {cameraControls && autoRotate && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20 opacity-0 hover:opacity-100 transition-opacity">
          <div className="bg-black/80 text-white text-sm px-4 py-2 rounded-lg">
            Hover to interact
          </div>
        </div>
      )}
      
      {/* Show interaction hint when controls are active */}
      {cameraControls && !autoRotate && !isInteracting && (
        <div className="absolute bottom-2 left-2 bg-black/80 text-white text-xs px-2 py-1 rounded-md pointer-events-none flex items-center gap-1.5 animate-pulse">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
          </svg>
          Click & drag to rotate
        </div>
      )}
    </div>
  );
};

// Type declaration for model-viewer custom element
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          alt?: string;
          'auto-rotate'?: string;
          'camera-controls'?: string;
          poster?: string;
          loading?: string;
          reveal?: string;
          'interaction-prompt'?: string;
          'shadow-intensity'?: string;
          exposure?: string;
          'environment-image'?: string;
        },
        HTMLElement
      >;
    }
  }
}

