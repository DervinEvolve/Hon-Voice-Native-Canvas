import React, { useState, useEffect, useRef } from 'react';
import { Clock, X, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { canvasHistoryBus, TimelineItem } from '../../utils/canvasHistory';
import { useComicStore } from '../../store/useComicStore';

interface CanvasTimelineProps {
  projectId: string;
  onRestore?: (snapshotId: string) => Promise<void>;
  onClose?: () => void;
  parentWidth?: number;
}

export const CanvasTimeline: React.FC<CanvasTimelineProps> = ({ 
  projectId, 
  onRestore, 
  onClose,
  parentWidth 
}) => {
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [scrollPosition, setScrollPosition] = useState(0);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [failedThumbnails, setFailedThumbnails] = useState<Set<string>>(new Set()); // Track snapshots that don't have thumbnails
  const timelineRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { currentComic } = useComicStore();

  useEffect(() => {
    loadTimeline();
    
    const unsubscribe = canvasHistoryBus.on('all', (event) => {
      // If this is a thumbnail update event, refresh thumbnails
      if (event.eventType === 'snapshot_created' && event.eventData?.isUpdate && event.snapshotId) {
        // Reload thumbnail for this specific snapshot
        loadThumbnailForSnapshot(event.snapshotId);
      } else {
        // Otherwise reload the entire timeline
        loadTimeline();
      }
    });

    return unsubscribe;
  }, [projectId]);

  // Load thumbnails from snapshots when timeline changes
  useEffect(() => {
    if (timeline.length > 0) {
      loadThumbnailsFromSnapshots();
      
      // Also set up a periodic check for thumbnails that might be generated asynchronously
      // Check every 5 seconds for any snapshots that don't have thumbnails yet (but haven't failed)
      // Only check for 30 seconds total to avoid infinite loops
      let checkCount = 0;
      const maxChecks = 6; // 6 checks * 5 seconds = 30 seconds max
      const interval = setInterval(() => {
        checkCount++;
        if (checkCount > maxChecks) {
          clearInterval(interval);
          return;
        }
        
        const missingThumbnails = timeline.filter(
          item => item.snapshotId && !thumbnails[item.snapshotId] && !failedThumbnails.has(item.snapshotId!)
        );
        if (missingThumbnails.length > 0) {
          console.log('[CanvasTimeline] Checking for missing thumbnails:', missingThumbnails.length, `(check ${checkCount}/${maxChecks})`);
          // Only check first 3 missing thumbnails per interval to avoid overload
          missingThumbnails.slice(0, 3).forEach(item => {
            loadThumbnailForSnapshot(item.snapshotId!);
          });
        } else {
          // All thumbnails loaded or failed, stop checking
          clearInterval(interval);
        }
      }, 5000); // Increased to 5 seconds to reduce spam
      
      return () => clearInterval(interval);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, failedThumbnails]);

  const loadTimeline = async () => {
    setLoading(true);
    try {
      const items = await canvasHistoryBus.getTimeline(100);
      // Filter to only show items with snapshots for the visual timeline
      // Prefer events with snapshots (they have better descriptions), fall back to standalone snapshots
      const snapshotItems = items.filter(item => 
        item.type === 'snapshot' || (item.snapshotId && item.hasSnapshot)
      );
      
      // Map snapshot items to use event descriptions when available
      const enrichedItems = snapshotItems.map(item => {
        if (item.type === 'snapshot' && item.snapshotId) {
          // Find the associated event that created this snapshot
          const associatedEvent = items.find(e => 
            e.type === 'event' && e.snapshotId === item.snapshotId && e.description
          );
          if (associatedEvent && associatedEvent.description) {
            return {
              ...item,
              description: associatedEvent.description,
              eventType: associatedEvent.eventType || item.eventType
            };
          }
        }
        return item;
      });
      
      console.log('[CanvasTimeline] Loaded timeline:', {
        total: items.length,
        withSnapshots: enrichedItems.length
      });
      setTimeline(enrichedItems);
    } catch (error) {
      console.error('[CanvasTimeline] Failed to load timeline:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadThumbnailForSnapshot = async (snapshotId: string) => {
    try {
      console.log('[CanvasTimeline] Loading thumbnail for snapshot:', snapshotId);
      const snapshot = await canvasHistoryBus.getSnapshot(snapshotId);
      console.log('[CanvasTimeline] Snapshot retrieved:', {
        id: snapshot?.id,
        hasCanvasState: !!snapshot?.canvasState,
        hasThumbnail: !!snapshot?.canvasState?.thumbnail,
        thumbnailType: snapshot?.canvasState?.thumbnail ? typeof snapshot.canvasState.thumbnail : 'none',
        thumbnailPreview: snapshot?.canvasState?.thumbnail ? snapshot.canvasState.thumbnail.substring(0, 100) : 'none',
        canvasStateKeys: snapshot?.canvasState ? Object.keys(snapshot.canvasState) : []
      });
      
      if (snapshot?.canvasState?.thumbnail) {
        const thumbnailUrl = snapshot.canvasState.thumbnail;
        console.log('[CanvasTimeline] Setting thumbnail for snapshot:', snapshotId, 'URL type:', thumbnailUrl.startsWith('data:') ? 'data URL' : thumbnailUrl.startsWith('http') ? 'HTTP URL' : 'unknown');
        setThumbnails(prev => {
          const updated = { ...prev, [snapshotId]: thumbnailUrl };
          console.log('[CanvasTimeline] Thumbnails state updated:', Object.keys(updated).length, 'thumbnails');
          return updated;
        });
      } else {
        console.warn('[CanvasTimeline] No thumbnail found in snapshot:', snapshotId, {
          snapshotExists: !!snapshot,
          canvasStateExists: !!snapshot?.canvasState,
          canvasStateKeys: snapshot?.canvasState ? Object.keys(snapshot.canvasState) : []
        });
        // Mark this snapshot as failed so we don't keep checking it
        setFailedThumbnails(prev => new Set(prev).add(snapshotId));
      }
    } catch (error) {
      console.error('[CanvasTimeline] Failed to load thumbnail for snapshot:', snapshotId, error);
    }
  };

  const loadThumbnailsFromSnapshots = async () => {
    const thumbnailPromises = timeline
      .filter(item => item.snapshotId && !thumbnails[item.snapshotId] && !failedThumbnails.has(item.snapshotId!))
      .map(async (item) => {
        await loadThumbnailForSnapshot(item.snapshotId!);
      });
    
    await Promise.all(thumbnailPromises);
  };

  const handleRestore = async (snapshotId: string) => {
    if (!onRestore || restoring) return;
    
    setRestoring(snapshotId);
    setSelectedSnapshotId(snapshotId);
    try {
      await onRestore(snapshotId);
      await loadTimeline();
    } catch (error) {
      console.error('[CanvasTimeline] Failed to restore:', error);
    } finally {
      setRestoring(null);
    }
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    return `${days}d`;
  };

  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -200, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 200, behavior: 'smooth' });
    }
  };


  const getEventLabel = (item: TimelineItem) => {
    // If description exists and is not a generic "Snapshot created" message, use it
    if (item.description && 
        item.description !== 'Snapshot created' && 
        !item.description.startsWith('Snapshot created (') &&
        !item.description.startsWith('Snapshot (')) {
      return item.description;
    }
    
    // For snapshot items, try to extract meaningful info from description
    // Check if description contains event-related keywords
    if (item.description) {
      const desc = item.description.toLowerCase();
      if (desc.includes('panel deleted') || desc.includes('deleted')) return 'Panel deleted';
      if (desc.includes('panel edited') || desc.includes('updated')) return 'Panel edited';
      if (desc.includes('panel added') || desc.includes('created')) return 'Panel added';
      if (desc.includes('moved')) return 'Panel moved';
      if (desc.includes('resized')) return 'Panel resized';
      if (desc.includes('grouped')) return 'Panels grouped';
      if (desc.includes('ungrouped')) return 'Panels ungrouped';
      if (desc.includes('board view')) return 'Board view';
      if (desc.includes('focus view')) return 'Focus view';
      if (desc.includes('timeline layout')) return 'Timeline layout';
      if (desc.includes('storyboard layout')) return 'Storyboard layout';
      if (desc.includes('cluster layout')) return 'Cluster layout';
      if (desc.includes('arrange grid')) return 'Arrange grid';
    }
    
    // Map event types to user-friendly two-word descriptions
    const eventTypeLabels: Record<string, string> = {
      'panel_create': 'Panel added',
      'panel_update': 'Panel edited',
      'panel_delete': 'Panel deleted',
      'panel_move': 'Panel moved',
      'panel_resize': 'Panel resized',
      'panel_group': 'Panels grouped',
      'panel_ungroup': 'Panels ungrouped',
      'canvas_pan': 'Canvas panned',
      'canvas_zoom': 'Canvas zoomed',
      'canvas_layout': 'Layout changed',
      'view_mode_change': 'View changed',
      'snapshot_created': 'Snapshot created',
      'restore_point': 'State restored',
      'voice_task_complete': 'Task completed',
    };
    
    if (item.eventType && eventTypeLabels[item.eventType]) {
      return eventTypeLabels[item.eventType];
    }
    
    // Fallback: format event type
    if (item.eventType) {
      return item.eventType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
    
    return 'Snapshot';
  };

  const thumbnailWidth = 120;
  const thumbnailHeight = 80;

  return (
      <div 
        ref={timelineRef}
        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-gray-900/95 backdrop-blur-sm border border-gray-700 rounded-lg shadow-xl z-50"
        style={{ width: parentWidth ? `${parentWidth}px` : 'auto', minWidth: '400px' }}
      >
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-300" />
          <h3 className="text-sm font-semibold text-gray-100">Canvas Timeline</h3>
          <span className="text-xs text-gray-400">({timeline.length} snapshots)</span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Timeline Scrubber */}
      <div className="relative p-3">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-sm text-gray-400">Loading timeline...</div>
          </div>
        ) : timeline.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-sm text-gray-400">No snapshots yet</div>
          </div>
        ) : (
          <>
            {/* Scroll Left Button */}
            {scrollPosition > 0 && (
              <button
                onClick={scrollLeft}
                className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-2 bg-gray-800/90 hover:bg-gray-700 rounded-full border border-gray-700 transition-colors"
              >
                <ChevronLeft className="w-4 h-4 text-gray-300" />
              </button>
            )}

            {/* Scroll Container */}
            <div
              ref={scrollContainerRef}
              className="timeline-scroll flex gap-3 overflow-x-auto overflow-y-hidden pb-2"
              onScroll={(e) => {
                const target = e.target as HTMLDivElement;
                setScrollPosition(target.scrollLeft);
              }}
            >
              {timeline.map((item, index) => {
                const isSelected = selectedSnapshotId === item.snapshotId;
                const isRestoring = restoring === item.snapshotId;
                const isNewest = index === 0;

                return (
                  <div
                    key={item.id}
                    className={`flex-shrink-0 flex flex-col items-center gap-2 cursor-pointer group ${
                      isSelected ? 'ring-2 ring-yellow-400 rounded-lg p-1' : ''
                    }`}
                    onClick={() => {
                      if (item.snapshotId && onRestore) {
                        handleRestore(item.snapshotId);
                      }
                    }}
                  >
                    {/* Canvas Thumbnail */}
                    <div
                      className={`relative bg-gray-800 border-2 rounded overflow-hidden transition-all ${
                        isSelected
                          ? 'border-yellow-400 shadow-lg shadow-yellow-400/50'
                          : 'border-gray-700 group-hover:border-gray-600'
                      }`}
                      style={{
                        width: `${thumbnailWidth}px`,
                        height: `${thumbnailHeight}px`,
                      }}
                    >
                      {thumbnails[item.snapshotId!] ? (
                        <>
                          <img
                            src={thumbnails[item.snapshotId!]}
                            alt="Canvas snapshot"
                            className="w-full h-full object-cover"
                            style={{ display: 'block' }}
                            onLoad={() => {
                              console.log('[CanvasTimeline] Image loaded successfully for snapshot:', item.snapshotId);
                            }}
                            onError={(e) => {
                              console.error('[CanvasTimeline] Image failed to load for snapshot:', item.snapshotId, thumbnails[item.snapshotId!]);
                              // Hide the image and show placeholder
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                            }}
                          />
                          {/* Placeholder shown only if image fails to load (handled by onError) */}
                          <div 
                            className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900 absolute inset-0"
                            style={{ display: 'none' }}
                          >
                            <div className="text-gray-500 text-xs text-center px-2">
                              {getEventLabel(item)}
                            </div>
                          </div>
                        </>
                      ) : (
                        /* Placeholder when no thumbnail URL available */
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900 absolute inset-0">
                          {isRestoring ? (
                            <div className="text-yellow-400 text-xs animate-pulse">Restoring...</div>
                          ) : (
                            <div className="text-gray-500 text-xs text-center px-2">
                              {getEventLabel(item)}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Newest Badge */}
                      {isNewest && (
                        <div className="absolute top-1 right-1 bg-green-500 text-white text-[10px] px-1.5 py-0.5 rounded">
                          New
                        </div>
                      )}

                      {/* Selected Indicator */}
                      {isSelected && (
                        <div className="absolute inset-0 bg-yellow-400/10 pointer-events-none" />
                      )}
                    </div>

                    {/* Time Label */}
                    <div className={`text-xs ${isSelected ? 'text-yellow-400 font-medium' : 'text-gray-400'}`}>
                      {formatTime(item.createdAt)}
                    </div>

                    {/* Event Type Badge */}
                    {item.eventType && (
                      <div className="text-[10px] text-gray-500 px-2 py-0.5 bg-gray-800 rounded">
                        {item.eventType.replace(/_/g, ' ')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Scroll Right Button */}
            {scrollContainerRef.current && 
             scrollPosition < (scrollContainerRef.current.scrollWidth - scrollContainerRef.current.clientWidth - 10) && (
              <button
                onClick={scrollRight}
                className="absolute right-0 top-1/2 -translate-y-1/2 z-10 p-2 bg-gray-800/90 hover:bg-gray-700 rounded-full border border-gray-700 transition-colors"
              >
                <ChevronRight className="w-4 h-4 text-gray-300" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};
