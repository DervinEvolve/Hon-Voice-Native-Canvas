/**
 * Canvas History Event Bus System
 * Tracks all canvas activity (voice-triggered AND manual) and manages snapshots
 */

import { supabase } from './supabaseClient';
import { generateCanvasThumbnail } from './canvasThumbnail';
import { mediaService } from '../services/mediaService';

export type CanvasEventType =
  | 'panel_create'
  | 'panel_update'
  | 'panel_delete'
  | 'panel_move'
  | 'panel_resize'
  | 'panel_group'
  | 'panel_ungroup'
  | 'panel_link'
  | 'canvas_pan'
  | 'canvas_zoom'
  | 'canvas_layout'
  | 'voice_task_start'
  | 'voice_task_complete'
  | 'voice_task_failed'
  | 'conversation_start'
  | 'conversation_message'
  | 'conversation_end'
  | 'snapshot_created'
  | 'restore_point'
  | 'view_mode_change'
  // Immersive scene events
  | 'immersive_object_add'
  | 'immersive_object_update'
  | 'immersive_object_delete'
  | 'immersive_scene_clear'
  | 'immersive_environment_change'
  | 'immersive_execute';

export interface CanvasEvent {
  id?: string;
  projectId: string;
  userId?: string;
  walletAddress?: string;
  eventType: CanvasEventType;
  eventDescription?: string;
  voiceEventId?: string;
  conversationId?: string;
  voiceTranscript?: string;
  eventData?: Record<string, any>;
  snapshotId?: string;
  createdAt?: Date;
}

export interface CanvasSnapshot {
  id?: string;
  projectId: string;
  userId?: string;
  walletAddress?: string;
  snapshotType: 'manual' | 'auto' | 'restore_point' | 'voice_task_complete' | 'immersive_scene';
  description?: string;
  canvasState: Record<string, any>; // Complete canvas state (includes immersiveScene when in world mode)
  voiceEventId?: string;
  conversationId?: string;
  voiceContext?: string;
  createdAt?: Date;
}

// Immersive scene state structure (stored within canvasState.immersiveScene)
export interface ImmersiveSceneSnapshotState {
  objects: Array<{
    id: string;
    type: 'primitive' | 'model' | 'light' | 'effect';
    primitiveType?: string;
    modelUrl?: string;
    modelPrompt?: string;
    lightType?: string;
    effectType?: string;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
    color?: string;
    emissive?: string;
    emissiveIntensity?: number;
    metalness?: number;
    roughness?: number;
    opacity?: number;
    intensity?: number;
    range?: number;
    animation?: any;
    name?: string;
    createdAt: string;
    createdBy: 'user' | 'hon';
  }>;
  environment: {
    skyType: 'color' | 'gradient' | 'hdri';
    skyColor?: string;
    fogEnabled: boolean;
    fogColor?: string;
    fogDensity?: number;
    ambientColor: string;
    ambientIntensity: number;
    timeOfDay?: string;
  };
  camera: {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    fov: number;
  };
  // Screenshot of the PlayCanvas scene for visual reference
  screenshotUrl?: string;
}

export interface TimelineItem {
  id: string;
  type: 'event' | 'snapshot';
  eventType?: CanvasEventType;
  description?: string;
  voiceEventId?: string;
  conversationId?: string;
  voiceTranscript?: string;
  snapshotId?: string;
  createdAt: Date;
  hasSnapshot: boolean;
}

type EventListener = (event: CanvasEvent) => void;

class CanvasHistoryBus {
  private listeners: Map<CanvasEventType | 'all', Set<EventListener>> = new Map();
  private eventQueue: CanvasEvent[] = [];
  private isProcessingQueue = false;
  private projectId: string | null = null;
  private thumbnailQueue: Array<{ snapshotId: string; canvasState: Record<string, any> }> = [];
  private isProcessingThumbnails = false;
  private thumbnailCache: Map<string, string> = new Map(); // Cache generated thumbnails
  private userId: string | null = null;
  private walletAddress: string | null = null;
  
  // Snapshot strategy
  private lastSnapshotTime = 0;
  private readonly SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly SNAPSHOT_EVENT_TYPES: CanvasEventType[] = [
    'panel_create',
    'panel_update',
    'panel_delete',
    'panel_move',
    'panel_resize',
    'panel_group',
    'panel_ungroup',
    'voice_task_complete',
    'restore_point',
    'view_mode_change',
    // Immersive scene events that should trigger snapshots
    'immersive_object_add',
    'immersive_object_delete',
    'immersive_scene_clear',
    'immersive_environment_change',
    'immersive_execute'
  ];

  /**
   * Initialize the event bus with project and user context
   */
  initialize(projectId: string, userId?: string, walletAddress?: string) {
    // Clear queues and cache when switching projects
    if (this.projectId && this.projectId !== projectId) {
      this.thumbnailQueue = [];
      this.thumbnailCache.clear();
      this.isProcessingThumbnails = false;
    }
    
    this.projectId = projectId;
    this.userId = userId || null;
    this.walletAddress = walletAddress || null;
    this.lastSnapshotTime = Date.now();
    // Initialized silently for performance
  }

  /**
   * Subscribe to canvas events
   */
  on(eventType: CanvasEventType | 'all', listener: EventListener) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener);
    
    return () => {
      this.listeners.get(eventType)?.delete(listener);
    };
  }

  /**
   * Emit a canvas event
   */
  async emit(event: Omit<CanvasEvent, 'projectId' | 'userId' | 'walletAddress'>) {
    if (!this.projectId) {
      console.warn('[CanvasHistory] Cannot emit event: not initialized');
      return;
    }

    const fullEvent: CanvasEvent = {
      ...event,
      projectId: this.projectId,
      userId: this.userId || undefined,
      walletAddress: this.walletAddress || undefined,
    };

    // Notify listeners
    this.notifyListeners(fullEvent);

    // Queue for saving
    this.eventQueue.push(fullEvent);
    await this.processQueue();

    // Check if we should create a snapshot
    const shouldSnapshot = 
      this.SNAPSHOT_EVENT_TYPES.includes(fullEvent.eventType) ||
      (Date.now() - this.lastSnapshotTime) > this.SNAPSHOT_INTERVAL_MS;

    if (shouldSnapshot) {
      // Snapshot will be created by the caller with canvas state
      this.lastSnapshotTime = Date.now();
    }
  }

  /**
   * Create a snapshot of the current canvas state
   */
  async createSnapshot(
    canvasState: Record<string, any>,
    snapshotType: CanvasSnapshot['snapshotType'] = 'auto',
    description?: string,
    voiceEventId?: string,
    conversationId?: string,
    voiceContext?: string
  ): Promise<string | null> {
    if (!this.projectId) {
      console.warn('[CanvasHistory] Cannot create snapshot: not initialized', {
        projectId: this.projectId,
        userId: this.userId,
        walletAddress: this.walletAddress
      });
      return null;
    }

    console.log('[CanvasHistory] Creating snapshot:', {
      projectId: this.projectId,
      snapshotType,
      description,
      hasCanvasState: !!canvasState
    });

    try {
      const { data, error } = await supabase.rpc('create_canvas_snapshot', {
        p_project_id: this.projectId,
        p_snapshot_type: snapshotType,
        p_canvas_state: { ...canvasState, thumbnail: null },
        p_user_id: this.userId || undefined,
        p_wallet_address: this.walletAddress || undefined,
        p_description: description,
        p_voice_event_id: voiceEventId,
        p_conversation_id: conversationId,
        p_voice_context: voiceContext
      });

      if (error) {
        console.error('[CanvasHistory] Snapshot insert error:', error);
        throw error;
      }

      const snapshotId = data; // RPC returns the ID directly

      // Queue thumbnail generation (non-blocking, processed in background queue)
      this.queueThumbnailGeneration(snapshotId, canvasState);

      // Emit snapshot_created event
      await this.emit({
        eventType: 'snapshot_created',
        eventDescription: description || `Snapshot created (${snapshotType})`,
        snapshotId,
        eventData: { snapshotType, description },
      });

      console.log('[CanvasHistory] Snapshot created:', snapshotId);
      return snapshotId;
    } catch (error) {
      console.error('[CanvasHistory] Failed to create snapshot:', error);
      return null;
    }
  }

  /**
   * Queue thumbnail generation for background processing
   * Uses a queue system to avoid overwhelming the browser with concurrent thumbnail generations
   */
  private queueThumbnailGeneration(snapshotId: string, canvasState: Record<string, any>) {
    // Check cache first
    const cacheKey = JSON.stringify(canvasState).substring(0, 200); // Use first 200 chars as cache key
    if (this.thumbnailCache.has(cacheKey)) {
      const cachedUrl = this.thumbnailCache.get(cacheKey)!;
      this.updateSnapshotThumbnail(snapshotId, cachedUrl);
      return;
    }

    // Add to queue
    this.thumbnailQueue.push({ snapshotId, canvasState });
    
    // Start processing if not already running
    if (!this.isProcessingThumbnails) {
      this.processThumbnailQueue();
    }
  }

  /**
   * Process thumbnail generation queue (one at a time for performance)
   */
  private async processThumbnailQueue() {
    if (this.isProcessingThumbnails || this.thumbnailQueue.length === 0) {
      return;
    }

    this.isProcessingThumbnails = true;

    while (this.thumbnailQueue.length > 0) {
      const { snapshotId, canvasState } = this.thumbnailQueue.shift()!;
      
      try {
        await this.generateAndStoreThumbnail(snapshotId, canvasState);
      } catch (error) {
        console.error('[CanvasHistory] Thumbnail generation failed for snapshot:', snapshotId, error);
      }

      // Small delay between generations to avoid overwhelming the browser
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.isProcessingThumbnails = false;
  }

  /**
   * Generate thumbnail and store it using PostgreSQL RPC function
   */
  private async generateAndStoreThumbnail(snapshotId: string, canvasState: Record<string, any>) {
    try {
      // Generate thumbnail
      const thumbnailDataUrl = await generateCanvasThumbnail(canvasState, 120, 80);
      if (!thumbnailDataUrl) {
        console.warn('[CanvasHistory] Thumbnail generation returned null for snapshot:', snapshotId);
        return;
      }

      let storedThumbnailUrl = thumbnailDataUrl;
      
      // Upload to Cloudinary if it's a data URL (to avoid DB bloat)
      if (thumbnailDataUrl.startsWith('data:')) {
        try {
          const uploadedUrl = await mediaService.upload(thumbnailDataUrl);
          if (uploadedUrl && uploadedUrl.startsWith('http')) {
            storedThumbnailUrl = uploadedUrl;
          }
        } catch (uploadErr) {
          // Fall back to data URL if Cloudinary upload fails
          console.warn('[CanvasHistory] Cloudinary upload failed, using data URL:', uploadErr);
        }
      }

      // Update snapshot using PostgreSQL RPC function (atomic JSONB merge)
      const { data: success, error } = await supabase.rpc('update_canvas_snapshot_thumbnail', {
        p_snapshot_id: snapshotId,
        p_thumbnail_url: storedThumbnailUrl
      });

      if (error) {
        console.error('[CanvasHistory] Failed to update thumbnail via RPC:', error);
        // Fallback: try direct update
        const { error: updateError } = await supabase
          .from('canvas_history_snapshots')
          .update({ 
            canvas_state: { ...canvasState, thumbnail: storedThumbnailUrl }
          })
          .eq('id', snapshotId);
        
        if (updateError) {
          console.error('[CanvasHistory] Fallback update also failed:', updateError);
          return;
        }
      }

      // Cache the thumbnail URL
      const cacheKey = JSON.stringify(canvasState).substring(0, 200);
      this.thumbnailCache.set(cacheKey, storedThumbnailUrl);
      if (this.thumbnailCache.size > 50) {
        // Limit cache size
        const firstKey = this.thumbnailCache.keys().next().value;
        this.thumbnailCache.delete(firstKey);
      }

      console.log('[CanvasHistory] Thumbnail stored for snapshot:', snapshotId, 'URL type:', storedThumbnailUrl.startsWith('data:') ? 'data URL' : storedThumbnailUrl.startsWith('http') ? 'HTTP URL' : 'unknown');

      // Emit event for UI refresh
      await this.emit({
        eventType: 'snapshot_created',
        eventDescription: 'Thumbnail generated',
        snapshotId,
        eventData: { thumbnail: storedThumbnailUrl, isUpdate: true },
      });
    } catch (err) {
      console.error('[CanvasHistory] Thumbnail generation error:', err);
      throw err; // Re-throw to be handled by queue processor
    }
  }

  /**
   * Update snapshot thumbnail (helper method)
   */
  private async updateSnapshotThumbnail(snapshotId: string, thumbnailUrl: string) {
    const { error } = await supabase.rpc('update_canvas_snapshot_thumbnail', {
      p_snapshot_id: snapshotId,
      p_thumbnail_url: thumbnailUrl
    });

    if (error) {
      console.error('[CanvasHistory] Failed to update thumbnail:', error);
    } else {
      await this.emit({
        eventType: 'snapshot_created',
        eventDescription: 'Thumbnail generated',
        snapshotId,
        eventData: { thumbnail: thumbnailUrl, isUpdate: true },
      });
    }
  }

  /**
   * Get timeline of events for the current project
   */
  async getTimeline(limit: number = 100): Promise<TimelineItem[]> {
    if (!this.projectId) {
      console.warn('[CanvasHistory] Cannot get timeline: not initialized', {
        projectId: this.projectId
      });
      return [];
    }

    console.log('[CanvasHistory] Getting timeline for project:', this.projectId);

    try {
      // Get both events and snapshots, merge them chronologically
      const [eventsResult, snapshotsResult] = await Promise.all([
        supabase.rpc('get_canvas_timeline', {
          p_project_id: this.projectId,
          p_limit: limit,
        }),
        supabase
          .from('canvas_history_snapshots')
          .select('id, snapshot_type, description, created_at, voice_event_id, conversation_id')
          .eq('project_id', this.projectId)
          .order('created_at', { ascending: false })
          .limit(limit)
      ]);

      if (eventsResult.error) {
        console.error('[CanvasHistory] Events query error:', eventsResult.error);
        throw eventsResult.error;
      }
      if (snapshotsResult.error) {
        console.error('[CanvasHistory] Snapshots query error:', snapshotsResult.error);
        throw snapshotsResult.error;
      }

      console.log('[CanvasHistory] Timeline query results:', {
        eventsCount: eventsResult.data?.length || 0,
        snapshotsCount: snapshotsResult.data?.length || 0
      });

      const events = (eventsResult.data || []).map((item: any) => ({
        id: item.id,
        type: 'event' as const,
        eventType: item.event_type,
        description: item.description,
        voiceEventId: item.voice_event_id,
        conversationId: item.conversation_id,
        voiceTranscript: item.voice_transcript,
        snapshotId: item.snapshot_id,
        createdAt: new Date(item.created_at),
        hasSnapshot: item.has_snapshot,
      }));

      const snapshots = (snapshotsResult.data || []).map((item: any) => ({
        id: item.id,
        type: 'snapshot' as const,
        eventType: 'snapshot_created' as CanvasEventType,
        description: item.description || `Snapshot (${item.snapshot_type})`,
        snapshotId: item.id,
        createdAt: new Date(item.created_at),
        hasSnapshot: true,
        voiceEventId: item.voice_event_id,
        conversationId: item.conversation_id,
      }));

      // Merge and sort by creation date
      const merged = [...events, ...snapshots].sort((a, b) => 
        b.createdAt.getTime() - a.createdAt.getTime()
      ).slice(0, limit);

      return merged;
    } catch (error) {
      console.error('[CanvasHistory] Failed to get timeline:', error);
      return [];
    }
  }

  /**
   * Get a snapshot by ID
   */
  async getSnapshot(snapshotId: string): Promise<CanvasSnapshot | null> {
    try {
      const { data, error } = await supabase.rpc('get_canvas_snapshot', {
        p_snapshot_id: snapshotId,
      });

      if (error) throw error;
      if (!data || data.length === 0) return null;

      const snapshot = data[0];
      const canvasState = snapshot.canvas_state || {};
      
      return {
        id: snapshot.id,
        projectId: snapshot.project_id,
        snapshotType: snapshot.snapshot_type,
        description: snapshot.description,
        canvasState,
        voiceEventId: snapshot.voice_event_id,
        conversationId: snapshot.conversation_id,
        voiceContext: snapshot.voice_context,
        createdAt: new Date(snapshot.created_at),
      };
    } catch (error) {
      console.error('[CanvasHistory] Failed to get snapshot:', error);
      return null;
    }
  }

  /**
   * Map new immersive event types to existing database-compatible types
   * This allows us to use new event types in code while maintaining DB compatibility
   */
  private mapEventTypeForDatabase(eventType: CanvasEventType): string {
    // Map immersive scene events to existing event types until DB is updated
    const immersiveEventMap: Record<string, string> = {
      'immersive_object_add': 'panel_create',
      'immersive_object_update': 'panel_update', 
      'immersive_object_delete': 'panel_delete',
      'immersive_scene_clear': 'panel_delete',
      'immersive_environment_change': 'view_mode_change',
      'immersive_execute': 'voice_task_complete',
    };
    return immersiveEventMap[eventType] || eventType;
  }

  /**
   * Process the event queue (save events to database)
   */
  private async processQueue() {
    if (this.isProcessingQueue || this.eventQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      const eventsToSave = [...this.eventQueue];
      this.eventQueue = [];

      // Use RPC to save events individually (or we could make a batch RPC, but this is fine for now)
      // Using Promise.all for parallel insertion
      await Promise.all(eventsToSave.map(async (e) => {
        try {
          // Map immersive event types to DB-compatible types
          const dbEventType = this.mapEventTypeForDatabase(e.eventType);
          
          // Store original event type in event_data for reference
          const eventData = {
            ...e.eventData,
            originalEventType: e.eventType !== dbEventType ? e.eventType : undefined,
          };
          
          const { error } = await supabase.rpc('save_canvas_event', {
            p_project_id: e.projectId,
            p_event_type: dbEventType,
            p_user_id: e.userId || null,
            p_wallet_address: e.walletAddress || null,
            p_event_description: e.eventDescription,
            p_voice_event_id: e.voiceEventId || null,
            p_conversation_id: e.conversationId || null,
            p_voice_transcript: e.voiceTranscript || null,
            p_event_data: eventData,
            p_snapshot_id: e.snapshotId || null
          });
          
          if (error) {
            console.warn('[CanvasHistory] Failed to save event:', e.eventType, error.message);
          }
        } catch (err) {
          // Don't throw - continue saving other events
          console.warn('[CanvasHistory] Error saving event:', e.eventType, err);
        }
      }));

      console.log(`[CanvasHistory] Saved ${eventsToSave.length} events`);
    } catch (error) {
      console.error('[CanvasHistory] Failed to save events:', error);
      // Don't re-queue failed events - they'll cause infinite loops
      // Just log and move on
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Notify all listeners of an event
   */
  private notifyListeners(event: CanvasEvent) {
    // Notify specific listeners
    this.listeners.get(event.eventType)?.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('[CanvasHistory] Listener error:', error);
      }
    });

    // Notify 'all' listeners
    this.listeners.get('all')?.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('[CanvasHistory] Listener error:', error);
      }
    });
  }

  /**
   * Clear all listeners and reset state
   */
  reset() {
    this.listeners.clear();
    this.eventQueue = [];
    this.projectId = null;
    this.userId = null;
    this.walletAddress = null;
    this.lastSnapshotTime = 0;
    this.thumbnailQueue = [];
    this.thumbnailCache.clear();
    this.isProcessingThumbnails = false;
  }
}

// Singleton instance
export const canvasHistoryBus = new CanvasHistoryBus();

/**
 * Capture a screenshot from the PlayCanvas canvas
 * Returns a data URL or null if capture fails
 */
export async function capturePlayCanvasScreenshot(): Promise<string | null> {
  try {
    // Find the PlayCanvas canvas (it has specific classes from WorldImmersiveCanvas)
    const canvas = document.querySelector('canvas.block.w-full.h-full') as HTMLCanvasElement;
    if (!canvas) {
      console.warn('[CanvasHistory] PlayCanvas canvas not found');
      return null;
    }

    // Capture at a reasonable size for thumbnails
    const maxWidth = 400;
    const maxHeight = 300;
    
    // Create a temporary canvas for resizing
    const tempCanvas = document.createElement('canvas');
    const aspectRatio = canvas.width / canvas.height;
    
    if (aspectRatio > maxWidth / maxHeight) {
      tempCanvas.width = maxWidth;
      tempCanvas.height = maxWidth / aspectRatio;
    } else {
      tempCanvas.height = maxHeight;
      tempCanvas.width = maxHeight * aspectRatio;
    }
    
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return null;
    
    ctx.drawImage(canvas, 0, 0, tempCanvas.width, tempCanvas.height);
    
    return tempCanvas.toDataURL('image/jpeg', 0.85);
  } catch (error) {
    console.error('[CanvasHistory] Failed to capture PlayCanvas screenshot:', error);
    return null;
  }
}

/**
 * Create a snapshot of the immersive scene state
 * Call this after significant changes to the scene
 */
export async function createImmersiveSceneSnapshot(
  description: string,
  eventType: CanvasEventType = 'immersive_execute'
): Promise<string | null> {
  // Dynamically import to avoid circular dependencies
  const { useImmersiveSceneStore } = await import('../store/immersiveSceneStore');
  const { useComicStore } = await import('../store/useComicStore');
  
  const immersiveState = useImmersiveSceneStore.getState();
  const comicState = useComicStore.getState();
  
  // Only capture if in world mode
  if (!comicState.isWorldMode) {
    console.log('[CanvasHistory] Not in world mode, skipping immersive snapshot');
    return null;
  }
  
  // Capture screenshot from PlayCanvas
  const screenshotUrl = await capturePlayCanvasScreenshot();
  
  // Build immersive scene state
  const immersiveSceneState: ImmersiveSceneSnapshotState = {
    objects: immersiveState.objects.map(obj => ({
      id: obj.id,
      type: obj.type,
      primitiveType: obj.primitiveType,
      modelUrl: obj.modelUrl,
      modelPrompt: obj.modelPrompt,
      lightType: obj.lightType,
      effectType: obj.effectType,
      position: { ...obj.position },
      rotation: { ...obj.rotation },
      scale: { ...obj.scale },
      color: obj.color,
      emissive: obj.emissive,
      emissiveIntensity: obj.emissiveIntensity,
      metalness: obj.metalness,
      roughness: obj.roughness,
      opacity: obj.opacity,
      intensity: obj.intensity,
      range: obj.range,
      animation: obj.animation,
      name: obj.name,
      createdAt: obj.createdAt,
      createdBy: obj.createdBy,
    })),
    environment: {
      skyType: immersiveState.environment.skyType,
      skyColor: immersiveState.environment.skyColor,
      fogEnabled: immersiveState.environment.fogEnabled,
      fogColor: immersiveState.environment.fogColor,
      fogDensity: immersiveState.environment.fogDensity,
      ambientColor: immersiveState.environment.ambientColor,
      ambientIntensity: immersiveState.environment.ambientIntensity,
      timeOfDay: immersiveState.environment.timeOfDay,
    },
    camera: {
      position: { ...immersiveState.camera.position },
      rotation: { ...immersiveState.camera.rotation },
      fov: immersiveState.camera.fov,
    },
    screenshotUrl,
  };
  
  // Build complete canvas state (including comic state for context)
  const canvasState = {
    isWorldMode: true,
    immersiveScene: immersiveSceneState,
    comic: comicState.currentComic ? {
      id: comicState.currentComic.id,
      title: comicState.currentComic.title,
      pages: comicState.currentComic.pages,
    } : undefined,
    currentPageIndex: comicState.currentPageIndex,
  };
  
  // Emit the event
  await canvasHistoryBus.emit({
    eventType,
    eventDescription: description,
    eventData: {
      objectCount: immersiveState.objects.length,
      hasScreenshot: !!screenshotUrl,
    },
  });
  
  // Create the snapshot
  const snapshotId = await canvasHistoryBus.createSnapshot(
    canvasState,
    'immersive_scene',
    description
  );
  
  console.log('[CanvasHistory] Immersive scene snapshot created:', snapshotId, {
    objectCount: immersiveState.objects.length,
    hasScreenshot: !!screenshotUrl,
  });
  
  return snapshotId;
}

/**
 * Helper to get the canvas history bus instance
 */
export function getCanvasHistoryBus() {
  return canvasHistoryBus;
}

