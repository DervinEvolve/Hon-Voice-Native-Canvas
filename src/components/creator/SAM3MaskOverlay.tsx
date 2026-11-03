/**
 * Component to display SAM3 mask boundaries and visual overlays
 * Shows detected object boundaries when masks are available
 */

import React, { useEffect, useState, useRef } from 'react';
import { Panel } from '../../types';
import { useComicStore } from '../../store/useComicStore';
import { generateMask } from '../../services/sam3MaskService';

interface SAM3MaskOverlayProps {
  panel: Panel;
}

export const SAM3MaskOverlay: React.FC<SAM3MaskOverlayProps> = ({ panel }) => {
  const showSAM3Masks = useComicStore(state => state.showSAM3Masks);
  const highlightedObjects = useComicStore(state => state.highlightedObjects[panel.id] || []);
  const panelMaskData = useComicStore(state => state.panelMaskData[panel.id] || {});
  const setPanelMaskData = useComicStore(state => state.setPanelMaskData);
  const [maskData, setMaskData] = useState<Array<{
    object: string;
    box?: number[];
    score?: number;
    highlighted?: boolean;
  }>>([]);
  const [loading, setLoading] = useState(false);
  const fetchedObjectsRef = useRef<Set<string>>(new Set()); // Track which objects we've already fetched

  // Clear cache when panel URL changes
  useEffect(() => {
    fetchedObjectsRef.current.clear();
    setMaskData([]); // Clear masks when URL changes
  }, [panel.url]);

  // Fetch mask data ONLY for highlighted objects (user explicitly requested)
  useEffect(() => {
    // Early return inside useEffect is fine - hooks are still called
    if (!showSAM3Masks || panel.type !== 'image' || highlightedObjects.length === 0) {
      setMaskData([]); // Clear masks when conditions not met
      return;
    }

    if (!panel.url) {
      return;
    }

    const fetchMasks = async () => {
      const storedMaskEntries = highlightedObjects
        .map(object => {
          const stored = panelMaskData[object];
          if (stored && Array.isArray(stored.box) && stored.box.length >= 4) {
            return {
              object,
              box: stored.box,
              score: stored.score ?? null,
              highlighted: true
            };
          }
          return null;
        })
        .filter((entry): entry is { object: string; box: number[]; score?: number | null; highlighted?: boolean } => entry !== null);

      if (storedMaskEntries.length > 0) {
        setMaskData(storedMaskEntries);
      }

      // ONLY fetch masks for highlighted objects (user explicitly requested via highlight_objects tool)
      const objectsToFetch = highlightedObjects;

      // Filter out objects we've already fetched for this panel URL or already cached
      const objectsToFetchNow = objectsToFetch.filter(obj => {
        const stored = panelMaskData[obj];
        if (stored && Array.isArray(stored.box) && stored.box.length >= 4) {
          return false;
        }
        const cacheKey = `${panel.url}|${obj}`;
        if (fetchedObjectsRef.current.has(cacheKey)) {
          return false; // Already fetched
        }
        return true;
      });

      if (objectsToFetchNow.length === 0) {
        setLoading(false);
        return;
      }

      // Mark objects as being fetched
      objectsToFetchNow.forEach(obj => {
        const cacheKey = `${panel.url}|${obj}`;
        fetchedObjectsRef.current.add(cacheKey);
      });

      setLoading(true);
      try {
        const maskPromises = objectsToFetchNow.map(async (object) => {
          try {
            console.log(`[SAM3MaskOverlay] Fetching mask for "${object}" in panel ${panel.id}`);
            const result = await generateMask(panel.url, object, 0.2, { mode: 'visual' });
            
            // Check both result.mask_data.box and result.box (API might return box at top level)
            const box = result.mask_data?.box || result.box;
            const score = result.mask_data?.score ?? result.score ?? null;
            
            // Check for box in multiple possible locations
            const boxToUse = box || result.box;
            
            if (result.success && boxToUse && Array.isArray(boxToUse) && boxToUse.length >= 4) {
              // Validate box values are numbers
              const validBox = boxToUse.every(val => typeof val === 'number' && !isNaN(val));
              if (validBox) {
                console.log(`[SAM3MaskOverlay] Successfully got mask for "${object}" with box:`, boxToUse);
                setPanelMaskData(panel.id, object, {
                  box: boxToUse,
                  score: score ?? null,
                  mask_url: result.mask_url ?? null
                });
                return {
                  object,
                  box: boxToUse,
                  score: score,
                  highlighted: true
                };
              } else {
                console.warn(`[SAM3MaskOverlay] Box contains non-numeric values for "${object}":`, boxToUse);
              }
            } else {
              // If we have a mask_url but no box, we can still show the mask overlay
              // The mask_url can be used for editing even without visual box overlay
              if (result.mask_url) {
                console.log(`[SAM3MaskOverlay] Got mask URL for "${object}" but no box data - mask available for editing`);
                // Return null - we can't show visual overlay without box, but mask is available for editing
                return null;
              }
              
              console.warn(`[SAM3MaskOverlay] Invalid mask data for "${object}":`, {
                success: result.success,
                hasBox: !!boxToUse,
                boxType: typeof boxToUse,
                boxIsArray: Array.isArray(boxToUse),
                hasMaskUrl: !!result.mask_url,
                error: result.error
              });
            }
            return null;
          } catch (error) {
            console.warn(`[SAM3] Failed to fetch mask for ${object}:`, error);
            // Remove from cache on error so it can be retried
            const cacheKey = `${panel.url}|${object}`;
            fetchedObjectsRef.current.delete(cacheKey);
            return null;
          }
        });

        const newMasks = (await Promise.all(maskPromises)).filter(Boolean) as Array<{
          object: string;
          box?: number[];
          score?: number;
          highlighted?: boolean;
        }>;
        
        const highlightedSet = new Set(highlightedObjects);
        const combinedMap = new Map<string, { object: string; box?: number[]; score?: number; highlighted?: boolean }>();
        storedMaskEntries.forEach(entry => combinedMap.set(entry.object, entry));
        newMasks.forEach(newMask => combinedMap.set(newMask.object, newMask));
        const filteredMasks = Array.from(combinedMap.values()).filter(m => highlightedSet.has(m.object));
        
        console.log(`[SAM3MaskOverlay] Updated masks for panel ${panel.id}:`, filteredMasks.map(m => m.object));
        setMaskData(filteredMasks);
      } catch (error) {
        console.error('[SAM3] Mask overlay error:', error);
        setMaskData([]);
      } finally {
        setLoading(false);
      }
    };

    fetchMasks();
  }, [panel.url, panel.id, highlightedObjects.join(','), showSAM3Masks, panelMaskData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Early return AFTER all hooks - this is safe
  if (!showSAM3Masks || panel.type !== 'image' || highlightedObjects.length === 0) {
    return null;
  }

  if (loading) {
    return (
      <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
        <div className="px-2 py-1 bg-blue-500/80 text-white text-xs rounded backdrop-blur-sm">
          Loading masks...
        </div>
      </div>
    );
  }

  if (maskData.length === 0) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-10 pointer-events-none">
      {maskData.map((mask, index) => {
        if (!mask.box || mask.box.length < 4) return null;
        
        // box format: [x_min, y_min, x_max, y_max]
        const [xMin, yMin, xMax, yMax] = mask.box;
        const width = xMax - xMin;
        const height = yMax - yMin;
        
        return (
          <div
            key={`${mask.object}-${index}`}
            className="absolute border-2 border-blue-400/80 bg-blue-500/10 rounded-sm"
            style={{
              left: `${xMin * 100}%`,
              top: `${yMin * 100}%`,
              width: `${width * 100}%`,
              height: `${height * 100}%`,
            }}
          >
            {/* Object label */}
            <div className="absolute -top-5 left-0 px-1.5 py-0.5 bg-blue-500/90 text-white text-[10px] rounded whitespace-nowrap">
              {mask.object} {mask.score ? `(${(mask.score * 100).toFixed(0)}%)` : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
};

