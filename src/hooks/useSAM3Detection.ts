/**
 * Hook for SAM3 object detection on panels
 * Automatically detects objects when panels are displayed
 * Caches results to prevent repeated API calls
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { detectObjects } from '../services/sam3DetectionService';
import { Panel } from '../types';
import { useComicStore } from '../store/useComicStore';
import { moodboardState } from '../utils/moodboardState';

interface UseSAM3DetectionOptions {
  autoDetect?: boolean; // Auto-detect when panel URL changes
  debounceMs?: number; // Debounce detection calls
  saveToPanel?: boolean; // Save detected objects to panel metadata
}

// Global cache to prevent duplicate detection calls across hook instances
const detectionCache = new Map<string, { objects: string[]; timestamp: number }>();
const DETECTION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function useSAM3Detection(
  panel: Panel | null,
  options: UseSAM3DetectionOptions = {}
) {
  const { autoDetect = true, debounceMs = 500, saveToPanel = true } = options;
  const [detectedObjects, setDetectedObjects] = useState<string[]>(panel?.detectedObjects || []);
  const [isDetecting, setIsDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updatePanel = useComicStore(state => state.updatePanel);
  const currentComic = useComicStore(state => state.currentComic);
  const currentPageIndex = useComicStore(state => state.currentPageIndex);
  const detectionAttemptedRef = useRef<Set<string>>(new Set()); // Track URLs we've attempted to detect

  // Manual detection function
  const detect = useCallback(async () => {
    if (!panel || !panel.url || panel.type !== 'image') {
      return;
    }
    
    // Skip during moodboard generation (or cooldown) to prevent floods of API calls
    if (moodboardState.shouldSuppressAutoAnalysis) {
      console.log('[SAM3] ⏭️ Skipping detection during moodboard generation/cooldown');
      return;
    }

    const cacheKey = panel.url;
    
    // Check cache first
    const cached = detectionCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < DETECTION_CACHE_TTL) {
      setDetectedObjects(cached.objects);
      // Update panel if not already saved
      if (saveToPanel && cached.objects.length > 0 && currentComic && !panel.detectedObjects) {
        let panelPageIndex = currentPageIndex;
        for (let pi = 0; pi < currentComic.pages.length; pi++) {
          if (currentComic.pages[pi].some(p => p.id === panel.id)) {
            panelPageIndex = pi;
            break;
          }
        }
        const updatedPanel: Panel = {
          ...panel,
          detectedObjects: cached.objects
        };
        await updatePanel(updatedPanel, panelPageIndex);
      }
      return cached.objects;
    }

    // Prevent duplicate concurrent detection calls for same URL
    if (detectionAttemptedRef.current.has(cacheKey)) {
      return;
    }

    detectionAttemptedRef.current.add(cacheKey);
    setIsDetecting(true);
    setError(null);

    try {
      const objects = await detectObjects(panel.url);
      
      // Cache the results
      detectionCache.set(cacheKey, { objects, timestamp: Date.now() });
      
      setDetectedObjects(objects);
      
      // Save detected objects to panel metadata
      if (saveToPanel && objects.length > 0 && currentComic) {
        // Find which page this panel is on
        let panelPageIndex = currentPageIndex;
        for (let pi = 0; pi < currentComic.pages.length; pi++) {
          if (currentComic.pages[pi].some(p => p.id === panel.id)) {
            panelPageIndex = pi;
            break;
          }
        }
        
        // Update panel with detected objects
        const updatedPanel: Panel = {
          ...panel,
          detectedObjects: objects
        };
        await updatePanel(updatedPanel, panelPageIndex);
      }
      
      return objects;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Detection failed';
      setError(errorMessage);
      console.error('[SAM3] Detection error:', err);
      return [];
    } finally {
      setIsDetecting(false);
      // Remove from attempted set after a delay to allow retry on actual errors
      setTimeout(() => {
        detectionAttemptedRef.current.delete(cacheKey);
      }, 1000);
    }
  }, [panel, saveToPanel, updatePanel, currentComic, currentPageIndex]);

  // Auto-detect when panel changes - ONLY depend on panel.id and panel.url
  useEffect(() => {
    if (!autoDetect || !panel || !panel.url || panel.type !== 'image') {
      return;
    }

    // If already detected, use cached results
    if (panel.detectedObjects && panel.detectedObjects.length > 0) {
      setDetectedObjects(panel.detectedObjects);
      // Also update cache
      detectionCache.set(panel.url, { objects: panel.detectedObjects, timestamp: Date.now() });
      return;
    }

    // Check cache before making API call
    const cached = detectionCache.get(panel.url);
    if (cached && Date.now() - cached.timestamp < DETECTION_CACHE_TTL) {
      setDetectedObjects(cached.objects);
      return;
    }

    // Debounce detection
    const timeoutId = setTimeout(() => {
      detect();
    }, debounceMs);

    return () => clearTimeout(timeoutId);
  }, [panel?.id, panel?.url, autoDetect, debounceMs]); // Removed 'detect' from dependencies

  // Update when panel's detectedObjects change externally
  useEffect(() => {
    if (panel?.detectedObjects) {
      setDetectedObjects(panel.detectedObjects);
      // Update cache
      if (panel.url) {
        detectionCache.set(panel.url, { objects: panel.detectedObjects, timestamp: Date.now() });
      }
    }
  }, [panel?.detectedObjects, panel?.url]);

  return {
    detectedObjects,
    isDetecting,
    error,
    detect, // Manual trigger
  };
}

