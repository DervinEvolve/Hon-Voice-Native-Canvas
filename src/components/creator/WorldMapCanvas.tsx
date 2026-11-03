import React, { useEffect, useRef, useState } from 'react';
import { ensureMaps3D } from '../../lib/googleMaps3d';
import { useComicStore } from '../../store/useComicStore';
import { Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Loading phrases that cycle with Hon's signature colors
const LOADING_PHASES = [
  { text: 'Rendering...', color: 'rgb(139, 92, 246)' },   // Purple
  { text: 'Generating...', color: 'rgb(34, 197, 94)' },   // Green  
  { text: 'Dreaming...', color: 'rgb(236, 72, 153)' },    // Pink
  { text: 'Inspiring...', color: 'rgb(59, 130, 246)' },   // Blue
];

interface WorldMapCanvasProps {
  onClose: () => void;
}

const DEFAULT_CAMERA = {
  lat: 40.758,
  lng: -73.9855,
  altitude: 200,
  heading: 0,
  tilt: 67,
  range: 800,
};

const MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID?.trim() ?? '';

export const WorldMapCanvas: React.FC<WorldMapCanvasProps> = ({}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapElementRef = useRef<HTMLElement | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isLibraryLoaded, setIsLibraryLoaded] = useState(false);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [loadingPhaseIndex, setLoadingPhaseIndex] = useState(0);

  const worldSettings = useComicStore(s => s.worldSettings);
  const setWorldSettings = useComicStore(s => s.setWorldSettings);
  const world3DModels = useComicStore(s => s.world3DModels);
  const targetRef = useRef(worldSettings.mapTarget);
  const modelElementsRef = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    targetRef.current = worldSettings.mapTarget;
  }, [worldSettings.mapTarget]);

  // Cycle through loading phrases
  useEffect(() => {
    if (!isReady && !loadingTimedOut) {
      const interval = setInterval(() => {
        setLoadingPhaseIndex(prev => (prev + 1) % LOADING_PHASES.length);
      }, 1200); // Change phrase every 1.2 seconds
      return () => clearInterval(interval);
    }
  }, [isReady, loadingTimedOut]);

  // First effect: Load the library
  useEffect(() => {
    if (!MAP_ID) {
      setWorldSettings({
        mapStatus: 'error',
        mapError: 'Google Maps Map ID missing. Set VITE_GOOGLE_MAPS_MAP_ID in your environment and redeploy.',
      });
      return;
    }

    let cancelled = false;

    const loadLibrary = async () => {
      try {
        await ensureMaps3D();
        if (cancelled) return;
        setIsLibraryLoaded(true);
      } catch (error) {
        console.error('[WorldMapCanvas] Failed to load library', error);
        setWorldSettings({
          mapStatus: 'error',
          mapError: 'Google Maps failed to load. Check your API key restrictions.',
        });
      }
    };

    loadLibrary();
    return () => { cancelled = true; };
  }, [setWorldSettings]);

  // Second effect: Create the element AFTER library is loaded
  useEffect(() => {
    if (!isLibraryLoaded || !containerRef.current || !MAP_ID) return;

    // Get initial camera from target or default
    const initialCenter = targetRef.current 
      ? { lat: targetRef.current.lat, lng: targetRef.current.lng, altitude: targetRef.current.altitude }
      : { lat: DEFAULT_CAMERA.lat, lng: DEFAULT_CAMERA.lng, altitude: DEFAULT_CAMERA.altitude };
    
    const element = document.createElement('gmp-map-3d');
    
    // Set attributes
    element.setAttribute('map-id', MAP_ID);
    element.setAttribute('mode', showLabels ? 'hybrid' : 'satellite');
    element.setAttribute('center', `${initialCenter.lat},${initialCenter.lng},${initialCenter.altitude || 500}`);
    element.setAttribute('heading', String(targetRef.current?.heading ?? DEFAULT_CAMERA.heading));
    element.setAttribute('tilt', String(targetRef.current?.tilt ?? DEFAULT_CAMERA.tilt));
    element.setAttribute('range', String(targetRef.current?.range ?? DEFAULT_CAMERA.range));
    element.setAttribute('default-ui-hidden', 'true');
    
    element.style.width = '100%';
    element.style.height = '100%';
    element.style.display = 'block';
    
    mapElementRef.current = element;

    const handleReady = () => {
      setIsReady(true);
      setWorldSettings({
        mapStatus: targetRef.current ? 'ready' : 'idle',
      });
    };

    const handleViewChange = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail;
      const camera = detail?.camera;
      const center = camera?.center;
      if (!camera || !center) return;

      setWorldSettings({
        mapView: {
          lat: center.lat,
          lng: center.lng,
          altitude: center.altitude ?? targetRef.current?.altitude ?? DEFAULT_CAMERA.altitude,
          heading: camera.heading ?? DEFAULT_CAMERA.heading,
          tilt: camera.tilt ?? DEFAULT_CAMERA.tilt,
          range: camera.range ?? DEFAULT_CAMERA.range,
        },
      });
    };

    const handleError = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail;
      console.error('[WorldMapCanvas] Map error:', detail);
      setWorldSettings({
        mapStatus: 'error',
        mapError: detail?.message || 'Map failed to load',
      });
    };

    const handleSteadyChange = () => {
      const el = element as any;
      if (el.isSteady) {
        setIsReady(true);
      }
    };

    // Attach listeners before adding to DOM
    element.addEventListener('gmp-ready', handleReady);
    element.addEventListener('gmp-error', handleError);
    element.addEventListener('gmp-viewchange', handleViewChange);
    element.addEventListener('gmp-steadychange', handleSteadyChange);

    containerRef.current.appendChild(element);

    // Safety timeout - force clear loading after 8 seconds
    const safetyTimeout = setTimeout(() => {
      if (!isReady) {
        setLoadingTimedOut(true);
      }
    }, 8000);

    return () => {
      clearTimeout(safetyTimeout);
      element.removeEventListener('gmp-ready', handleReady);
      element.removeEventListener('gmp-error', handleError);
      element.removeEventListener('gmp-viewchange', handleViewChange);
      element.removeEventListener('gmp-steadychange', handleSteadyChange);
      element.remove();
      mapElementRef.current = null;
    };
  }, [isLibraryLoaded, setWorldSettings, isReady, showLabels]);

  // Third effect: Update camera when target changes (only if ready)
  // Uses flyCameraTo for smooth animated transitions between locations
  useEffect(() => {
    if (!mapElementRef.current || !worldSettings.mapTarget || !isReady) {
      return;
    }
    const { lat, lng, altitude, heading, tilt, range } = worldSettings.mapTarget;
    const element = mapElementRef.current as HTMLElement & { 
      camera?: any;
      flyCameraTo?: (options: any) => Promise<void>;
    };

    // Use flyCameraTo for smooth animated transition if available
    if (element.flyCameraTo && typeof element.flyCameraTo === 'function') {
      element.flyCameraTo({
        endCamera: {
          center: { lat, lng, altitude },
          heading,
          tilt,
          range,
        },
        durationMillis: 2000, // 2 second smooth flight
      }).catch((err: any) => {
        console.warn('[WorldMapCanvas] flyCameraTo failed, falling back to instant:', err);
        // Fallback to instant camera change
        element.camera = {
          center: { lat, lng, altitude },
          heading,
          tilt,
          range,
        };
      });
    } else {
      // Fallback to instant camera change
      element.camera = {
        center: { lat, lng, altitude },
        heading,
        tilt,
        range,
      };
    }
  }, [worldSettings.mapTarget, isReady]);

  // Fourth effect: Sync 3D models to the map
  // This effect should NOT have a cleanup that removes all models, because:
  // 1. The effect re-runs when world3DModels changes
  // 2. If cleanup removes all models, they get re-created every time
  // 3. Instead, we only remove models that are no longer in the store
  useEffect(() => {
    console.log('[WorldMapCanvas] 3D models effect triggered:', {
      hasMapElement: !!mapElementRef.current,
      isReady,
      modelCount: world3DModels.length,
      models: world3DModels.map(m => ({ id: m.id, url: m.modelUrl?.substring(0, 50) })),
    });
    
    if (!mapElementRef.current || !isReady) {
      console.log('[WorldMapCanvas] Skipping model sync - map not ready or no element');
      return;
    }
    
    const mapElement = mapElementRef.current;
    const currentModelIds = new Set(world3DModels.map(m => m.id));
    
    console.log('[WorldMapCanvas] Syncing 3D models, count:', world3DModels.length);
    
    // Remove models that are no longer in the store
    modelElementsRef.current.forEach((el, id) => {
      if (!currentModelIds.has(id)) {
        console.log('[WorldMapCanvas] Removing model no longer in store:', id);
        try {
          el.remove();
        } catch (e) {
          console.warn('[WorldMapCanvas] Error removing model element:', e);
        }
        modelElementsRef.current.delete(id);
      }
    });
    
    // Add or update models using the Google Maps 3D API
    // According to docs: position must be an object {lat, lng, altitude}, not a string
    // Use an IIFE with for...of to properly handle async operations and avoid race conditions
    let cancelled = false;
    
    (async () => {
      for (const model of world3DModels) {
        // Check if effect was cleaned up before we finish
        if (cancelled) return;
        
        // Skip if model element already exists
        if (modelElementsRef.current.has(model.id)) {
          console.log('[WorldMapCanvas] Model already exists, updating:', model.id);
          const existingEl = modelElementsRef.current.get(model.id)!;
          
          // Scale calculation - AI models are often in mm/cm, so we need MUCH larger scales
          // A typical Meshy model might be 1-10cm tall, so we need 100-1000x to make it visible
          // Multiply any provided scale by 10 to ensure visibility, then clamp to reasonable range
          const rawScale = (model.scale || 100) * 10;
          const effectiveScale = Math.min(Math.max(rawScale, 500), 5000);
          // Use ABSOLUTE altitude mode for better visibility - places model at exact altitude above sea level
          const altitudeMode = model.altitudeMode?.toUpperCase().replace(/-/g, '_') || 'ABSOLUTE';
          
          // Update existing model properties
          try {
            (existingEl as any).src = model.modelUrl;
            (existingEl as any).position = {
              lat: model.position.lat,
              lng: model.position.lng,
              altitude: model.position.altitude,
            };
            (existingEl as any).scale = effectiveScale;
            (existingEl as any).altitudeMode = altitudeMode;
            
            if (model.orientation) {
              (existingEl as any).orientation = {
                heading: model.orientation.heading || 0,
                tilt: model.orientation.tilt || 0,
                roll: model.orientation.roll || 0,
              };
            }
          } catch (err) {
            console.error('[WorldMapCanvas] Failed to update model:', err);
          }
          continue;
        }
        
        // Scale calculation:
        // - glTF standard units are meters, so scale=1 means 1 unit = 1 meter
        // - BUT AI-generated models (Meshy) are often in mm or cm, NOT meters
        // - A typical Meshy model might be 1-10cm tall in its native units
        // - To make a 10cm model appear as 50 meters tall, we need scale=500
        // - Multiply any provided scale by 10 to ensure visibility
        // - Minimum scale of 500 ensures visibility, max of 5000 prevents Godzilla-sized objects
        const rawScale = (model.scale || 100) * 10;
        const effectiveScale = Math.min(Math.max(rawScale, 500), 5000);
        
        // Determine altitude mode based on model settings
        // ABSOLUTE: exact altitude above sea level (most reliable for visibility)
        // RELATIVE_TO_MESH: sits on top of 3D buildings/terrain (can clip inside)
        // RELATIVE_TO_GROUND: relative to ground level (may be inside buildings)
        // Default to ABSOLUTE for best visibility over water/terrain
        const altitudeMode = model.altitudeMode?.toUpperCase().replace(/-/g, '_') || 'ABSOLUTE';
        
        // Create new model element using the Google Maps 3D API constructor
        console.log('[WorldMapCanvas] Creating new Model3DElement for:', model.id);
        console.log('[WorldMapCanvas] Model URL:', model.modelUrl);
        console.log('[WorldMapCanvas] Position:', model.position);
        console.log('[WorldMapCanvas] Original scale:', model.scale, '-> Effective scale:', effectiveScale);
        console.log('[WorldMapCanvas] Altitude mode:', altitudeMode);
        
        try {
          // Use the Model3DElement constructor from the maps3d library
          const { Model3DElement } = await google.maps.importLibrary('maps3d') as any;
          
          // Check cancellation after async operation
          if (cancelled) return;
          
          // Create model with proper object-based options (not string attributes)
          const modelEl = new Model3DElement({
            src: model.modelUrl,
            position: {
              lat: model.position.lat,
              lng: model.position.lng,
              altitude: model.position.altitude,
            },
            scale: effectiveScale,
            // Use the model's altitudeMode or default to RELATIVE_TO_MESH
            // RELATIVE_TO_MESH places objects on top of 3D buildings/terrain
            altitudeMode: altitudeMode,
            orientation: model.orientation ? {
              heading: model.orientation.heading || 0,
              tilt: model.orientation.tilt || 0,
              roll: model.orientation.roll || 0,
            } : undefined,
          });
          
          modelElementsRef.current.set(model.id, modelEl);
          mapElement.appendChild(modelEl);
          
          console.log('[WorldMapCanvas] Model3DElement created and appended:', model.id);
          
          // Add error listener to debug loading issues
          modelEl.addEventListener('error', (e: any) => {
            console.error('[WorldMapCanvas] Model load error:', model.id, e);
          });
          
          // Listen for load success
          modelEl.addEventListener('load', () => {
            console.log('[WorldMapCanvas] Model loaded successfully:', model.id);
          });
          
          console.log('[WorldMapCanvas] Model element properties:', {
            id: model.id,
            src: (modelEl as any)?.src || model.modelUrl,
            position: model.position,
            scale: effectiveScale,
            altitudeMode: altitudeMode,
          });
        } catch (err) {
          console.error('[WorldMapCanvas] Failed to create Model3DElement:', err);
        }
      }
    })();
    
    // Cleanup: set cancelled flag to prevent async operations from completing after unmount
    return () => {
      cancelled = true;
    };
  }, [world3DModels, isReady]);
  
  // Separate cleanup effect for component unmount only
  useEffect(() => {
    return () => {
      console.log('[WorldMapCanvas] Component unmounting: Removing all model elements');
      modelElementsRef.current.forEach((el, id) => {
        try {
          console.log('[WorldMapCanvas] Unmount cleanup removing model:', id);
          el.remove();
        } catch (e) {
          console.warn('[WorldMapCanvas] Error during unmount cleanup:', e);
        }
      });
      modelElementsRef.current.clear();
    };
  }, []); // Empty deps = only runs on unmount

  const status = worldSettings.mapStatus;
  const mapError = worldSettings.mapError;
  const hasTarget = Boolean(worldSettings.mapTarget);
  const showLoading = !isReady && !loadingTimedOut && !mapError;

  return (
    <div className="w-full h-full relative bg-black overflow-hidden" style={{ minHeight: '400px' }}>
      {/* Container for gmp-map-3d element */}
      <div 
        ref={containerRef} 
        className="absolute inset-0"
        style={{ minHeight: '400px', minWidth: '400px' }}
      />

      {/* Labels toggle button - positioned bottom left, above Google attribution */}
      {isReady && (
        <button
          onClick={() => setShowLabels(prev => !prev)}
          className="absolute bottom-8 left-28 z-30 bg-black/60 hover:bg-black/80 text-white px-2.5 py-1.5 rounded-md flex items-center gap-1.5 text-[11px] backdrop-blur-sm transition-colors"
          title={showLabels ? 'Hide place labels' : 'Show place labels'}
        >
          {showLabels ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          <span>{showLabels ? 'Labels' : 'Labels'}</span>
        </button>
      )}

      {status === 'error' && mapError && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-red-200 bg-red-900/60 px-4 py-2 rounded-full border border-red-500/40">
          {mapError}
        </div>
      )}

      {!hasTarget && status !== 'error' && isReady && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white/70 text-sm">
          Queue a location from the side menu to jump into a real-world scene.
        </div>
      )}

      {showLoading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/90">
          <AnimatePresence mode="wait">
            <motion.div
              key={loadingPhaseIndex}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="text-center"
            >
              <motion.span
                className="text-2xl font-medium tracking-wide"
                style={{ 
                  color: LOADING_PHASES[loadingPhaseIndex].color,
                  textShadow: `0 0 30px ${LOADING_PHASES[loadingPhaseIndex].color}40, 0 0 60px ${LOADING_PHASES[loadingPhaseIndex].color}20`
                }}
                animate={{ 
                  opacity: [0.7, 1, 0.7],
                }}
                transition={{ 
                  duration: 1.5, 
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
              >
                {LOADING_PHASES[loadingPhaseIndex].text}
              </motion.span>
            </motion.div>
          </AnimatePresence>
        </div>
      )}

      {loadingTimedOut && !isReady && (
        <div className="pointer-events-none absolute top-16 left-1/2 -translate-x-1/2 text-amber-300 text-xs bg-amber-900/60 px-3 py-1.5 rounded-full z-30">
          Map may not have loaded correctly. Check Map ID configuration.
        </div>
      )}

      {!MAP_ID && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-red-200 bg-red-900/70">
          Missing Google Maps Map ID. Add VITE_GOOGLE_MAPS_MAP_ID to your environment and redeploy.
        </div>
      )}
    </div>
  );
};

