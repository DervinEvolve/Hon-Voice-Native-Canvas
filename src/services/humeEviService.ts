import { SCENE_CODE_EXECUTION_ENABLED, SCENE_CODE_EXECUTION_DISABLED_MESSAGE } from '../config/sceneCodeExecution';
import { Hume, HumeClient, convertBlobToBase64 } from 'hume';
import { Panel, Template, Comic } from '../types';
import type { HonPresence } from '../types/index';
import { useComicStore, State } from '../store/useComicStore';
import { fal } from '@fal-ai/client'; // Keep if needed for other things, but captioning uses backend
import { Buffer } from 'buffer'; // Keep if needed for other things
import { fluxDevService } from './fluxDevService';
import { nanoBananaService } from './nanoBananaService';
import { nanoBananaEditService } from './nanoBananaEditService';
import { fluxKreaService, StreamProgressEvent } from './fluxKreaService';
import { nanoid } from 'nanoid';
import { memoryService } from './memoryService';
import { honEviSessionService } from './honEviSessionService';
import { canvasHistoryBus } from '../utils/canvasHistory';
import { getSelectedPanelId, getAllSelectedPanelIds } from '../utils/panelSelection';
import { formatPageReference } from '../utils/pageIndexing';
import { HonSessionStatus, HonProcessingState } from '../types/hume';
import { geocodeQuery } from '../lib/googleMaps3d';
import { DEFAULT_MAP_HEADING, DEFAULT_MAP_TILT, estimateMapRange, formatGeocodeError, pickMapAltitude } from '../lib/worldMapUtils';
import { moodboardState } from '../utils/moodboardState';
import { MAP_MODEL_PLACEMENT_AVAILABLE, PLACE_MODEL_ON_MAP_NOT_AVAILABLE, WORLD_SCENE_NOT_AVAILABLE } from '../config/unavailableFeatures';

export type { HonSessionStatus, HonProcessingState };

// Removed ScreenState interface as we rely on getCanvasState tool now

// Create a service class for Hume EVI integration
export class HumeEviService {
  private humeClient: HumeClient | null = null; // Can potentially be removed if only using connect
  private evi: Hume.empathicVoice.chat.ChatSocket | null = null;
  private isActive: boolean = false;
  private statusChangeCallbacks: ((status: HonSessionStatus) => void)[] = [];
  private visualIndicatorCallbacks: ((isActive: boolean, processingState: HonProcessingState) => void)[] = [];
  private currentStatus: HonSessionStatus = 'idle';
  private processingState: HonProcessingState = 'idle';
  // Presence stream for UI tooltips (non-intrusive)
  private presenceChangeCallbacks: ((presence: HonPresence) => void)[] = [];
  private currentPresence: HonPresence = {
    isActive: false,
    processingState: 'idle',
    progressPercent: undefined,
    progressLabel: undefined,
    focusPanelId: null,
    etaSeconds: null,
    offscreen: false,
  };
  private activeToolCalls: Set<string> = new Set(); // Track active tool calls
  private toolCallMetadata: Map<string, { toolName: string; startedAt: number; conversationId?: string }> = new Map(); // Track tool call metadata
  // De-duplication guards for long-running operations
  private inFlightOpKeys: Set<string> = new Set();
  private seedanceRequestToOpKey: Map<string, string> = new Map();
  private seedanceRequestToTargetId: Map<string, string> = new Map();
  private completedSeedanceRequestIds: Set<string> = new Set();
  private completedTextTo3DRequestIds: Set<string> = new Set();
  // Guard to prevent duplicate place_3d_model_on_map calls while one is in progress
  private place3DModelInProgress: boolean = false;
  // Ensure only one Runway Aleph edit runs at a time per session
  private alephTaskActive: boolean = false;
  private alephCurrentTaskId: string | null = null;
  // Track immersive scene building session (keeps indicator in editing state during multi-step builds)
  private sceneBuildingActive: boolean = false;
  private sceneBuildingToolCount: number = 0;
  private sceneBuildingTimeout: ReturnType<typeof setTimeout> | null = null;
  // Prevent overlapping parallel builds - Hon should wait for current build to complete
  private parallelBuildInProgress: boolean = false;
  private parallelBuildStartTime: number = 0;
  // Track current Notion page for appending (when Hon forgets to pass page_context)
  private currentNotionPageId: string | null = null;
  // Guard to prevent duplicate generate_3d_splat calls
  private splatGenerationInProgress: boolean = false;
  // Keepalive + reconnect management
  private keepaliveTimerId: number | null = null;
  private isReconnecting: boolean = false;
  // If user explicitly ends the call, suppress any auto-reconnect logic
  private endedByUser: boolean = false;
  // Isaac background watcher timer
  private isaacScanTimerId: number | null = null;
  // Isaac watcher subscription (event-driven)
  private isaacUnsubscribe: (() => void) | null = null;
  // Track last processed media per panel to prevent re-analysis
  private isaacLastSeenByPanelId: Map<string, string> = new Map();
  // Prevent concurrent duplicate Isaac runs per panel
  private isaacInFlight: Set<string> = new Set();
  // Canvas-state timing (used to verify good tool order)
  private lastCanvasStateCall: number = 0;
  private canvasStateCallThreshold: number = 20000; // 20s window
  
  // Continuous audio system for zero-click playback (optimized like landing page)
  private audioQueue: ArrayBuffer[] = [];
  private isPlayingAudio: boolean = false;
  private audioContext: AudioContext | null = null;
  private mainGainNode: GainNode | null = null;
  private currentSource: AudioBufferSourceNode | null = null;

  // Microphone input state
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private isCapturingAudio: boolean = false;
  private isMuted: boolean = false; // Added mute state
  // Track external tasks (started from UI, not via Hume tool calls)
  private externalTaskCount: number = 0;

  // Session management for conversation continuity across disconnects
  private currentSessionId: string | null = null;
  private currentChatGroupId: string | null = null;
  private currentChatId: string | null = null;
  private shouldResumeSession: boolean = false;
  private lastDisconnectTime: number = 0;
  private readonly RECONNECT_COOLDOWN_MS = 2000; // 2 second cooldown

  // Caption caching to avoid redundant API calls
  private captionCache = new Map<string, {caption: string, timestamp: number}>();
  private readonly CAPTION_CACHE_TTL = 60 * 1000; // 1 minute - keep short to ensure fresh context

  // Smart context trimming based on call frequency
  private lastCanvasStateCallTime: number = 0;
  private readonly FREQUENT_CALL_THRESHOLD = 3000; // 3 seconds

  constructor() {
    // No need to initialize client here with API key anymore
    console.log('HumeEviService instance created.');
    
    // Listen for scene build completion from WorldImmersiveCanvas
    // This allows the Hon indicator to stay in "editing" state until scene is fully built
    this.setupSceneBuildListener();
  }
  
  private sceneBuildListener: ((e: Event) => void) | null = null;
  private buildErrorListener: ((e: Event) => void) | null = null;

  private setupSceneBuildListener() {
    // Remove existing listeners if any (prevent duplicates)
    this.cleanupSceneBuildListener();

    // Success listener
    this.sceneBuildListener = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      console.log('[HumeEvi] Scene build complete signal received:', detail);

      // Complete the external task - this moves indicator from "editing" to "idle"
      this.completeExternalTask();
      this.endSceneBuildingSession();
    };

    // Error listener - handles build failures
    this.buildErrorListener = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (detail.phase === 'error') {
        console.error('[HumeEvi] Build error received:', detail.message);

        // Complete the external task to reset indicator
        this.completeExternalTask();
        this.endSceneBuildingSession();
      }
    };

    window.addEventListener('hon:scene-build-complete', this.sceneBuildListener);
    window.addEventListener('hon-build-progress', this.buildErrorListener);
    console.log('[HumeEvi] Scene build listeners registered (complete + error)');
  }

  private cleanupSceneBuildListener() {
    if (this.sceneBuildListener) {
      window.removeEventListener('hon:scene-build-complete', this.sceneBuildListener);
      this.sceneBuildListener = null;
    }
    if (this.buildErrorListener) {
      window.removeEventListener('hon-build-progress', this.buildErrorListener);
      this.buildErrorListener = null;
    }
    console.log('[HumeEvi] Scene build listeners removed');
  }

  /**
   * Cleanup all event listeners and resources.
   * Should be called when the service is no longer needed.
   */
  public cleanup() {
    this.cleanupSceneBuildListener();
    console.log('[HumeEvi] Service cleanup complete');
  }

  public lastMoodboardPrompt: string | null = null;
  
  // Moodboard cooldown to prevent endless generation loops
  private lastMoodboardTimestamp: number = 0;
  private readonly MOODBOARD_COOLDOWN_MS = 60000; // 60 second cooldown between moodboards

  // Public UI entrypoint: create mood board like Runway quick action
  public async createMoodBoardFromUI(params: { reference_image_url: string; count?: number; include_videos?: boolean; aspect_ratio?: string; style_prompt?: string; target_element_id?: string }) {
    try {
      const toolId = `ui_${nanoid()}`;
      // Add flag to indicate this is a UI-triggered action (not Hon)
      await this.handleCreateMoodBoard(toolId, { ...params, _uiTriggered: true } as any);
    } catch (e) {
      console.warn('createMoodBoardFromUI failed', e);
    }
  }

  // Subscribe to status changes
  public onStatusChange(callback: (status: HonSessionStatus) => void) {
    this.statusChangeCallbacks.push(callback);
    callback(this.currentStatus); // Initial call with current status
    return () => {
      this.statusChangeCallbacks = this.statusChangeCallbacks.filter(cb => cb !== callback);
    };
  }

  // Subscribe to visual indicator changes
  public onVisualIndicatorChange(callback: (isActive: boolean, processingState: HonProcessingState) => void) {
    this.visualIndicatorCallbacks.push(callback);
    callback(this.isActive, this.processingState); // Initial call with current status
    return () => {
      this.visualIndicatorCallbacks = this.visualIndicatorCallbacks.filter(cb => cb !== callback);
    };
  }

  // Update status and notify listeners
  private updateStatus(status: HonSessionStatus) {
    this.currentStatus = status;
    this.statusChangeCallbacks.forEach(callback => {
      try {
        callback(status);
      } catch (error) {
        console.error('Error in status change callback:', error);
      }
    });
  }

  // Update visual indicator and notify listeners with processing state
  private updateVisualIndicator(isActive: boolean, processingState: HonProcessingState = 'idle') {
    this.isActive = isActive;
    this.processingState = processingState;
    this.visualIndicatorCallbacks.forEach(callback => {
      try {
        callback(isActive, processingState);
      } catch (error) {
        console.error('Error in visual indicator callback:', error);
      }
    });
    // Mirror to presence stream (do not modify indicator behavior)
    this.updatePresence({ isActive, processingState });
  }

  // Public helpers to allow UI-triggered actions (e.g., SFX button) to reflect on the indicator
  public beginExternalTask(processingState: HonProcessingState = 'editing') {
    try {
      this.externalTaskCount = Math.max(0, this.externalTaskCount + 1);
      this.updateVisualIndicator(true, processingState);
      // Ensure keepalive keeps the visual state asserted if socket is around
      this.startKeepalive();
    } catch (e) {
      console.warn('beginExternalTask error:', e);
    }
  }

  private speak(text: string) {
    try {
      // Route small info messages through UI overlay
      console.log('[Hon]', text);
      // Note: Hume EVI doesn't support sending arbitrary assistant messages
      // The assistant speaks in response to tool_response or user_input
      // This method is now just for logging - Hon will respond naturally via tool responses
    } catch {}
  }

  private endExternalTask() {
    this.completeExternalTask();
  }

  public completeExternalTask() {
    try {
      this.externalTaskCount = Math.max(0, this.externalTaskCount - 1);
      // If no Hume tools, no Aleph tasks, and no external tasks, go idle
      if (!this.alephTaskActive && this.activeToolCalls.size === 0 && this.externalTaskCount === 0) {
        this.updateVisualIndicator(true, 'idle');
        this.stopKeepalive();
      } else {
        // Otherwise, prefer processing state while other tasks exist
        this.updateVisualIndicator(true, 'processing');
      }
    } catch (e) {
      console.warn('completeExternalTask error:', e);
    }
  }

  /**
   * Preload an image URL and wait for it to fully load in the browser.
   * This ensures the image is visible before Hon responds.
   * @param url The image URL to preload
   * @param timeoutMs Maximum time to wait (default 5000ms)
   * @returns Promise that resolves when image is loaded or rejects on timeout/error
   */
  private preloadImage(url: string, timeoutMs: number = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const timeout = setTimeout(() => {
        console.warn(`[preloadImage] Timeout after ${timeoutMs}ms for: ${url.substring(0, 60)}...`);
        resolve(); // Resolve anyway to not block the response
      }, timeoutMs);

      img.onload = () => {
        clearTimeout(timeout);
        console.log(`[preloadImage] ✅ Image loaded: ${url.substring(0, 60)}...`);
        resolve();
      };

      img.onerror = (err) => {
        clearTimeout(timeout);
        console.warn(`[preloadImage] ⚠️ Image load error:`, err);
        resolve(); // Resolve anyway to not block the response
      };

      img.src = url;
    });
  }

  // Presence API
  public onPresenceChange(callback: (presence: HonPresence) => void) {
    this.presenceChangeCallbacks.push(callback);
    callback(this.currentPresence);
    return () => {
      this.presenceChangeCallbacks = this.presenceChangeCallbacks.filter(cb => cb !== callback);
    };
  }

  private updatePresence(partial: Partial<HonPresence>) {
    this.currentPresence = { ...this.currentPresence, ...partial };
    for (const cb of this.presenceChangeCallbacks) {
      try { cb(this.currentPresence); } catch (e) { console.warn('Presence callback error:', e); }
    }
  }

  // --- Notes tools ---
  private async handleTakeNotesTool(toolCallId: string, _params: any) {
    try {
      // Check if user has MCP connection for enhanced note-taking
      const hasMcpConnection = await this.checkNotionMcpConnection();

      if (hasMcpConnection) {
        // Use MCP for intelligent note-taking
        console.log('[take_notes] Using MCP for enhanced note-taking');

        // Get context from last moodboard or current activity
        const prompt = (this as any).lastMoodboardPrompt || '';
        const intent = prompt
          ? `Create a new notes page and add these ideas: ${prompt}`
          : 'Create a new notes page for taking notes';

        // Delegate to notion_action handler (it manages its own external task)
        await this.handleNotionAction(toolCallId, {
          intent,
          page_context: null,
          show_panel: true
        });

        return; // handleNotionAction handles everything including external task
      }

      // Fall back to existing local note-taking flow
      console.log('[take_notes] Using local note-taking (no MCP connection)');
      this.beginExternalTask('editing');
      
      // Always mute Hon during notes session to avoid cross-talk
      try { if (!this.isMuted) await this.toggleMute(); } catch {}
      
      // Check if already in board mode
      const isAlreadyInBoardMode = (window as any).__isInBoardMode;
      
      // Only switch to board mode if not already there
      if (!isAlreadyInBoardMode) {
        try { document.dispatchEvent(new CustomEvent('enter-board-mode')); } catch {}
      }
      
      // Ask UI to add a notion panel
      // Skip panning if already in board mode to prevent jarring canvas movement
      // Don't force re-auth - only do that if explicitly requested
      try {
        document.dispatchEvent(new CustomEvent('add-notion-panel', {
          detail: {
            forceAuth: false,
            skipPan: isAlreadyInBoardMode
          }
        }));
      } catch {}
      // Wait synchronously for Notion auth to complete or timeout before resuming dialog
      const connected = await new Promise<boolean>((resolve) => {
        let done = false;
        const finish = (ok: boolean) => { if (!done) { done = true; resolve(ok); cleanup(); } };
        const onOk = () => finish(true);
        const onTimeout = () => finish(false);
        const cleanup = () => {
          try { document.removeEventListener('notion-connected' as any, onOk as any); } catch {}
          try { document.removeEventListener('notion-connection-timeout' as any, onTimeout as any); } catch {}
        };
        try { document.addEventListener('notion-connected' as any, onOk as any); } catch {}
        try { document.addEventListener('notion-connection-timeout' as any, onTimeout as any); } catch {}
        // Also use a hard timeout as backup (90s)
        setTimeout(() => finish(false), 90_000);
      });

      const content = connected
        ? 'Connected to Notion. Summarizing moodboard into notes now.'
        : 'Opening Notion… complete the authorization. I will keep waiting until it finishes or times out.';
      this.evi?.socket?.send(JSON.stringify({ type: 'tool_response', tool_call_id: toolCallId, content }));
      this.completeToolCall(toolCallId);

      // If connected, trigger typing animation with latest prompt as fallback
      try {
        if (connected) {
          const bullets: string[] = [];
          const prompt = (this as any).lastMoodboardPrompt || '';
          if (prompt) bullets.push(`• ${prompt}`);
          document.dispatchEvent(new CustomEvent('notion-type-bullets', { detail: { panelId: null, pageId: null, bullets } }));
        }
      } catch {}
    } catch (e: any) {
      this.sendToolErrorResponse(toolCallId, e?.message || 'Failed to start notes');
    } finally {
      this.completeExternalTask();
      // Unmute Hon after notes session ends (success or failure)
      try { if (this.isMuted) await this.toggleMute(); } catch {}
    }
  }

  private async handleStopNotesTool(toolCallId: string) {
    try {
      // Dispatch an event the UI mic listener will treat as stop
      try { document.dispatchEvent(new CustomEvent('stop-notes')); } catch {}
      const content = 'Stopping notes mode.';
      this.evi?.socket?.send(JSON.stringify({ type: 'tool_response', tool_call_id: toolCallId, content }));
      this.completeToolCall(toolCallId);
    } catch (e) {
      this.sendToolErrorResponse(toolCallId, e?.message || 'Failed to stop notes');
    } finally {
      // Unmute Hon when notes are stopped
      try { if (this.isMuted) await this.toggleMute(); } catch {}
    }
  }

  /**
   * Add a single note/bullet to the Notion panel (streaming capability)
   *
   * REQUIRES HUME DASHBOARD CONFIGURATION:
   * Tool name: add_notion_note
   * Description: Add a single bullet point or note to the user's Notion panel. Use this to stream notes as you think - call multiple times to add multiple bullets. Great for summarizing discussions, capturing tasks, or noting key points.
   * Parameters:
   *   - note (string, required): The note or bullet point to add
   *   - type (string, optional, enum: ["bullet", "task", "heading"]): Type of note (default: bullet)
   *
   * Example usage:
   * - User: "Summarize what we discussed"
   * - Hon calls add_notion_note multiple times with each key point
   */
  private async handleAddNotionNote(toolCallId: string, params: any) {
    try {
      const p = typeof params === 'string' ? (() => { try { return JSON.parse(params); } catch { return {}; } })() : (params || {});
      const { note, type = 'bullet' } = p;

      if (!note || typeof note !== 'string') {
        this.sendToolErrorResponse(toolCallId, 'Note text is required');
        return;
      }

      console.log('[add_notion_note] Adding note:', { note: note.substring(0, 50), type });

      // Dispatch event to NotionPanel to display the note
      try {
        document.dispatchEvent(new CustomEvent('notion-stream-note', {
          detail: { note, type }
        }));
      } catch {}

      // Also save to Notion when a page is connected, and say whether it was saved.
      let savedToNotion = false;
      let notionStatus = 'No Notion page is connected, so the note is only in the notes panel.';
      try {
        const pageId = this.getCurrentNotionPageId();
        if (pageId) {
          const response = await fetch('/api/notion/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              pageId,
              blocks: [{ type: type === 'task' ? 'todo' : type === 'heading' ? 'heading' : 'paragraph', text: note }]
            })
          });
          savedToNotion = response.ok;
          notionStatus = response.ok
            ? 'Saved to the connected Notion page.'
            : `Not saved to Notion (HTTP ${response.status}); the note is only in the notes panel.`;
        }
      } catch (e) {
        console.warn('[add_notion_note] Failed to save to Notion:', e);
        notionStatus = 'Not saved to Notion (request failed); the note is only in the notes panel.';
      }

      this.sendToolSuccessResponse(toolCallId, JSON.stringify({ added: true, note, saved_to_notion: savedToNotion, notion_status: notionStatus }));
    } catch (e: any) {
      console.error('[add_notion_note] Error:', e);
      this.sendToolErrorResponse(toolCallId, e?.message || 'Failed to add note');
    }
  }

  /**
   * Get current Notion page ID from the active NotionPanel
   */
  private getCurrentNotionPageId(): string | null {
    try {
      const { currentComic, currentPageIndex } = useComicStore.getState() as any;
      const page = currentComic?.pages?.[currentPageIndex] || [];
      const notionPanel = page.find((p: any) => p.type === 'notion');
      return notionPanel?.url || null; // url stores the pageId
    } catch {
      return null;
    }
  }

  /**
   * Summarize the conversation and add notes to Notion via MCP
   *
   * REQUIRES HUME DASHBOARD CONFIGURATION - see JSON schema in docs
   * Hon passes conversation context which gets sent to MCP for structured notes
   */
  private async handleSummarizeToNotion(toolCallId: string, params: any) {
    try {
      const p = typeof params === 'string' ? (() => { try { return JSON.parse(params); } catch { return {}; } })() : (params || {});
      const { context, focus = 'all', page_title } = p;

      if (!context) {
        this.sendToolErrorResponse(toolCallId, 'Context is required - include what was discussed');
        return;
      }

      // Build intent that includes the conversation context
      const title = page_title || `Session Notes - ${new Date().toLocaleDateString()}`;
      const intent = `Create a notes page titled "${title}" and add these as organized bullets:\n\n${context}\n\nFocus: ${focus}. Use bullet points for ideas, to_do blocks for tasks.`;

      // Delegate to notion_action which handles MCP
      await this.handleNotionAction(toolCallId, {
        intent,
        page_context: null,
        show_panel: true
      });

    } catch (e: any) {
      console.error('[summarize_to_notion] Error:', e);
      this.sendToolErrorResponse(toolCallId, e?.message || 'Failed to summarize');
    }
  }

  // --- Notion MCP Tools ---
  
  /**
   * Check if user has Notion MCP connection
   * Uses a quick search request with timeout to verify connection
   */
  private async checkNotionMcpConnection(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const resp = await fetch('/api/notion/search?q=', {
        credentials: 'include',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (resp.status === 401) {
        console.log('[checkNotionMcpConnection] Not authenticated');
        return false;
      }

      return resp.ok;
    } catch (e: any) {
      if (e.name === 'AbortError') {
        console.log('[checkNotionMcpConnection] Connection check timed out');
      } else {
        console.log('[checkNotionMcpConnection] Connection check failed:', e.message);
      }
      return false;
    }
  }

  /**
   * Handle Notion actions via MCP Connector
   * 
   * REQUIRES HUME DASHBOARD CONFIGURATION:
   * Tool name: notion_action
   * Description: Perform actions in the user's Notion workspace - open, search, create pages, add content, update databases. Use when user mentions Notion, notes, documentation, or wants to save/organize information. Examples: "open my Notion", "add this to my Notion", "create a character sheet in Notion", "search my notes for dragons".
   * Parameters:
   *   - intent (string, required): What the user wants to do in Notion (e.g., "open", "search for X", "create page about Y", "add content")
   *   - page_context (string, optional): Current page ID if working on specific page
   *   - show_panel (boolean, optional, default true): Whether to show the Notion panel
   * 
   * Example user phrases:
   * - "Open my Notion" / "Show my notes" / "Pull up Notion"
   * - "Add this scene to my Notion"
   * - "Create a character sheet in Notion"
   * - "Search Notion for character ideas"
   * - "Create a story outline"
   * - "Update my project notes"
   * - "Save this to my notes"
   */
  private async handleNotionAction(toolCallId: string, params: any) {
    // Show editing indicator during Notion operations
    this.beginExternalTask('editing');

    try {
      const p = typeof params === 'string' ? (() => { try { return JSON.parse(params); } catch { return {}; } })() : (params || {});
      const { intent, page_context, show_panel = true } = p;

      if (!intent) {
        this.completeExternalTask();
        this.sendToolErrorResponse(toolCallId, 'Intent is required for Notion actions');
        return;
      }

      // Use tracked pageId as fallback if Hon didn't pass page_context
      const effectivePageContext = page_context || this.currentNotionPageId;
      console.log('[notion_action] Processing intent:', intent, 'page_context:', page_context, 'effective:', effectivePageContext, 'show_panel:', show_panel);
      
      // Check if this is just an "open" intent (no MCP action needed)
      const intentLower = intent.toLowerCase().trim();
      // Handle both space-separated and underscore-separated formats: "open notion" or "open_notion_panel"
      const isJustOpen = /^(open|show|pull[_\s]?up|view|see|display)([_\s]+(my[_\s]+)?(notion|notes|workspace|panel))*$/i.test(intentLower);
      
      // Check if already in board mode (scale > threshold)
      const isAlreadyInBoardMode = (window as any).__isInBoardMode;
      
      // Open panel if requested - but only enter board mode if not already in board mode
      if (show_panel) {
        // Only dispatch enter-board-mode if NOT already in board mode
        if (!isAlreadyInBoardMode) {
          console.log('[notion_action] Switching to board mode to show panel');
          try { 
            document.dispatchEvent(new CustomEvent('enter-board-mode')); 
          } catch {}
        }
        
        try {
          // Open panel with appropriate options:
          // - startFresh: true for "just open" intents (blank panel)
          // - skipPan: true if already in board mode
          document.dispatchEvent(new CustomEvent('add-notion-panel', {
            detail: {
              forceAuth: false,
              skipPan: isAlreadyInBoardMode,
              startFresh: isJustOpen // Clear old page when just opening
            }
          }));
        } catch {}
      }
      
      // If just opening, we're done - no MCP call needed
      if (isJustOpen) {
        // Clear tracked pageId so we start fresh
        this.currentNotionPageId = null;
        this.completeExternalTask();
        this.sendToolSuccessResponse(toolCallId, JSON.stringify({
          opened: true,
          action: 'open_panel'
        }));
        this.speak("Here's your Notion. What would you like to do?");
        return;
      }
      
      this.speak("Working on that in Notion...");
      
      // Notify panel to start real-time updates
      try {
        document.dispatchEvent(new CustomEvent('notion-mcp-action-start'));
      } catch {}
      
      // Call the MCP action endpoint
      const response = await fetch('/api/notion/mcp-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          intent, 
          context: { 
            pageId: effectivePageContext,
            // Include any relevant scene context
            currentMode: (window as any).__isWorldMode ? 'immersive' : 'board'
          } 
        })
      });
      
      const result = await response.json();
      
      // Check response before dispatching completion
      if (!response.ok) {
        // Check if auth needed
        if (result.needsAuth) {
          this.completeExternalTask();
          this.speak("You'll need to connect your Notion account first. I've opened the authorization screen.");
          try {
            // Don't force logout - just show auth screen. Cookies might be expired but 
            // we don't want to race with other requests or clear valid session data
            document.dispatchEvent(new CustomEvent('add-notion-panel', {
              detail: { forceAuth: false }
            }));
            document.dispatchEvent(new CustomEvent('notion-mcp-action-complete', {
              detail: { error: true, needsAuth: true }
            }));
          } catch {}
          this.sendToolErrorResponse(toolCallId, 'Notion authorization required');
          return;
        }
        
        // Dispatch error completion
        try {
          document.dispatchEvent(new CustomEvent('notion-mcp-action-complete', {
            detail: { error: true, message: result.error }
          }));
        } catch {}
        
        throw new Error(result.error || 'Failed to execute Notion action');
      }
      
      // Success! Notify panel with the result (including pageId if created)
      // Track the pageId so we can use it for subsequent append operations
      if (result.pageId) {
        this.currentNotionPageId = result.pageId;
        console.log('[notion_action] Tracking current pageId:', result.pageId);
      }
      
      try {
        document.dispatchEvent(new CustomEvent('notion-mcp-action-complete', {
          detail: {
            success: true,
            actions: result.actions,
            pageId: result.pageId,
            summary: result.summary
          }
        }));
      } catch {}

      this.completeExternalTask();
      this.sendToolSuccessResponse(toolCallId, JSON.stringify(result));

      // Wait for blocks to render in the panel before saying "done"
      // Use a promise that resolves when blocks are rendered or times out after 3s
      const waitForRender = new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          document.removeEventListener('notion-blocks-rendered', handler);
          resolve();
        }, 3000);

        const handler = () => {
          clearTimeout(timeout);
          document.removeEventListener('notion-blocks-rendered', handler);
          resolve();
        };

        document.addEventListener('notion-blocks-rendered', handler, { once: true });
      });

      await waitForRender;
      // Removed explicit "Done" - let the visual result speak for itself

    } catch (e: any) {
      console.error('[notion_action] Error:', e);

      // Notify panel to stop polling
      try {
        document.dispatchEvent(new CustomEvent('notion-mcp-action-complete', {
          detail: { error: true }
        }));
      } catch {}

      this.completeExternalTask();
      this.sendToolErrorResponse(toolCallId, e?.message || 'Failed to complete Notion action');
      this.speak("I couldn't complete that Notion action. Please try again.");
    }
  }

  /**
   * Handle panel arrangement tool (grid, timeline, storyboard, cluster, similar)
   * 
   * REQUIRES HUME DASHBOARD CONFIGURATION:
   * Tool name: arrange_panels
   * Description: Arranges panels in board mode into different layout patterns. Can group similar panels together.
   * Parameters:
   *   - layout_type (string, enum: ["grid", "timeline", "storyboard", "cluster", "similar-grid", "similar-cluster"], required)
   *   - group_by_similarity (boolean, optional): If true, groups similar panels together before applying layout
   * 
   * Example user phrases:
   * - "organize panels into a cluster"
   * - "position panels in a timeline"
   * - "arrange panels in grid"
   * - "organize similar panels together"
   * - "group similar panels in a grid"
   * - "separate similar content"
   */
  private async handleArrangePanelsTool(toolCallId: string, parameters: any) {
    try {
      // Parse parameters if it's a string (Hume sends it as JSON string)
      const p = typeof parameters === 'string' ? (() => { try { return JSON.parse(parameters); } catch { return {}; } })() : (parameters || {});
      const layoutType = p?.layout_type || p?.layoutType || '';
      const groupBySimilarity = p?.group_by_similarity || false;
      const normalizedType = layoutType.toLowerCase().trim();
      
      console.log('[arrange_panels] Received layout request:', normalizedType, 'group_by_similarity:', groupBySimilarity, 'from params:', p);
      
      // Check if this is a similarity-based arrangement (check for 'similar-' prefix first)
      const isSimilarityLayout = normalizedType.startsWith('similar-') || groupBySimilarity;
      
      // Map voice commands to layout types
      let eventName = '';
      let baseLayoutType = '';
      
      // Remove 'similar-' prefix if present to get base layout type
      const baseType = normalizedType.replace(/^similar-/, '');
      
      if (baseType === 'grid' || (normalizedType === 'grid' && !isSimilarityLayout)) {
        eventName = isSimilarityLayout ? 'board-arrange-similar-grid' : 'board-arrange-grid';
        baseLayoutType = 'grid';
      } else if (baseType === 'timeline' || (normalizedType === 'timeline' && !isSimilarityLayout)) {
        eventName = isSimilarityLayout ? 'board-arrange-similar-timeline' : 'board-arrange-timeline';
        baseLayoutType = 'timeline';
      } else if (baseType === 'storyboard' || (normalizedType === 'storyboard' && !isSimilarityLayout)) {
        eventName = isSimilarityLayout ? 'board-arrange-similar-storyboard' : 'board-arrange-storyboard';
        baseLayoutType = 'storyboard';
      } else if (baseType === 'cluster' || (normalizedType === 'cluster' && !isSimilarityLayout)) {
        eventName = isSimilarityLayout ? 'board-arrange-similar-cluster' : 'board-arrange-cluster';
        baseLayoutType = 'cluster';
      } else if (normalizedType === 'similar' || (normalizedType.includes('similar') && !normalizedType.includes('-'))) {
        // Default to grid if just "similar" is specified
        eventName = 'board-arrange-similar-grid';
        baseLayoutType = 'grid';
      } else {
        throw new Error(`Unknown layout type: ${layoutType}. Supported types: grid, timeline, storyboard, cluster, similar-grid, similar-cluster, similar-timeline, similar-storyboard`);
      }
      
      // Dispatch the event to trigger the layout arrangement
      if (typeof document !== 'undefined' && eventName) {
        document.dispatchEvent(new CustomEvent(eventName, { 
          detail: { baseLayoutType, groupBySimilarity: isSimilarityLayout } 
        }));
        console.log(`[arrange_panels] Dispatched event: ${eventName}`);
      }
      
      // Respond to tool call
      const content = JSON.stringify({ 
        success: true, 
        action: 'arrange_panels', 
        layout_type: normalizedType,
        group_by_similarity: isSimilarityLayout
      });
      this.evi?.socket?.send(JSON.stringify({ 
        type: 'tool_response', 
        tool_call_id: toolCallId, 
        content 
      }));
      this.completeToolCall(toolCallId);
    } catch (e: any) {
      console.error('[arrange_panels] Error:', e);
      this.sendToolErrorResponse(toolCallId, e?.message || 'Failed to arrange panels');
    }
  }

  // Kick off enhanced vision analysis (SAM3 + Isaac) for a given panel image (always-on context pass)
  private async ensureIsaacContextForPanel(panel: Panel) {
    // Isaac is Hon's eyes - must never fail silently
    const maxRetries = 3;
    let attempt = 0;
    let success = false;
    
    while (attempt < maxRetries && !success) {
      try {
        if (!panel?.url || !panel?.id) return;

        // Only run Isaac vision on image-like panels. We still track other media changes elsewhere.
        if (panel.type !== 'image' && panel.type !== 'gif') return;

        // Deduplicate by (panelId + url). Re-run only if content changes.
        const seenKey = `${panel.id}:${panel.url}`;
        const lastSeen = this.isaacLastSeenByPanelId.get(panel.id);
        if (lastSeen === seenKey) return;

        // Prevent rapid-fire duplicates while one is running
        if (this.isaacInFlight.has(panel.id)) return;
        this.isaacInFlight.add(panel.id);
        
        attempt++;
        console.log(`[Isaac] 👁️ Starting vision analysis for panel ${panel.id} (attempt ${attempt}/${maxRetries})...`);
        
        // Use enhanced vision service that combines SAM3 + Isaac for better awareness
        const { analyzeWithEnhancedVision } = await import('./enhancedVisionService');
        
        await analyzeWithEnhancedVision(panel.url, { 
          prompt: 'Describe salient objects, their relationships, and spatial layout. Be precise about what is visible.',
          response_style: 'text',
          useSAM3: true, // Include SAM3 object detection
          useIsaac: true // Include Isaac semantic understanding
        }, (partial) => {
          if (partial?.output) {
            console.log(`[Isaac] 📤 Sending vision analysis to Hon for panel ${panel.id}: "${partial.output.substring(0, 200)}${partial.output.length > 200 ? '...' : ''}"`);
          }
          
          console.log('[AI] enhanced-vision:partial', { 
            panelId: panel.id, 
            hasOutput: !!partial?.output,
            detectedObjects: partial?.detectedObjects?.length || 0,
            style: partial?.response_style 
          });
          
          // NOTE: Removed chat_metadata send - Hume doesn't support custom message types
          // Vision partials are logged locally but not sent to Hume
          
          // Stream overlays to UI in real-time if available
          try {
            const state = useComicStore.getState() as State & { setVisionOverlay?: any };
            if (typeof state.setVisionOverlay === 'function') {
              state.setVisionOverlay(panel.id, {
                responseStyle: (partial?.response_style || 'text') as any,
                boxes: partial?.boxes,
                points: partial?.points,
                polygons: partial?.polygons,
                detectedObjects: partial?.detectedObjects || []
              });
            }
          } catch (err) {
            console.warn('[Isaac] Failed to update vision overlay:', err);
          }
        });
        
        success = true;
        // Mark as processed for this exact content
        this.isaacLastSeenByPanelId.set(panel.id, seenKey);
        console.log(`[Isaac] ✅ Vision analysis completed for panel ${panel.id}`);
      } catch (e: any) {
        console.error(`[Isaac] ❌ Attempt ${attempt} failed:`, e?.message || e);
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff
          console.log(`[Isaac] ⏳ Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error(`[Isaac] ❌ All ${maxRetries} attempts failed for panel ${panel.id}. Hon will work without Isaac analysis.`);
          // Don't break - Hon can still work, just log the failure
        }
      } finally {
        this.isaacInFlight.delete(panel.id);
      }
    }
  }

  // Watch for new/changed panel media and run Isaac only once per new content.
  private startIsaacWatcher() {
    if (this.isaacUnsubscribe) return;

    const scan = async (panels: Array<Panel & { _isaacThumbUrl?: string }>) => {
      for (const panel of panels) {
        if (!panel?.id || !panel?.url) continue;
        // For 3D panels, prefer thumbnail URL for Isaac captioning.
        const isaacThumbUrl =
          (panel as any)?._isaacThumbUrl ||
          (panel as any)?.metadata?.thumbnail ||
          (panel as any)?.metadata?.poster ||
          (panel as any)?.metadata?.preview ||
          (panel as any)?.thumbnailUrl ||
          '';
        const contentUrl = panel.type === '3d' && typeof isaacThumbUrl === 'string' && isaacThumbUrl.startsWith('http')
          ? isaacThumbUrl
          : panel.url;

        // Trigger only when content is newly added/changed on a panel (by the URL we will analyze/track).
        const seenKey = `${panel.id}:${contentUrl}`;
        const lastSeen = this.isaacLastSeenByPanelId.get(panel.id);
        if (lastSeen === seenKey) continue;

        // For images/gifs, run Isaac on the actual image URL.
        if (panel.type === 'image' || panel.type === 'gif') {
          try { await this.ensureIsaacContextForPanel(panel); } catch {}
          continue;
        }

        // For 3D: run Isaac on thumbnail if we have one; otherwise just mark as seen.
        if (panel.type === '3d') {
          if (typeof contentUrl === 'string' && contentUrl.startsWith('http')) {
            try {
              await this.ensureIsaacContextForPanel({ ...(panel as any), type: 'image', url: contentUrl } as any);
            } catch {}
          } else {
            this.isaacLastSeenByPanelId.set(panel.id, seenKey);
          }
          continue;
        }

        // For video: do not run Isaac (video understanding model handles it). Just mark as seen.
        if (panel.type === 'video') {
          this.isaacLastSeenByPanelId.set(panel.id, seenKey);
        }
      }
    };

    // Initial one-time pass (not periodic)
    try {
      const state = useComicStore.getState() as State;
      const pagePanels = state.currentComic?.pages?.[state.currentPageIndex] || [];
      void scan(pagePanels as any);
    } catch {}

    // Subscribe to panel content changes (event-driven)
    this.isaacUnsubscribe = (useComicStore as any).subscribe(
      (s: any) => {
        const currentPageIndex = s.currentPageIndex || 0;
        const panels = s.currentComic?.pages?.[currentPageIndex] || [];
        return panels.map((p: any) => ({
          id: p?.id,
          type: p?.type,
          url: p?.url,
          // capture thumbnail changes too so 3D Isaac triggers once when thumbnail appears/changes
          _isaacThumbUrl: p?.metadata?.thumbnail || p?.metadata?.poster || p?.metadata?.preview || p?.thumbnailUrl
        }));
      },
      (next: Array<{ id: string; type: string; url: string }>) => {
        try {
          const panels = next
            .filter(p => p?.id && p?.url)
            .map(p => ({ id: p.id, type: (p as any).type as any, url: p.url, _isaacThumbUrl: (p as any)._isaacThumbUrl } as any));
          // Fire and forget; internal dedupe prevents spam
          void scan(panels as any);
        } catch {}
      },
      { fireImmediately: false }
    );
  }

  private stopIsaacWatcher() {
    if (this.isaacScanTimerId !== null) {
      window.clearInterval(this.isaacScanTimerId);
      this.isaacScanTimerId = null;
    }
    if (this.isaacUnsubscribe) {
      try { this.isaacUnsubscribe(); } catch {}
      this.isaacUnsubscribe = null;
    }
  }

  // Simple getter so UI code can detect if a collaboration session is active
  public isSessionActive(): boolean {
    return !!this.isActive;
  }

  // Heartbeat keepalive: periodically send a minimal message to keep socket alive during long-running tools
  private startKeepalive(): void {
    if (this.keepaliveTimerId !== null) return;
    // Send immediately, then every 25s
    this.sendKeepalive();
    this.keepaliveTimerId = window.setInterval(() => {
      this.sendKeepalive();
    }, 25000);
    console.log('Keepalive started');
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimerId !== null) {
      window.clearInterval(this.keepaliveTimerId);
      this.keepaliveTimerId = null;
      console.log('Keepalive stopped');
    }
  }

  private sendKeepalive(): void {
    try {
      // Do nothing if user ended the session
      if (this.endedByUser) {
        return;
      }
      // If no socket but tasks are active, attempt reconnect
      if (!this.evi || !this.evi.socket) {
        if (this.alephTaskActive || this.activeToolCalls.size > 0) {
          console.log('Keepalive: socket missing while tasks active – attempting reconnect');
          this.attemptReconnect();
        }
        return;
      }
      // NOTE: Hume doesn't support custom message types like 'chat_metadata'.
      // Valid types are: audio_input, session_settings, user_input, assistant_input, 
      // tool_response, tool_error, pause_assistant_message, resume_assistant_message.
      // We just check the socket is alive and update visual indicator - no need to send anything.
      
      // Reassert indicator state while active
      if (this.alephTaskActive) {
        this.updateVisualIndicator(true, 'editing');
      } else if (this.activeToolCalls.size > 0) {
        this.updateVisualIndicator(true, 'processing');
      }
      // console.log('Keepalive check - socket alive');
    } catch (error) {
      console.warn('Keepalive error:', error);
    }
  }

  private async attemptReconnect() {
    if (this.isReconnecting) return;
    if (this.endedByUser) {
      console.log('Reconnect attempt skipped due to manual shutdown.');
      return;
    }
    // Always attempt reconnect on unexpected close - don't require active work
    // This ensures Hon stays connected even after long-running tasks complete
    this.isReconnecting = true;
    try {
      console.log('Attempting EVI reconnect...');
      // Small delay to avoid rapid reconnect loops
      await new Promise(resolve => setTimeout(resolve, 1000));
      const ok = await this.startSession();
      if (ok) {
        console.log('EVI reconnect successful');
        // Reassert indicator state post-reconnect
        if (this.alephTaskActive) {
          this.updateVisualIndicator(true, 'editing');
        } else if (this.activeToolCalls.size > 0) {
          this.updateVisualIndicator(true, 'processing');
        }
        // Ensure keepalive is running
        this.startKeepalive();
      } else {
        console.warn('EVI reconnect failed');
      }
    } catch (e) {
      console.error('EVI reconnect error:', e);
    } finally {
      this.isReconnecting = false;
    }
  }

  // Helper method to complete a tool call and potentially return to idle
  private completeToolCall(toolCallId: string, success: boolean = true) {
    if (toolCallId && this.activeToolCalls.has(toolCallId)) {
      this.activeToolCalls.delete(toolCallId);
      console.log(`Completed tool call ${toolCallId}. Remaining active tools: ${this.activeToolCalls.size}`);
      
      // Get tool metadata
      const metadata = this.toolCallMetadata.get(toolCallId);
      const state = useComicStore.getState();
      const currentComic = state.currentComic;
      
      // Track voice task completion/failure
      if (currentComic?.id && metadata) {
        const eventType = success ? 'voice_task_complete' : 'voice_task_failed';
        canvasHistoryBus.emit({
          eventType,
          eventDescription: `Voice task ${success ? 'completed' : 'failed'}: ${metadata.toolName}`,
          voiceEventId: toolCallId,
          conversationId: metadata.conversationId,
          eventData: {
            toolName: metadata.toolName,
            toolCallId,
            duration: Date.now() - metadata.startedAt,
          },
        }).then(async () => {
          // Create snapshot after voice task completion (only on success)
          if (success && this.activeToolCalls.size === 0) {
            // Capture canvas state for snapshot
            const allPanels: any[] = [];
            currentComic.pages.forEach((page, pageIndex) => {
              page.forEach(panel => {
                allPanels.push({ ...panel, _pageIndex: pageIndex });
              });
            });
            
            const canvasState = {
              comic: {
                id: currentComic.id,
                title: currentComic.title,
                pages: currentComic.pages,
                pageTemplates: currentComic.pageTemplates,
              },
              panels: allPanels,
              timestamp: new Date().toISOString(),
            };
            
            await canvasHistoryBus.createSnapshot(
              canvasState,
              'voice_task_complete',
              `Voice task completed: ${metadata.toolName}`,
              toolCallId,
              metadata.conversationId,
              `Completed ${metadata.toolName} task`
            );
          }
        });
      }
      
      // Clean up metadata
      this.toolCallMetadata.delete(toolCallId);
      
      // If no more active tool calls, return to idle
      if (this.activeToolCalls.size === 0) {
        console.log('All tool calls completed, returning to idle state');
        this.updateVisualIndicator(true, 'idle');
        // If Aleph is not active, stop keepalive
        if (!this.alephTaskActive) {
          this.stopKeepalive();
        }
      }
    }
  }

  // --- REMOVED Screen State Update Methods ---
  // public updateScreenState(...) {}
  // public updateCurrentPage(...) {}
  // public updateSelectedPanel(...) {}
  // public updatePanels(...) {}
  // public updateTemplate(...) {}
  // public updateUserAction(...) {}
  // public sendScreenStateEvent(...) {} // Also removed debounced sender



  // Start a session with Hon - USES TOKEN AUTH
  public async startSession(): Promise<boolean> {
    if (this.currentStatus === 'connecting' || this.currentStatus === 'active') {
      console.warn('Session already connecting or active.');
      return this.currentStatus === 'active';
    }

    // Check cooldown period to prevent rapid reconnection failures
    const timeSinceDisconnect = Date.now() - this.lastDisconnectTime;
    if (this.lastDisconnectTime > 0 && timeSinceDisconnect < this.RECONNECT_COOLDOWN_MS) {
      const waitTime = this.RECONNECT_COOLDOWN_MS - timeSinceDisconnect;
      console.log(`[Hon] Waiting ${waitTime}ms before reconnecting...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    try {
      // Reset manual shutdown guard on fresh start
      this.endedByUser = false;
      this.updateStatus('connecting');

      // 1. Get wallet address directly from Solana wallet adapter
      // Import dynamically to avoid circular dependencies
      let walletAddress: string | null = null;
      try {
        // Check if window.solana (Phantom) is connected
        if (typeof window !== 'undefined' && (window as any).solana?.publicKey) {
          walletAddress = (window as any).solana.publicKey.toString();
        }
      } catch (e) {
        console.warn('[Hon] Could not get wallet address:', e);
      }
      
      const userId = null; // We'll query by wallet address only
      
      let resumeChatGroupId: string | null = null;
      if (!this.shouldResumeSession) {
        // Only check for resume on user-initiated connect (not reconnects)
        resumeChatGroupId = await honEviSessionService.initializeSession(userId, walletAddress);
        if (resumeChatGroupId) {
          console.log('[Hon] Resuming conversation from previous session:', resumeChatGroupId);
        }
      }

      // 2. Fetch access token from backend
      console.log('Fetching Hume access token...');
      const tokenResponse = await fetch('/api/hume/generate-token', { method: 'POST' });
      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json().catch(() => ({ error: 'Failed to parse token error response' }));
        throw new Error(`Failed to fetch Hume token: ${tokenResponse.status} - ${errorData?.error || 'Unknown error'}`);
      }
      const { accessToken, configId } = await tokenResponse.json();
      if (!accessToken || !configId) {
        throw new Error('Received null or undefined access token/config from backend.');
      }
      console.log('Successfully fetched Hume access token and config ID.');

      // 3. Build connection options (voice is set in Hume EVI config dashboard)
      const connectOptions: any = {
        configId: configId
      };

      // Add resumed_chat_group_id if resuming
      if (resumeChatGroupId) {
        connectOptions.resumedChatGroupId = resumeChatGroupId;
        this.currentChatGroupId = resumeChatGroupId;
        console.log('[Hon] Connecting with resumed_chat_group_id:', resumeChatGroupId);
      }

      // 5. Connect to EVI using the token and secure config ID from backend
      const tempClient = new HumeClient({ accessToken });
      this.evi = await tempClient.empathicVoice.chat.connect(connectOptions);
      console.log("EVI chat.connect call completed using access token.");

      // Set up the persistent event handlers immediately after connect returns
      this.setupEventHandlers();
      console.log("Persistent event handlers set up.");
      
      // Remove immediate audio capture start - let the 'open' event handler do it
      // The 'open' event will automatically start audio capture when connection is truly active

      // Add a connection timeout safety check
      setTimeout(() => {
        if (this.currentStatus === 'connecting') {
          console.warn('Connection timeout - still in connecting state after 30 seconds');
          this.updateStatus('error');
        }
      }, 30000);

      return true;

    } catch (error) {
      console.error('Failed to start Hon session:', error);
      this.updateStatus('error'); // Update status on error
      this.evi = null; // Ensure evi is null if connect failed
      return false; // Return false on exception
    }
  }

  // End the session with Hon
  public async endSession(): Promise<boolean> {
    try {
      // Mark manual shutdown so we do not auto-reconnect
      this.endedByUser = true;
      this.lastDisconnectTime = Date.now(); // Record disconnect time for cooldown
      
      // Track conversation end before clearing
      if (this.currentChatGroupId) {
        const state = useComicStore.getState();
        const currentComic = state.currentComic;
        if (currentComic?.id) {
          canvasHistoryBus.emit({
            eventType: 'conversation_end',
            eventDescription: 'User ended conversation with Hon',
            conversationId: this.currentChatGroupId,
            eventData: {
              chatGroupId: this.currentChatGroupId,
              chatId: this.currentChatId,
            },
          });
        }
      }
      
      // Deactivate session in database (user explicitly ended conversation)
      if (this.currentSessionId) {
        await honEviSessionService.deactivateSession(this.currentSessionId);
        this.currentSessionId = null;
        this.currentChatGroupId = null;
        this.currentChatId = null;
      }
      
      // Stop keepalive immediately
      this.stopKeepalive();
      // Ensure visual indicator is fully cleared
      this.updateVisualIndicator(false, 'idle');
      // Stop Isaac watcher
      this.stopIsaacWatcher();
      // Cleanup scene build listener to prevent memory leaks
      this.cleanupSceneBuildListener();
      // Stop audio capture if active
      if (this.isCapturingAudio) {
        this.stopAudioCapture();
      }

      // Stop any playing audio
      if (this.currentSource) {
        this.currentSource.stop();
        this.currentSource = null;
      }
      
      // Clear the audio queue
      this.audioQueue = [];
      this.isPlayingAudio = false;
      
      // Close the WebSocket connection IF evi exists
      if (this.evi && this.evi.socket) {
        console.log("Attempting to close EVI socket...");
        // Hume SDK might have a disconnect method, prefer that if available
        if (typeof (this.evi as any).disconnect === 'function') {
           (this.evi as any).disconnect(); // Prefer SDK disconnect
        } else {
           this.evi.socket.close(); // Fallback to raw socket close
        }
      } else {
        console.warn("Cannot explicitly close socket: evi or evi.socket is null.");
      }

      // Nullify evi AFTER attempting close
      this.evi = null;
      this.updateStatus('idle');
      this.updateVisualIndicator(false);
      // Clear any transient task flags so UI returns to idle and reconnection isn't triggered
      this.activeToolCalls.clear();
      this.alephTaskActive = false;
      this.externalTaskCount = 0;
      this.updatePresence({ isActive: false, processingState: 'idle', progressPercent: undefined, progressLabel: undefined, etaSeconds: null });
      console.log("EVI session ended and cleaned up.");
      return true;
    } catch (error) {
      console.error('Failed to end Hon session:', error);
      // Still nullify and update status on error
      this.evi = null;
      this.updateStatus('error'); // Or 'idle' depending on desired state after failed end
      this.updateVisualIndicator(false);
      this.stopKeepalive();
      return false;
    }
  }

  // Toggle Mute state
  public async toggleMute(): Promise<void> {
    this.isMuted = !this.isMuted;
    console.log(`Toggled mute state. isMuted is now: ${this.isMuted}`);
    if (this.isMuted) {
      this.stopAudioCapture();
    } else {
      // Only start capture if the session is actually active
      if (this.currentStatus === 'active') {
        await this.startAudioCapture();
      } else {
        console.log("toggleMute: Session not active, skipping audio capture start on unmute.");
      }
    }
    // Optional: Add a callback for mute state changes if UI needs it directly
    // this.notifyMuteStateChange(this.isMuted);
  }

  // Set up event handlers for the EVI session
  private setupEventHandlers() {
    // ... (rest of setupEventHandlers remains largely the same) ...
    if (!this.evi) {
      console.error("setupEventHandlers called but this.evi is null!");
      return;
    }
    console.log("Setting up persistent event handlers...");

    this.evi.on('open', () => {
      console.log('Persistent open handler fired.');
      this.updateStatus('active');
      this.updateVisualIndicator(true);
      // Keep the socket alive even while idle to prevent unexpected closes
      this.startKeepalive();
      // Proactively share current canvas snapshot so Hon knows panel IDs immediately
      try { this.sendCanvasMetadata('session_open'); } catch (e) { console.warn('sendCanvasMetadata on open failed:', e); }
      // Start audio capture ONLY IF NOT MUTED
      if (!this.isMuted) {
        console.log('Connection is now active, starting audio capture...');
        this.startAudioCapture();
      } else {
        console.log("Connection active but user is muted, skipping audio capture start.");
      }
      // Begin Isaac background watcher so Hon always builds context
      try { this.startIsaacWatcher(); } catch {}
    });

    this.evi.on('close', () => {
      console.log('Persistent close handler fired.');
      this.updateStatus('idle');
      this.updateVisualIndicator(false);
      // Do NOT stop audio immediately; debounce to tolerate transient closes (e.g., DOM remounts)
      window.setTimeout(() => {
        if (this.currentStatus === 'idle' && !this.endedByUser) {
          this.stopAudioCapture();
        }
      }, 1500);
      this.stopIsaacWatcher();
      // If user explicitly ended the session, never attempt auto-reconnect
      if (this.endedByUser) {
        console.log('Auto-reconnect suppressed: session ended by user.');
        this.stopKeepalive();
        return;
      }
      // Unexpected close: attempt to reconnect regardless of task state
      this.attemptReconnect();
    });

    this.evi.on('error', (error: Error) => { 
      console.error('Persistent error handler fired:', error);
      
      // Don't treat "unknown message type" as fatal errors - these are just new Hume features
      if (error.message && error.message.includes('unknown message type')) {
        console.warn('Ignoring unknown message type error - this is likely a new Hume feature:', error.message);
        return; // Don't break the session for unknown message types
      }
      
      if (this.currentStatus !== 'error') {
        this.updateStatus('error');
      }
      this.updateVisualIndicator(false);
      // Avoid immediate audio stop; let reconnect attempt proceed while keeping UI calm
      window.setTimeout(() => {
        if (this.currentStatus === 'error' && !this.endedByUser) {
          this.stopAudioCapture();
        }
      }, 1500);
      // Attempt reconnect on errors unless user ended the session
      if (!this.endedByUser) {
        this.attemptReconnect();
      }
    });

    this.evi.on('message', (event: any) => {
      if (!this.evi) {
        console.warn("Persistent message handler: Received message after EVI session ended. Ignoring.");
        return;
      }
      this.processIncomingMessage(event);
    });
  }

  // Extracted message processing logic
  private async processIncomingMessage(event: any) {
    // ... (audio_output, user_message, assistant_message, chat_metadata, assistant_end handling remain the same) ...
     console.log(`processIncomingMessage: Received event type: ${event?.type}`, event);

    try {
      switch (event.type) {
        case 'audio_output':
          if (event.data && typeof event.data === 'string') {
            // Skip audio output while long-running tools are active to prevent premature "Done" announcements
            // These tools have async polling and the assistant shouldn't speak completion until result arrives
            if (this.alephTaskActive) {
              console.log('processIncomingMessage: Suppressing audio during active video edit to prevent premature completion speech.');
              break;
            }
            console.log('processIncomingMessage: Detected audio_output with base64 data.');
            this.updateVisualIndicator(true, 'speaking');
            this.enqueueAudioSegment(event.data);
          } else {
            console.warn('processIncomingMessage: Received audio_output without valid base64 data.', event);
          }
          break;

        case 'assistant_message':
          // If the assistant attempts to answer about an image without a recent canvas state, nudge workflow
          try {
            if (this.lastCanvasStateCall && Date.now() - this.lastCanvasStateCall > this.canvasStateCallThreshold) {
              console.log('Warning: assistant_message without recent getCanvasState; consider refreshing panel context.');
              // Proactively refresh canvas metadata for the model
              try { this.sendCanvasMetadata('assistant_message_stale'); } catch (e) { console.warn('sendCanvasMetadata on assistant_message failed:', e); }
            }
          } catch {}
          // If Aleph edit or scene building is active, keep green editing state
          if (this.alephTaskActive || this.sceneBuildingActive) {
            console.log('Assistant message during editing session - keeping editing indicator');
            this.updateVisualIndicator(true, 'editing');
          } else {
            // Update to indicate active state when message is being shown
            this.updateVisualIndicator(true, 'generating');
          }
          console.log(`processIncomingMessage: Assistant message: Role=${event.message?.role}, Content type=${event.message?.content?.type}`);
          break;

        case 'user_message':
          // If user speaks while Aleph edit or scene building is running, keep green editing indicator
          if (this.alephTaskActive || this.sceneBuildingActive) {
            console.log('User spoke during editing session - keeping editing indicator');
            this.updateVisualIndicator(true, 'editing');
          } else if (this.activeToolCalls.size > 0) {
            // If any tool is active, retain current processing indicator
            console.log(`User message while ${this.activeToolCalls.size} tools active - retaining indicator state`);
          } else {
            // Otherwise show reasoning
            this.updateVisualIndicator(true, 'reasoning');
          }
          console.log(`processIncomingMessage: User message: Role=${event.message?.role}, Content type=${event.message?.content?.type}`);
          
          // Log active tool calls to ensure transparency
          if (this.activeToolCalls.size > 0) {
            console.log(`processIncomingMessage: User spoke while ${this.activeToolCalls.size} tool calls active - tools will continue processing`);
          }
          
          // Handle audio interruption (but NOT tool call interruption)
          this.handleAudioInterruption();
          break;

        case 'user_interruption':
          console.log('processIncomingMessage: Received user_interruption event.');
          // Per Hume docs: stop current audio and clear queue on interruption
          this.handleAudioInterruption();
          break;

        case 'tool_call':
          // Set processing state when tool is being called
          this.updateVisualIndicator(true, 'processing');
          console.log(`processIncomingMessage: Detected tool_call: Name=${event.name}, ID=${event.tool_call_id || event.toolCallId}, Params=`, event?.parameters);
          // Ensure we use the correct ID field name
          const toolCallId = event.tool_call_id || event.toolCallId;
          
          // Track this tool call as active
          if (toolCallId) {
            this.activeToolCalls.add(toolCallId);
            console.log(`Added tool call ${toolCallId} to active set. Active tools: ${this.activeToolCalls.size}`);
            // Ensure keepalive is running while tools are active
            this.startKeepalive();
            
            // Track voice task start
            this.toolCallMetadata.set(toolCallId, {
              toolName: event.name || 'unknown',
              startedAt: Date.now(),
              conversationId: this.currentChatGroupId || undefined,
            });
            
            // Emit voice task start event
            const state = useComicStore.getState();
            const currentComic = state.currentComic;
            if (currentComic?.id) {
              canvasHistoryBus.emit({
                eventType: 'voice_task_start',
                eventDescription: `Voice task started: ${event.name}`,
                voiceEventId: toolCallId,
                conversationId: this.currentChatGroupId || undefined,
                eventData: {
                  toolName: event.name,
                  toolCallId,
                },
              });
            }
          } 
          // If Hon targets a panel, mirror that to presence.focusPanelId
          try {
            if (event.parameters) {
              const p = typeof event.parameters === 'string' ? JSON.parse(event.parameters) : event.parameters;
              const focusId = p?.target_element_id || p?.input_video_url;
              if (typeof focusId === 'string') {
                this.updatePresence({ focusPanelId: focusId || null });
              }
            }
          } catch {}
          if (event.name === 'getCanvasState') {
             // Pass the correct ID
            this.handleCanvasStateTool(toolCallId, event.parameters);
          } else if (event.name === 'get_panel_vision') {
            console.log('[AI] tool_call get_panel_vision received');
            this.handleGetPanelVision(toolCallId, event.parameters);
          } else if (event.name === 'world_mode') {
            await this.handleWorldModeTool(toolCallId, event.parameters);
          } else if (event.name === 'immersive_add_object') {
            await this.handleImmersiveToolCall(toolCallId, 'add_object', event.parameters);
          } else if (event.name === 'immersive_spawn_npcs') {
            await this.handleImmersiveToolCall(toolCallId, 'spawn_npcs', event.parameters);
          } else if (event.name === 'generate_3d_splat') {
            // Generate Gaussian splat from image - auto-activates immersive mode
            await this.handleGenerate3DSplat(toolCallId, event.parameters);
          } else if (event.name.startsWith('pc_')) {
            // PlayCanvas MCP tools for advanced scene control
            await this.handlePlayCanvasMCPTool(toolCallId, event.name, event.parameters);
          } else if (event.name === 'create_mood_board') {
        this.handleCreateMoodBoard(toolCallId, event.parameters);
      } else if (event.name === 'seedream_reference_generate') {
        // Generate a new image using Seedream v4 with all canvas images as references
        this.handleSeedreamReferenceGenerate(toolCallId, event.parameters);
      } else if (event.name === 'text_to_3d') {
        this.handleTextTo3DTool(toolCallId, event.parameters);
      } else if (event.name === 'place_3d_model_on_map') {
        this.handlePlace3DModelOnMap(toolCallId, event.parameters);
      } else if (event.name === 'generate_world_scene') {
        this.handleGenerateWorldScene(toolCallId, event.parameters);
          } else if (event.name === 'canvas_editor_tool') {
            // Handle canvas editing (generate/edit images via voice commands)
            this.handleCanvasEditorTool(toolCallId, event.parameters);
          } else if (event.name === 'video_generator') {
            // Handle video generation from voice commands
            this.handleVideoGeneratorTool(toolCallId, event.parameters);
          } else if (event.name === 'getVideoContext') {
            // Handle video understanding/analysis
            this.handleVideoContextTool(toolCallId, event.parameters);
          } else if (event.name === 'add_sound_effects') {
            // Handle SFX addition
            this.handleAddSoundEffectsTool(toolCallId, event.parameters);
          } else if (event.name === 'memory_put') {
            this.handleMemoryPut(toolCallId, event.parameters);
          } else if (event.name === 'memory_get') {
            this.handleMemoryGet(toolCallId, event.parameters);
          } else if (event.name === 'memory_search') {
            this.handleMemorySearch(toolCallId, event.parameters);
          } else if (event.name === 'memory_delete') {
            this.handleMemoryDelete(toolCallId, event.parameters);
          } else if (event.name === 'find_similar_panels') {
            this.handleFindSimilarPanels(toolCallId, event.parameters);
          } else if (event.name === 'session_upsert') {
            this.handleSessionUpsert(toolCallId, event.parameters);
          } else if (event.name === 'session_get') {
            this.handleSessionGet(toolCallId);
          } else if (event.name === 'aleph_video_editor') {
            // Handle Runway Aleph video-to-video editing
            this.handleAlephVideoEditorTool(toolCallId, event.parameters);
          } else if (event.name === 'add_sound_effects') {
            // Handle adding synchronized sound effects to a video panel
            this.handleAddSoundEffectsTool(toolCallId, event.parameters);
          } else if (event.name === 'take_notes') {
            this.handleTakeNotesTool(toolCallId, event.parameters);
          } else if (event.name === 'stop_notes') {
            this.handleStopNotesTool(toolCallId);
          } else if (event.name === 'add_notion_note') {
            // Stream a single note/bullet to the Notion panel
            await this.handleAddNotionNote(toolCallId, event.parameters);
          } else if (event.name === 'summarize_to_notion') {
            // Summarize discussion and stream bullets to Notion
            await this.handleSummarizeToNotion(toolCallId, event.parameters);
          } else if (event.name === 'notion_action') {
            // Voice-triggered Notion actions via MCP: "Add this to Notion", "Search Notion for..."
            await this.handleNotionAction(toolCallId, event.parameters);
          } else if (event.name === 'arrange_panels') {
            // Handle panel layout arrangement (grid, timeline, storyboard, cluster)
            this.handleArrangePanelsTool(toolCallId, event.parameters);
          } else if (event.name === 'generate_game') {
            await this.handleGenerateGameTool(toolCallId, event.parameters);
          } else if (event.name === 'set_game_model') {
            this.handleSetGameModelTool(toolCallId, event.parameters);
          } else if (event.name === 'edit_game') {
            await this.handleEditGameTool(toolCallId, event.parameters);
          } else if (event.name === 'highlight_objects') {
            await this.handleHighlightObjectsTool(toolCallId, event.parameters);
          } else {
            console.warn(`processIncomingMessage: Unhandled tool_call name: ${event.name}`);
            // Pass the correct ID
            this.sendToolErrorResponse(toolCallId, `Tool not implemented: ${event.name}`);
          }
          break;
        
        case 'chat_metadata':
          console.log('processIncomingMessage: Received chat_metadata event.', event);
          // Store session information for conversation continuity
          if (event.chat_group_id && event.chat_id) {
            const isNewConversation = !this.currentChatGroupId || this.currentChatGroupId !== event.chat_group_id;
            this.currentChatGroupId = event.chat_group_id;
            this.currentChatId = event.chat_id;
            
            // Track conversation start if this is a new conversation
            const state = useComicStore.getState();
            if (isNewConversation) {
              const currentComic = state.currentComic;
              if (currentComic?.id) {
                canvasHistoryBus.emit({
                  eventType: 'conversation_start',
                  eventDescription: 'Started conversation with Hon',
                  conversationId: event.chat_group_id,
                  eventData: {
                    chatGroupId: event.chat_group_id,
                    chatId: event.chat_id,
                  },
                });
              }
            }
            
            // Store in database for cross-device/session persistence
            const userId = (state as any).user?.id;
            const walletAddress = (state as any).walletAddress;
            
            honEviSessionService.storeChatMetadata(
              event.chat_group_id,
              event.chat_id,
              userId,
              walletAddress
            ).then((sessionId) => {
              if (sessionId) {
                this.currentSessionId = sessionId;
                console.log('[Hon] Session stored with ID:', sessionId);
              }
            }).catch(err => {
              console.warn('[Hon] Failed to store session:', err);
            });
          }
          break;

        case 'assistant_end':
          console.log('processIncomingMessage: Received assistant_end event.');
          // Track conversation end
          if (this.currentChatGroupId) {
            const state = useComicStore.getState();
            const currentComic = state.currentComic;
            if (currentComic?.id) {
              canvasHistoryBus.emit({
                eventType: 'conversation_end',
                eventDescription: 'Hon ended conversation',
                conversationId: this.currentChatGroupId,
                eventData: {
                  chatGroupId: this.currentChatGroupId,
                  chatId: this.currentChatId,
                },
              });
            }
          }
          // Only return to idle if no tools are actively being processed
          if (this.activeToolCalls.size === 0) {
            console.log('No active tool calls, returning to idle state');
            this.updateVisualIndicator(true, 'idle');
          } else {
            console.log(`Still have ${this.activeToolCalls.size} active tool calls, keeping current state`);
            // Reassert appropriate indicator if Aleph is running
            if (this.alephTaskActive) {
              this.updateVisualIndicator(true, 'editing');
            }
          }
          // Continue processing queue if there are remaining segments
          this.processGaplessAudioQueue(); 
          // Clear focus automatically if nothing is active
          if (this.activeToolCalls.size === 0 && !this.alephTaskActive) {
            this.updatePresence({ isActive: false, processingState: 'idle', progressPercent: undefined, progressLabel: undefined, etaSeconds: null });
          }
          break;


          
        default:
          // Log full event details for debugging unknown message types
          console.warn("processIncomingMessage: Received message event without known type or data field:", JSON.stringify(event, null, 2));
          break; 
      } 

    } catch (error) {
      console.error('processIncomingMessage: Error processing incoming message:', error);
    }
  }
  // generate_world_scene: the map branch opens a real place in the 3D map view.
  // Prompt-to-world generation is not implemented, so that branch answers the
  // model and the user plainly instead of returning a sample scene.
  private async handleGenerateWorldScene(toolCallId: string, parameters: any) {
    try {
      const p = typeof parameters === 'string' ? (() => { try { return JSON.parse(parameters); } catch { return {}; } })() : (parameters || {});
      const prompt = p.prompt || '';
      const state = useComicStore.getState();

      if (state.worldModePreference === 'map') {
        await this.handleWorldMapNavigation(toolCallId, p, prompt);
        return;
      }

      console.info('[AI] generate_world_scene: not available in this build');
      this.sendToolErrorResponse(toolCallId, 'not_available', WORLD_SCENE_NOT_AVAILABLE);
      this.speak('Generating a world from a description is not available yet. I can turn an image on the canvas into a splat scene, or open a real place on the map.');
    } catch (error: any) {
      console.error('[AI] generate_world_scene error:', error);
      this.sendToolErrorResponse(toolCallId, error.message || 'generate_world_scene failed');
    }
  }

  private async handleWorldMapNavigation(toolCallId: string, parameters: any, fallbackPrompt: string) {
    const state = useComicStore.getState();
    const explicit = parameters?.location || parameters?.map_query || parameters?.destination;
    const query = (explicit || fallbackPrompt || state.worldSettings.mapQuery || '').trim();

    if (!query) {
      this.sendToolErrorResponse(toolCallId, 'Tell me where to go, like “Show me Times Square.”');
      return;
    }

    try {
      this.beginExternalTask('processing');
      this.speak(`Heading to ${query}.`);

      state.setWorldModePreference('map');
      state.setWorldSettings({
        mapQuery: query,
        mapStatus: 'resolving',
        mapError: null,
      });

      state.setWorldModePreference('map');
      state.setWorldSettings({
        mapQuery: query,
        mapStatus: 'resolving',
        mapError: null,
      });

      const match = await geocodeQuery(query);
      if (!match) {
        throw new Error('ZERO_RESULTS');
      }

      const altitude = pickMapAltitude(match.types);
      const range = estimateMapRange(match.viewport);
      const currentTarget = state.worldSettings.mapTarget;
      const heading = currentTarget?.heading ?? DEFAULT_MAP_HEADING;
      const tilt = currentTarget?.tilt ?? DEFAULT_MAP_TILT;

      state.setWorldSettings({
        mapTarget: {
          query,
          lat: match.location.lat,
          lng: match.location.lng,
          altitude,
          heading,
          tilt,
          range,
          resolvedName: match.formattedAddress,
          types: match.types,
        },
        mapStatus: 'ready',
        mapError: null,
      });
      state.setWorldMode(true);

      const friendlyName = match.formattedAddress || query;
      this.sendToolSuccessResponse(toolCallId, `Loaded ${friendlyName} in world mode.`);
      this.completeToolCall(toolCallId);
      this.speak(`Here we are: ${friendlyName}.`);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNKNOWN';
      const message = formatGeocodeError(code);
      console.error('[AI] world_map_navigation error:', error);
      this.sendToolErrorResponse(toolCallId, message);
    } finally {
      this.endExternalTask();
    }
  }

  private async handleWorldModeTool(toolCallId: string, parameters: any) {
    const p = typeof parameters === 'string' ? (() => { try { return JSON.parse(parameters); } catch { return {}; } })() : (parameters || {});
    const state = useComicStore.getState();
    const requestedMode = (p.mode || '').toLowerCase();
    const hasLocation = !!(p.location || p.prompt);
    
    // Default to 'map' mode when a location is provided, otherwise use preference
    const targetMode: 'immersive' | 'map' =
      requestedMode === 'map'
        ? 'map'
        : requestedMode === 'immersive'
        ? 'immersive'
        : hasLocation
        ? 'map'  // If location provided but no mode, default to map
        : state.worldModePreference || 'map';  // Default to map if no preference set

    if (targetMode === 'map') {
      await this.handleWorldMapNavigation(toolCallId, p, p.location || p.prompt || '');
      return;
    }

    try {
      this.beginExternalTask('processing');
      state.setWorldModePreference('immersive');

      if (p.selected_scene_id) {
        state.setWorldSettings({ selectedSceneId: p.selected_scene_id });
      }

      let splatUrl = state.worldSettings.splatUrl;
      let sceneName = 'demo scene';
      
      // Try to find a scene to load
      if ((!splatUrl || p.selected_scene_id) && state.worldScenes.length) {
        const selectedId = p.selected_scene_id || state.worldSettings.selectedSceneId;
        const targetScene = state.worldScenes.find((scene) => scene.id === selectedId) || state.worldScenes.find((scene) => scene.status === 'ready');
        if (targetScene?.fileUrl) {
          splatUrl = targetScene.fileUrl;
          sceneName = targetScene.name || 'your scene';
          state.setWorldSettings({ splatUrl, selectedSceneId: targetScene.id });
        }
      }

      // Activate immersive mode - PlayCanvas will show demo scene if no splat URL
      state.setWorldMode(true);
      try {
        document.dispatchEvent(new CustomEvent('side-menu-set-collapsed', { detail: { collapsed: true } }));
      } catch {}

      // Get available immersive commands for context
      const { getAvailableCommands } = await import('./playcanvasMCP/humeIntegration');
      const availableCommands = getAvailableCommands();

      if (splatUrl) {
        this.sendToolSuccessResponse(toolCallId, `Immersive world activated with ${sceneName}. (Voice acknowledgment already provided - do not announce this activation.)\n\n${availableCommands}`);
        this.speak(`Here we go—loading ${sceneName}.`);
      } else {
        this.sendToolSuccessResponse(toolCallId, `Immersive mode activated with demo scene. You can build games or create anything you want! (Voice acknowledgment already provided - do not announce this activation.)\n\n${availableCommands}`);
        this.speak('Entering immersive mode. This is a blank scene—I can build whatever you want. Try asking me to create a simple game or add some objects.');
      }
    } catch (error: any) {
      this.sendToolErrorResponse(toolCallId, error.message || 'Failed to activate world mode.');
    } finally {
      this.endExternalTask();
    }
  }

  /**
   * Handle immersive scene tools (add objects, spawn NPCs)
   */
  private async handleImmersiveToolCall(toolCallId: string, action: string, parameters: any) {
    const p = typeof parameters === 'string' ? (() => { try { return JSON.parse(parameters); } catch { return {}; } })() : (parameters || {});

    this.beginExternalTask('editing');

    try {
      const tools = await import('./immersiveSceneTools');
      let result: { success: boolean; objectId?: string; message: string };

      if (action === 'add_object') {
        result = await tools.handleImmersiveAddObject(p);
      } else if (action === 'spawn_npcs') {
        result = await tools.handleImmersiveSpawnNPCs(p);
      } else {
        result = { success: false, message: `Unknown action: ${action}` };
      }

      if (result.success) {
        this.sendToolSuccessResponse(toolCallId, JSON.stringify(result));
        this.speak(result.message);
      } else {
        this.sendToolErrorResponse(toolCallId, result.message);
      }
    } catch (error: any) {
      console.error(`[AI] immersive_${action} error:`, error);
      this.sendToolErrorResponse(toolCallId, error.message || `Failed to ${action.replace('_', ' ')}`);
    } finally {
      this.completeExternalTask();
    }
  }

  /**
   * Handle generate_3d_splat - Convert an image into a Gaussian splat
   *
   * This tool:
   * 1. Auto-activates immersive scene mode if not already active
   * 2. Generates a Gaussian splat from the provided image URL
   * 3. Loads the splat into the scene with the radial reveal effect
   *
   * Uses Apple's Sharp model via Modal for fast (~30s) image-to-splat conversion.
   */
  private async handleGenerate3DSplat(toolCallId: string, parameters: any) {
    console.log('[generate_3d_splat] Handler called with toolCallId:', toolCallId, 'params:', parameters);
    
    // Guard against duplicate calls
    if (this.splatGenerationInProgress) {
      console.log('[generate_3d_splat] Already in progress, ignoring duplicate call');
      this.sendToolSuccessResponse(toolCallId, JSON.stringify({ success: true, message: 'Splat generation already in progress' }));
      return;
    }
    this.splatGenerationInProgress = true;
    
    const p = typeof parameters === 'string'
      ? (() => { try { return JSON.parse(parameters); } catch { return {}; } })()
      : (parameters || {});

    // Set indicator to generating state - will stay active for entire splat generation
    this.beginExternalTask('generating');

    try {
      const state = useComicStore.getState();
      let imageUrl = p.image_url || p.imageUrl || p.url;

      // Auto-detect from selected or current panel if no URL provided
      if (!imageUrl) {
        const currentComic = state.currentComic;
        const pages = currentComic?.pages || [];
        console.log('[generate_3d_splat] Auto-detecting image. Pages:', pages.length, 'currentPageIndex:', state.currentPageIndex);

        // Try selected panel first
        const selectedPanelId = getSelectedPanelId(state);
        console.log('[generate_3d_splat] Selected panel ID:', selectedPanelId);
        
        if (selectedPanelId && pages.length > 0) {
          // Search all pages for the selected panel
          for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
            const page = pages[pageIdx] || [];
            const panel = page.find(p => p.id === selectedPanelId);
            if (panel) {
              console.log('[generate_3d_splat] Found selected panel:', { id: panel.id, hasUrl: !!panel.url, url: panel.url?.substring(0, 50), type: panel.type });
              if (panel.url && (panel.type === 'image' || panel.type === 'gif')) {
                imageUrl = panel.url;
                console.log('[generate_3d_splat] Using selected panel image:', imageUrl.substring(0, 60));
                break;
              }
            }
          }
        }

        // Fall back to most recent panel on current page
        if (!imageUrl && pages.length > 0) {
          const currentPageIndex = state.currentPageIndex || 0;
          const currentPage = pages[currentPageIndex] || [];
          console.log('[generate_3d_splat] Checking current page panels:', currentPage.length);
          
          // Find most recent panel with an image URL
          for (let i = currentPage.length - 1; i >= 0; i--) {
            const panel = currentPage[i];
            console.log('[generate_3d_splat] Panel', i, ':', { id: panel?.id, hasUrl: !!panel?.url, type: panel?.type });
            if (panel?.url && (panel.type === 'image' || panel.type === 'gif')) {
              imageUrl = panel.url;
              console.log('[generate_3d_splat] Using most recent panel image:', imageUrl.substring(0, 60));
              break;
            }
          }
        }
      }

      // Still no URL? Error out
      if (!imageUrl) {
        this.sendToolErrorResponse(toolCallId, 'No image found. Please select a panel with an image or provide an image URL.');
        return;
      }

      console.log('[generate_3d_splat] Starting splat generation for:', imageUrl.substring(0, 80));

      // Don't activate immersive mode yet - wait until splat is ready
      // This way users see the radial reveal effect as the first thing
      this.speak("Generating your 3D splat, this will take about 30 to 60 seconds.");

      // Update presence with progress label
      this.updatePresence({ progressLabel: 'Generating 3D splat...', progressPercent: undefined });

      // Import and call the image-to-splat handler
      const { handleImmersiveImageToSplat } = await import('./immersiveSceneTools');

      // Reassert indicator state periodically during the long wait
      const indicatorKeepalive = setInterval(() => {
        this.updateVisualIndicator(true, 'generating');
        this.updatePresence({ progressLabel: 'Generating 3D splat...', progressPercent: undefined });
      }, 2000); // Reassert every 2 seconds

      let result;
      try {
        result = await handleImmersiveImageToSplat({
          imageUrl,
          image_url: imageUrl,
          ...p, // Pass through any other params like position, scale, name
        });
      } finally {
        // Clear the indicator keepalive interval
        clearInterval(indicatorKeepalive);
      }

      if (result.success) {
        // NOW activate immersive mode so user sees the radial reveal effect
        const currentState = useComicStore.getState();
        if (!currentState.isWorldMode || currentState.worldModePreference !== 'immersive') {
          console.log('[generate_3d_splat] Activating immersive scene mode now that splat is ready...');
          currentState.setWorldMode(true);
          currentState.setWorldModePreference('immersive');
          
          // Give UI time to transition to immersive mode before radial reveal
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        this.sendToolSuccessResponse(toolCallId, JSON.stringify(result));
        this.speak("Your 3D splat is ready! Opening immersive scene now.");

        // Capture timeline snapshot after successful splat generation
        setTimeout(async () => {
          try {
            const { createImmersiveSceneSnapshot } = await import('../utils/canvasHistory');
            await createImmersiveSceneSnapshot('Generated 3D Gaussian splat from image', 'immersive_object_add');
          } catch (e) {
            console.warn('[generate_3d_splat] Failed to capture snapshot:', e);
          }
        }, 2000); // Wait for radial reveal to start
      } else {
        this.sendToolErrorResponse(toolCallId, result.message);
        this.speak(result.message);
      }
    } catch (error: any) {
      console.error('[generate_3d_splat] Error:', error);
      this.sendToolErrorResponse(toolCallId, error.message || 'Failed to generate 3D splat');
    } finally {
      // Clear progress label and complete external task
      this.updatePresence({ progressLabel: undefined, progressPercent: undefined });
      this.completeExternalTask();
      this.splatGenerationInProgress = false;
    }
  }

  /**
   * Start or extend a scene building session
   * Keeps the editing indicator active during multi-step scene construction
   * @param extendedTimeoutMs Optional extended timeout for complex/parallel builds (default 6s)
   */
  private startSceneBuildingSession(extendedTimeoutMs?: number) {
    // Clear any existing timeout
    if (this.sceneBuildingTimeout) {
      clearTimeout(this.sceneBuildingTimeout);
      this.sceneBuildingTimeout = null;
    }

    // Track tool count for this session
    this.sceneBuildingToolCount++;

    // If not already in scene building mode, start it
    if (!this.sceneBuildingActive) {
      this.sceneBuildingActive = true;
      console.log('[SceneBuilding] Session started');
    }

    // Keep indicator in editing state
    this.updateVisualIndicator(true, 'editing');

    // Set timeout to end session
    // Default 6s for simple builds, extendable for parallel builds (30-60s)
    const timeoutMs = extendedTimeoutMs || 6000;
    console.log(`[SceneBuilding] Timeout set to ${timeoutMs}ms`);
    this.sceneBuildingTimeout = setTimeout(() => {
      this.endSceneBuildingSession();
    }, timeoutMs);
  }

  /**
   * End the scene building session
   */
  private endSceneBuildingSession() {
    if (this.sceneBuildingActive) {
      console.log(`[SceneBuilding] Session ended after ${this.sceneBuildingToolCount} tool calls`);
      this.sceneBuildingActive = false;
      this.sceneBuildingToolCount = 0;

      // Clear timeout if still active
      if (this.sceneBuildingTimeout) {
        clearTimeout(this.sceneBuildingTimeout);
        this.sceneBuildingTimeout = null;
      }

      // Complete all external tasks and return to idle
      this.completeExternalTask();
    }
  }

  /**
   * Handle PlayCanvas MCP tools for advanced scene control
   *
   * NEW APPROACH: pc_execute is the single tool that uses Claude to generate
   * PlayCanvas code from natural language. This replaces dozens of individual tools.
   */
  private async handlePlayCanvasMCPTool(toolCallId: string, toolName: string, parameters: any) {
    const p = typeof parameters === 'string' ? (() => { try { return JSON.parse(parameters); } catch { return {}; } })() : (parameters || {});

    // Start/extend scene building session - keeps indicator in editing state
    this.startSceneBuildingSession();

    // Also use external task tracking for backup
    this.beginExternalTask('editing');
    
    try {
      // NEW: Handle pc_execute - the universal PlayCanvas control tool
      if (toolName === 'pc_execute') {
        await this.handlePlayCanvasExecute(toolCallId, p);
        return;
      }
      
      // NEW: Handle pc_look - visual scene understanding
      if (toolName === 'pc_look') {
        await this.handlePlayCanvasLook(toolCallId, p);
        return;
      }
      
      // Legacy: Handle old pc_* tools for backward compatibility
      const { handleImmersiveMCPTool } = await import('./playcanvasMCP/humeIntegration');
      
      const result = await handleImmersiveMCPTool(toolName, p);
      
      if (result.success) {
        this.sendToolSuccessResponse(toolCallId, JSON.stringify(result));
        this.speak(result.message);
      } else {
        this.sendToolErrorResponse(toolCallId, result.message);
      }
    } catch (error: any) {
      console.error(`[AI] ${toolName} error:`, error);
      this.sendToolErrorResponse(toolCallId, error.message || `Failed to execute ${toolName}`);
      // Only complete on error - success waits for scene to build
      this.completeExternalTask();
    }
    // Note: completeExternalTask() is NOT called here on success
    // The WorldImmersiveCanvas will fire 'hon:scene-build-complete' when done
    // which triggers the completion via window event listener
  }

  /**
   * Handle pc_execute - Universal PlayCanvas control via Claude code generation
   * 
   * This is the new single-tool approach:
   * 1. Hon describes what to do in natural language
   * 2. We call Claude to generate PlayCanvas code
   * 3. We execute the code in the browser where PlayCanvas is running
   */
  private async handlePlayCanvasExecute(toolCallId: string, params: any) {
    if (!SCENE_CODE_EXECUTION_ENABLED) {
      this.sendToolErrorResponse(toolCallId, SCENE_CODE_EXECUTION_DISABLED_MESSAGE);
      this.completeExternalTask();
      return;
    }
    const intent = params.intent || params.action || params.command || '';
    
    if (!intent) {
      this.sendToolErrorResponse(toolCallId, 'Missing intent - describe what to create or modify in the scene');
      return;
    }

    console.log('[pc_execute] Processing intent:', intent);
    // Short acknowledgment - no third person ("Hon is...")
    this.speak("On it.");

    try {
      // Get scene context from PlayCanvas
      const { getPlayCanvasApp, getCameraEntity } = await import('./playcanvasMCP/index');
      const app = getPlayCanvasApp();
      const camera = getCameraEntity();
      const pc = (window as any).pc;
      
      if (!app || !pc) {
        this.sendToolErrorResponse(toolCallId, 'PlayCanvas not initialized. Please activate immersive scene mode first.');
        return;
      }

      if (!camera) {
        console.warn('[pc_execute] Camera not available, proceeding without camera context');
      }

      // Get current scene context for Claude - including user position and what they're looking at
      let sceneContext = '';
      try {
        const contextParts: string[] = [];
        
        // 1. USER POSITION & VIEW DIRECTION
        if (camera) {
          const camPos = camera.getPosition();
          const camForward = camera.forward;
          const camAngles = camera.getEulerAngles();
          
          contextParts.push('USER POSITION:');
          contextParts.push(`  Location: (${camPos.x.toFixed(1)}, ${camPos.y.toFixed(1)}, ${camPos.z.toFixed(1)})`);
          contextParts.push(`  Looking direction: (${camForward.x.toFixed(2)}, ${camForward.y.toFixed(2)}, ${camForward.z.toFixed(2)})`);
          contextParts.push(`  Rotation: Y=${camAngles.y.toFixed(0)}° (yaw), X=${camAngles.x.toFixed(0)}° (pitch)`);
          
          // Calculate "in front of user" position (5 units ahead)
          const inFrontX = camPos.x + camForward.x * 5;
          const inFrontZ = camPos.z + camForward.z * 5;
          contextParts.push(`  "In front of me" means around: (${inFrontX.toFixed(1)}, 0, ${inFrontZ.toFixed(1)})`);
          contextParts.push('');
        }
        
        // 2. GROUND BOUNDS - Critical for placing new objects!
        let groundBounds = { minX: -40, maxX: 40, minZ: -40, maxZ: 40 }; // defaults
        app.root.children.forEach((entity: any) => {
          if (entity.name?.toLowerCase().includes('ground') && entity.render) {
            const pos = entity.getPosition();
            const scale = entity.getLocalScale();
            if (pos && scale) {
              // Ground is typically a box with scale (width, height, depth)
              const halfWidth = scale.x / 2;
              const halfDepth = scale.z / 2;
              groundBounds = {
                minX: pos.x - halfWidth,
                maxX: pos.x + halfWidth,
                minZ: pos.z - halfDepth,
                maxZ: pos.z + halfDepth
              };
            }
          }
        });

        contextParts.push('GROUND BOUNDS (place ALL objects within these limits!):');
        contextParts.push(`  X range: ${groundBounds.minX.toFixed(0)} to ${groundBounds.maxX.toFixed(0)}`);
        contextParts.push(`  Z range: ${groundBounds.minZ.toFixed(0)} to ${groundBounds.maxZ.toFixed(0)}`);
        contextParts.push(`  ⚠️ Objects outside these bounds will float in the void!`);
        contextParts.push('');

        // 3. NEARBY OBJECTS (within 20 units of camera)
        const nearbyObjects: string[] = [];
        const allObjects: string[] = [];
        
        const traverse = (entity: any, depth: number = 0) => {
          if (depth > 2 || !entity.name || entity.name === 'Root') return;
          
          const pos = entity.getPosition?.();
          if (!pos) return;
          
          let info = `- ${entity.name}`;
          info += ` at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`;
          if (entity.render) info += ` [${entity.render.type || 'model'}]`;
          if (entity.light) info += ` [${entity.light.type} light]`;
          
          // Check distance from camera
          if (camera) {
            const camPos = camera.getPosition();
            const dist = Math.sqrt(
              Math.pow(pos.x - camPos.x, 2) + 
              Math.pow(pos.z - camPos.z, 2)
            );
            if (dist < 20) {
              nearbyObjects.push(`${info} (${dist.toFixed(0)}m away)`);
            }
          }
          
          allObjects.push(info);
          entity.children?.forEach((child: any) => traverse(child, depth + 1));
        };
        
        app.root.children.forEach((child: any) => traverse(child, 0));
        
        if (nearbyObjects.length > 0) {
          contextParts.push('NEARBY OBJECTS (within 20m):');
          contextParts.push(...nearbyObjects.slice(0, 15));
          contextParts.push('');
        }
        
        // 3. ALL SCENE OBJECTS (brief list)
        if (allObjects.length > 0) {
          contextParts.push(`SCENE OBJECTS (${allObjects.length} total):`);
          contextParts.push(...allObjects.slice(0, 20));
        }
        
        sceneContext = contextParts.join('\n');
      } catch (e) {
        console.warn('[pc_execute] Could not get scene context:', e);
      }

      // Check if this is a complex scene that needs parallel building
      const { executeSceneBuild, needsParallelBuild, getProgressVoiceMessage } =
        await import('./playcanvasMCP/parallelExecuteClient');

      const isComplex = needsParallelBuild(intent);

      // === PARALLEL BUILD LOCK ===
      // Prevent overlapping parallel builds - Hon should wait for current build to complete
      if (isComplex && this.parallelBuildInProgress) {
        const elapsedSeconds = Math.round((Date.now() - this.parallelBuildStartTime) / 1000);
        console.log(`[pc_execute] Parallel build already in progress (${elapsedSeconds}s elapsed) - rejecting new build`);

        // Tell Hon to wait - don't start a new build
        this.sendToolSuccessResponse(toolCallId, JSON.stringify({
          success: true,
          status: 'building',
          message: `A scene build is already in progress (${elapsedSeconds}s elapsed). Please wait for it to complete before requesting changes. I'll let you know when it's done.`
        }));
        return;
      }

      if (isComplex) {
        console.log('[pc_execute] Complex scene detected - using parallel build');
        this.parallelBuildInProgress = true;
        this.parallelBuildStartTime = Date.now();
        // First person status update
        this.speak("Building this in parallel - give me a moment.");
        // Extend scene building timeout for parallel builds (60s instead of 6s)
        this.startSceneBuildingSession(60000);
      }

      // === DEMO CLEARING STRATEGY ===
      // Don't clear immediately - clear after first section renders for smooth transition
      const demoEntityNames = ['ground', 'glowing sphere'];
      const demoEntityPatterns = [/^cube \d+$/i];
      let demoCleared = false;

      const clearDemoEntities = () => {
        if (demoCleared) return;
        demoCleared = true;

        const demoEntitiesToRemove: any[] = [];
        app.root.children.forEach((entity: any) => {
          if (!entity.name) return;
          if (entity.camera || entity.light) return;
          if (entity.gsplat || entity.name.includes('splat')) return;
          if (entity.model || entity.tags?.has?.('environment') || entity.tags?.has?.('asset')) return;

          const isDemoEntity = demoEntityNames.includes(entity.name.toLowerCase()) ||
                              demoEntityPatterns.some(pattern => pattern.test(entity.name));
          if (isDemoEntity) {
            demoEntitiesToRemove.push(entity);
          }
        });

        if (demoEntitiesToRemove.length > 0) {
          console.log(`[pc_execute] Clearing ${demoEntitiesToRemove.length} demo entities after first render:`,
            demoEntitiesToRemove.map((e: any) => e.name));
          demoEntitiesToRemove.forEach((entity: any) => entity.destroy());
        }
      };

      // Track progressive execution for parallel builds
      let progressiveExecutionCount = 0;
      const executedSections: string[] = [];

      // Execute with automatic parallel/sequential selection
      const result = await executeSceneBuild(intent, sceneContext, {
        mode: 'auto',
        maxAgents: 4,
        onProgress: (progress) => {
          console.log('[pc_execute] Build progress:', progress);
          // Dispatch progress event for UI
          window.dispatchEvent(new CustomEvent('hon-build-progress', { detail: progress }));

          // PROGRESSIVE RENDERING: Execute each section's code as it arrives
          if (progress.sectionCode && progress.sectionName) {
            try {
              const sectionCode = progress.sectionCode;
              console.log(`[pc_execute] Executing geometry section: ${progress.sectionName} (${progress.sectionZone || 'global'})`);

              // Execute the section code immediately
              const executableCode = `(function(app, pc, camera) { ${sectionCode} })`;
              const fn = eval(executableCode);
              fn(app, pc, camera);

              // Clear demo entities after first successful render (smooth transition)
              clearDemoEntities();

              progressiveExecutionCount++;
              executedSections.push(progress.sectionName);
              console.log(`[pc_execute] Section ${progress.sectionName} rendered (${progressiveExecutionCount} sections in scene)`);
            } catch (sectionError: any) {
              console.warn(`[pc_execute] Section ${progress.sectionName} failed:`, sectionError.message);
              // Don't throw - continue with other sections
            }
          }

          // PROGRESSIVE RENDERING: Execute tool calls for particles/atmosphere/weather
          console.log('[pc_execute] Progress received:', {
            hasToolCall: !!progress.sectionToolCall,
            hasCode: !!progress.sectionCode,
            sectionName: progress.sectionName,
            toolCall: progress.sectionToolCall
          });

          if (progress.sectionToolCall && progress.sectionName) {
            // Execute tool calls asynchronously but don't block the progress stream
            (async () => {
              try {
                const { tool, params } = progress.sectionToolCall!;
                console.log(`[pc_execute] >>> Executing tool call: ${tool} for: ${progress.sectionName}`, params);

                // Execute the appropriate tool based on name (all async now)
                switch (tool) {
                  case 'pc_add_particle_effect':
                    // Add particle effect (fire, smoke, sparkles, etc.)
                    await this.executeParticleEffect(app, pc, params);
                    break;
                  case 'pc_create_gradient_sky':
                    // Create gradient sky
                    await this.executeGradientSky(app, pc, camera, params);
                    break;
                  case 'pc_set_mood':
                    // Set scene mood/lighting
                    this.executeMoodChange(app, pc, camera, params);
                    break;
                  case 'pc_add_weather':
                    // Add weather effect
                    await this.executeWeatherEffect(app, pc, params);
                    break;
                  case 'pc_add_light':
                    // Add point/spot lights
                    await this.executeLightEffect(app, pc, params);
                    break;
                  case 'pc_set_post_processing':
                    // Set post-processing effects
                    await this.executePostProcessing(app, pc, params);
                    break;
                  case 'pc_add_physics':
                    // Add physics to entity
                    await this.executeAddPhysics(app, pc, params);
                    break;
                  default:
                    console.warn(`[pc_execute] Unknown tool call: ${tool}`);
                }

                // Clear demo entities after first successful effect (smooth transition)
                clearDemoEntities();

                console.log(`[pc_execute] Tool ${tool} executed for ${progress.sectionName}`);
              } catch (toolError: any) {
                console.warn(`[pc_execute] Tool call ${progress.sectionToolCall!.tool} failed:`, toolError.message);
                // Don't throw - continue with other sections
              }
            })();

            progressiveExecutionCount++;
            executedSections.push(`${progress.sectionName} (${progress.sectionToolCall.tool})`);
          }
        }
      });

      if (!result.success) {
        if (result.error?.includes('syntax')) {
          console.warn('[pc_execute] Code validation failed:', result.error);
          this.speak("That didn't quite work - let me try a simpler approach.");
        }
        throw new Error(result.error || 'Failed to generate code');
      }

      const code = result.code;

      // Log parallel build stats if applicable
      if (result.mode === 'parallel' && result.stats) {
        console.log('[pc_execute] Parallel build complete:', result.stats);
      }

      // For parallel builds with progressive execution, we already rendered each section
      // Skip the merged code execution to avoid duplicates
      const wasParallelBuild = isComplex && result.mode === 'parallel';
      const alreadyExecutedProgressively = progressiveExecutionCount > 0;

      if (alreadyExecutedProgressively) {
        console.log(`[pc_execute] Progressive rendering complete: ${progressiveExecutionCount} sections already in scene`);
        console.log(`[pc_execute] Executed sections: ${executedSections.join(', ')}`);
      }

      if (!code && !alreadyExecutedProgressively) {
        throw new Error('No code generated');
      }

      let execTime = 0;
      const beforeCount = app.root.children.length;

      // Only execute merged code for sequential builds (non-parallel)
      // For parallel builds, sections were already executed progressively
      if (!alreadyExecutedProgressively && code) {
        // Validate code isn't truncated (check for balanced braces/parens)
        const openBraces = (code.match(/\{/g) || []).length;
        const closeBraces = (code.match(/\}/g) || []).length;
        const openParens = (code.match(/\(/g) || []).length;
        const closeParens = (code.match(/\)/g) || []).length;

        if (openBraces !== closeBraces || openParens !== closeParens) {
          console.warn('[pc_execute] Code appears truncated - unbalanced braces/parens:', {
            openBraces, closeBraces, openParens, closeParens, codeLength: code.length
          });
          throw new Error('Generated code was truncated. Try a simpler request.');
        }

        console.log('[pc_execute] Executing generated code:', code.substring(0, 200) + '...');

        // Log existing entities before execution for debugging
        const existingEntities = app.root.children.map((e: any) => e.name).filter(Boolean);
        console.log('[pc_execute] Existing root entities:', existingEntities);

        // Execute the code in browser context
        try {
          const executableCode = `(function(app, pc, camera) { ${code} })`;

          // Step 1: Parse the code (catch syntax errors)
          let fn: Function;
          try {
            fn = eval(executableCode);
          } catch (parseError: any) {
            console.error('[pc_execute] Code parsing failed:', parseError);
            throw new Error(`Code parsing failed: ${parseError.message}`);
          }

          // Step 2: Execute the code (catch runtime errors)
          const execStart = performance.now();

          try {
            const execResult = fn(app, pc, camera);
            // If the function returns a promise (async code), wait for it
            if (execResult instanceof Promise) {
              await Promise.race([
                execResult,
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error('Async code execution timeout (>10s)')), 10000)
                )
              ]);
            }
          } catch (runtimeError: any) {
            console.error('[pc_execute] Runtime error:', runtimeError);
            throw new Error(`Runtime error: ${runtimeError.message}`);
          }

          execTime = performance.now() - execStart;
        } catch (execError: any) {
          console.error('[pc_execute] Code execution error:', execError);
          throw execError;
        }
      }

      const afterCount = app.root.children.length;
      console.log(`[pc_execute] Complete. Entities: ${beforeCount} → ${afterCount} (${afterCount - beforeCount > 0 ? '+' : ''}${afterCount - beforeCount})`);

      // === CLEAR BUILD LOCK AND ANNOUNCE COMPLETION ===
      if (this.parallelBuildInProgress) {
        this.parallelBuildInProgress = false;
        const buildDuration = Math.round((Date.now() - this.parallelBuildStartTime) / 1000);
        console.log(`[pc_execute] Build complete - lock released after ${buildDuration}s`);
      }

      // Build response with parallel build stats if applicable
      const responseMessage = wasParallelBuild && result.stats
        ? `BUILD COMPLETE: Scene built successfully with ${result.stats.successfulTasks}/${result.stats.totalTasks} sections. All entities are now in the scene. The user can now see the result and request changes.`
        : `Executed: ${intent}`;

      this.sendToolSuccessResponse(toolCallId, JSON.stringify({
        success: true,
        status: 'complete', // Clear status for Hon to know build is done
        message: responseMessage,
        codeLength: code?.length || 0,
        executionTimeMs: Math.round(execTime),
        parallelBuild: wasParallelBuild ? {
          totalSections: result.stats?.totalTasks,
          successfulSections: result.stats?.successfulTasks,
          progressiveRendering: alreadyExecutedProgressively,
          complete: true
        } : undefined
      }));

      // Don't speak on completion - the progress indicator and visible scene are enough
      // Hon will respond naturally via the tool response if user asks

      // Capture timeline snapshot after successful execution
      // Wait longer for parallel builds (many entities materializing)
      const snapshotDelay = wasParallelBuild ? 5000 : 2000;
      setTimeout(async () => {
        try {
          const { createImmersiveSceneSnapshot } = await import('../utils/canvasHistory');
          await createImmersiveSceneSnapshot(intent.substring(0, 100), 'immersive_execute');
        } catch (e) {
          console.warn('[pc_execute] Failed to capture immersive scene snapshot:', e);
        }
      }, snapshotDelay);

    } catch (error: any) {
      console.error('[pc_execute] Error:', error);
      // Clear parallel build lock on error
      if (this.parallelBuildInProgress) {
        this.parallelBuildInProgress = false;
        console.log('[pc_execute] Parallel build lock released due to error');
      }
      this.sendToolErrorResponse(toolCallId, error.message || 'Failed to execute PlayCanvas command');
    }
  }

  /**
   * Handle pc_look - Visual scene understanding via canvas screenshot
   * 
   * This gives Hon "eyes" to see the PlayCanvas scene:
   * 1. Captures a screenshot of the canvas
   * 2. Sends it to Claude with vision capabilities
   * 3. Returns a description of what's visible
   * 
   * Use cases:
   * - "What do you see?" → Describes the scene
   * - "Delete that thing on the left" → Identifies what's on the left
   * - "Where should I put the tree?" → Suggests placement
   */
  private async handlePlayCanvasLook(toolCallId: string, params: any) {
    const query = params.query || params.question || params.intent || 'What do you see?';
    
    console.log('[pc_look] Looking at scene with query:', query);
    
    // Dispatch event to show vision indicator
    window.dispatchEvent(new CustomEvent('hon-vision-start', { detail: { query } }));
    
    try {
      const { captureSceneScreenshot, analyzeSceneVisual } = 
        await import('./playcanvasMCP/sceneVision');
      
      // Capture the current canvas view
      const screenshot = await captureSceneScreenshot();
      if (!screenshot) {
        window.dispatchEvent(new CustomEvent('hon-vision-end'));
        this.sendToolErrorResponse(toolCallId, 'Cannot capture scene - immersive mode may not be active');
        return;
      }
      
      this.speak('Let me take a look...');
      
      // Analyze with Claude vision
      const analysis = await analyzeSceneVisual(query, screenshot);
      
      console.log('[pc_look] Analysis complete:', analysis.substring(0, 100) + '...');
      
      // Dispatch event to hide vision indicator (with slight delay for UX)
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('hon-vision-end'));
      }, 1500);
      
      this.sendToolSuccessResponse(toolCallId, JSON.stringify({ 
        success: true,
        analysis,
        query 
      }));
      
      // Speak the analysis to the user
      this.speak(analysis);
      
    } catch (error: any) {
      console.error('[pc_look] Error:', error);
      window.dispatchEvent(new CustomEvent('hon-vision-end'));
      this.sendToolErrorResponse(toolCallId, error.message || 'Failed to analyze scene');
    }
  }

  // ============================================
  // PROGRESSIVE TOOL EXECUTORS (for parallel builds)
  // ============================================

  /**
   * Execute particle effect from parallel build task
   * Uses the proper particleSystem library for high-quality effects
   */
  private async executeParticleEffect(app: any, pc: any, params: Record<string, unknown>): Promise<void> {
    const preset = String(params.preset || 'fire');
    const x = Number(params.positionX ?? 0);
    const y = Number(params.positionY ?? 0.5);
    const z = Number(params.positionZ ?? 0);
    const scale = Number(params.scale ?? 1);
    const color = params.color ? String(params.color) : undefined;

    console.log(`[executeParticleEffect] Creating ${preset} particle at (${x}, ${y}, ${z})`);

    try {
      // Use the proper particleSystem library
      const { createParticleEffect } = await import('../lib/playcanvas/particleSystem');

      const entity = createParticleEffect(app, preset as any, { x, y, z }, {
        scale,
        color,
        loop: true,
      });

      if (entity) {
        console.log(`[executeParticleEffect] ${preset} particle added successfully`);
      } else {
        console.warn(`[executeParticleEffect] Failed to create ${preset} particle`);
      }
    } catch (err) {
      console.error(`[executeParticleEffect] Error creating ${preset}:`, err);
    }
  }

  /**
   * Execute gradient sky from parallel build task
   * Uses the proper skyboxLoader library for high-quality skies
   */
  private async executeGradientSky(app: any, pc: any, camera: any, params: Record<string, unknown>): Promise<void> {
    const preset = String(params.preset || 'day');
    console.log(`[executeGradientSky] Setting sky preset: ${preset}`);

    try {
      // Use the proper skyboxLoader library
      const { createGradientSky, applyTimeOfDayLighting } = await import('../lib/playcanvas/skyboxLoader');

      const success = createGradientSky(app, preset as any);

      // Also apply matching lighting for time-of-day presets
      const timePresets = ['dawn', 'morning', 'noon', 'afternoon', 'sunset', 'dusk', 'night', 'midnight'];
      if (timePresets.includes(preset)) {
        applyTimeOfDayLighting(app, preset as any);
      }

      if (success) {
        console.log(`[executeGradientSky] Sky set to ${preset} successfully`);
      } else {
        console.warn(`[executeGradientSky] Failed to set sky to ${preset}`);
      }
    } catch (err) {
      console.error(`[executeGradientSky] Error setting sky to ${preset}:`, err);
    }
  }

  /**
   * Execute mood/lighting change from parallel build task
   */
  private executeMoodChange(app: any, pc: any, camera: any, params: Record<string, unknown>): void {
    const mood = String(params.mood || 'neutral');
    console.log(`[executeMoodChange] Setting mood: ${mood}`);

    // Mood presets affect lighting and tone
    const moodPresets: Record<string, { exposure: number; toneMapping: string; ambient: number[] }> = {
      bright: { exposure: 1.2, toneMapping: 'linear', ambient: [0.6, 0.6, 0.6] },
      moody: { exposure: 0.8, toneMapping: 'aces', ambient: [0.3, 0.25, 0.35] },
      warm: { exposure: 1.0, toneMapping: 'aces', ambient: [0.5, 0.4, 0.35] },
      cool: { exposure: 1.0, toneMapping: 'aces', ambient: [0.35, 0.4, 0.5] },
      dramatic: { exposure: 0.9, toneMapping: 'aces', ambient: [0.25, 0.2, 0.3] },
      neutral: { exposure: 1.0, toneMapping: 'aces', ambient: [0.4, 0.4, 0.4] }
    };

    const config = moodPresets[mood] || moodPresets.neutral;

    if (app.scene) {
      app.scene.ambientLight = new pc.Color(config.ambient[0], config.ambient[1], config.ambient[2]);
      app.scene.exposure = config.exposure;
    }

    console.log(`[executeMoodChange] Mood set to ${mood}`);
  }

  /**
   * Execute weather effect from parallel build task
   * Uses the proper particleSystem library for high-quality weather
   */
  private async executeWeatherEffect(app: any, pc: any, params: Record<string, unknown>): Promise<void> {
    const weatherType = String(params.type || params.preset || 'rain');
    const intensity = Number(params.intensity ?? 1);
    console.log(`[executeWeatherEffect] Adding weather: ${weatherType}`);

    try {
      // Use the proper particleSystem library
      const { createWeatherEffect } = await import('../lib/playcanvas/particleSystem');

      const entity = createWeatherEffect(app, weatherType as any, intensity);

      if (entity) {
        console.log(`[executeWeatherEffect] Weather ${weatherType} added successfully`);
      } else {
        console.warn(`[executeWeatherEffect] Failed to add ${weatherType} weather`);
      }
    } catch (err) {
      console.error(`[executeWeatherEffect] Error adding ${weatherType}:`, err);
    }
  }

  /**
   * Execute light effect from parallel build task
   */
  private async executeLightEffect(app: any, pc: any, params: Record<string, unknown>): Promise<void> {
    const type = String(params.type || 'point');
    const x = Number(params.positionX ?? 0);
    const y = Number(params.positionY ?? 3);
    const z = Number(params.positionZ ?? 0);
    const color = String(params.color || '#ffffff');
    const intensity = Number(params.intensity ?? 1);
    const range = Number(params.range ?? 10);
    const castShadows = Boolean(params.castShadows ?? false);

    console.log(`[executeLightEffect] Adding ${type} light at (${x}, ${y}, ${z})`);

    try {
      const entity = new pc.Entity(`light_${type}_${Date.now()}`);
      entity.setPosition(x, y, z);

      // Parse color
      const hex = color.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16) / 255;
      const g = parseInt(hex.substring(2, 4), 16) / 255;
      const b = parseInt(hex.substring(4, 6), 16) / 255;

      entity.addComponent('light', {
        type: type,
        color: new pc.Color(r, g, b),
        intensity: intensity,
        range: range,
        castShadows: castShadows,
        shadowBias: 0.05,
        normalOffsetBias: 0.05
      });

      app.root.addChild(entity);
      console.log(`[executeLightEffect] ${type} light added successfully`);
    } catch (err) {
      console.error(`[executeLightEffect] Error adding light:`, err);
    }
  }

  /**
   * Execute post-processing from parallel build task
   */
  private async executePostProcessing(app: any, pc: any, params: Record<string, unknown>): Promise<void> {
    console.log('[executePostProcessing] Applying post-processing effects', params);

    try {
      const { setBloom, setVignette, setColorGrading } = await import('../lib/playcanvas/postProcessing');

      // Apply bloom if specified
      if (params.bloomEnabled !== undefined || params.bloomIntensity !== undefined) {
        setBloom(
          params.bloomEnabled !== false,
          Number(params.bloomIntensity ?? 0.3),
          Number(params.bloomThreshold ?? 0.8)
        );
      }

      // Apply vignette if specified
      if (params.vignetteEnabled !== undefined || params.vignetteIntensity !== undefined) {
        setVignette(
          params.vignetteEnabled !== false,
          Number(params.vignetteIntensity ?? 0.3)
        );
      }

      // Apply color grading if specified
      if (params.saturation !== undefined || params.contrast !== undefined || params.brightness !== undefined) {
        setColorGrading(
          Number(params.saturation ?? 1.1),
          Number(params.contrast ?? 1.05),
          Number(params.brightness ?? 1.0)
        );
      }

      console.log('[executePostProcessing] Post-processing applied successfully');
    } catch (err) {
      console.error('[executePostProcessing] Error applying post-processing:', err);
    }
  }

  /**
   * Execute add physics from parallel build task
   */
  private async executeAddPhysics(app: any, pc: any, params: Record<string, unknown>): Promise<void> {
    const entityName = String(params.entityName || '');
    const physicsType = String(params.type || 'static');
    const mass = Number(params.mass ?? 1);
    const friction = Number(params.friction ?? 0.5);
    const restitution = Number(params.restitution ?? 0.3);

    console.log(`[executeAddPhysics] Adding ${physicsType} physics to: ${entityName}`);

    try {
      // Find the entity by name
      const entity = app.root.findByName(entityName) ||
        app.root.find((e: any) => e.name.toLowerCase().includes(entityName.toLowerCase()))?.[0];

      if (!entity) {
        console.warn(`[executeAddPhysics] Entity not found: ${entityName}`);
        return;
      }

      // Add collision component if not present
      if (!entity.collision) {
        entity.addComponent('collision', {
          type: 'box',
          halfExtents: entity.render?.meshInstances?.[0]?.aabb?.halfExtents || new pc.Vec3(0.5, 0.5, 0.5)
        });
      }

      // Add rigidbody component
      if (!entity.rigidbody) {
        entity.addComponent('rigidbody', {
          type: physicsType,
          mass: physicsType === 'dynamic' ? mass : 0,
          friction: friction,
          restitution: restitution,
          linearDamping: Number(params.linearDamping ?? 0.1),
          angularDamping: Number(params.angularDamping ?? 0.1)
        });
      }

      console.log(`[executeAddPhysics] Physics added to ${entityName}`);
    } catch (err) {
      console.error(`[executeAddPhysics] Error adding physics:`, err);
    }
  }

  private async handleTextTo3DTool(toolCallId: string, parameters: any) {
    const startTime = Date.now();
    try {
      const p = typeof parameters === 'string' ? (() => { try { return JSON.parse(parameters); } catch { return {}; } })() : (parameters || {});
      console.log('[text_to_3d] Starting 3D generation with params:', { ...p, prompt: p.prompt?.substring(0, 100) });
      const prompt = String(p.prompt || '').trim();
      if (!prompt) {
        console.error('[text_to_3d] ERROR: Missing prompt');
        throw new Error('Missing 3D object description');
      }

      this.beginExternalTask('generating');
      this.speak(`Starting 3D model generation. This usually takes 2-3 minutes for high quality results.`);

      const { meshyService } = await import('./meshyService');
      console.log('[text_to_3d] Submitting to Meshy API...');
      const requestId = await meshyService.submit(prompt, {
        mode: p.mode || 'full',
        topology: p.topology || 'triangle',
        enable_pbr: p.enable_pbr !== false,
        texture_prompt: p.texture_prompt,
        texture_image_url: p.texture_image_url
      });
      console.log(`[text_to_3d] ✅ Submitted successfully. Request ID: ${requestId}`);
      console.log('[text_to_3d] Now polling for completion...');

      // De-dupe: if we've already completed this request id, stop here
      if (this.completedTextTo3DRequestIds.has(requestId)) {
        console.warn('[text_to_3d] Duplicate completion detected for requestId, ignoring:', requestId);
        this.sendToolSuccessResponse(toolCallId, '3D model is already generated.');
        return;
      }

      let lastLog = '';
      const result = await meshyService.waitForResult(requestId, 5 * 60 * 1000, (msg) => {
        if (msg && msg !== lastLog) {
          lastLog = msg;
          console.log(`[text_to_3d] Progress: ${msg}`);
          try { this.speak(`3D generation: ${msg}`); } catch {}
        }
      });
      
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[text_to_3d] ✅ Generation completed in ${elapsed}s. Result:`, {
        hasModelUrls: !!result?.model_urls,
        hasGlb: !!result?.model_urls?.glb,
        hasThumbnail: !!result?.thumbnail,
        allKeys: Object.keys(result || {})
      });

      const modelUrl = result?.model_urls?.glb?.url || result?.model_glb?.url || '';
      const thumb = result?.thumbnail?.url || '';
      
      if (!modelUrl) {
        console.error('[text_to_3d] ERROR: No model URL in result:', result);
        throw new Error('3D model generation completed but no downloadable model was returned');
      }

      console.log(`[text_to_3d] Model URL: ${modelUrl.substring(0, 80)}...`);
      console.log('[text_to_3d] Placing 3D panel on canvas...');

      // Place as 3D panel in board mode on current page
      try {
        const state = useComicStore.getState() as any;
        const { currentComic, currentPageIndex, updatePanel } = state;
        const pageIndex = currentPageIndex || 0;
        const panel = { 
          id: nanoid(), 
          type: '3d', 
          url: modelUrl, 
          caption: '', // Don't show 3D generation prompt as caption
          size: 'medium', 
          aspectRatio: 1, 
          position: { row: 0, col: 0 }, 
          metadata: { 
            meshyRequestId: requestId, 
            model_urls: result?.model_urls, 
            texture_urls: result?.texture_urls, 
            thumbnail: thumb,
            generatedAt: new Date().toISOString(),
            elapsedSeconds: elapsed,
            generationPrompt: prompt // Store prompt in metadata instead
          } 
        } as any;
        await updatePanel(panel, pageIndex);
        console.log(`[text_to_3d] ✅ 3D panel placed on ${formatPageReference(pageIndex)}`);
        // Trigger board mode so it is visible
        try { document.dispatchEvent(new CustomEvent('enter-board-mode')); } catch {}
        
        // Save to recent generations
        try {
          state.addRecentGeneration({
            url: modelUrl,
            prompt: prompt,
            timestamp: new Date(),
            model: 'Meshy',
            type: '3d',
            metadata: { 
              source: 'text_to_3d',
              meshyRequestId: requestId,
              thumbnail: thumb,
              elapsed_seconds: elapsed
            }
          });
          console.log(`[text_to_3d] ✅ Saved to recent generations`);
        } catch (e) {
          console.warn('[text_to_3d] Failed to save to recent generations:', e);
        }
      } catch (placeErr) { 
        console.error('[text_to_3d] ERROR placing panel on canvas:', placeErr); 
        throw new Error(`3D model generated but failed to place on canvas: ${(placeErr as any)?.message}`);
      }

      const content = JSON.stringify({
        success: true,
        action: 'text_to_3d',
        model_url: modelUrl,
        thumbnail: thumb,
        requestId,
        elapsed_seconds: elapsed,
        message: '3D model generated and placed. Continue to next task silently.'
      });
      this.evi?.socket?.send(JSON.stringify({ type: 'tool_response', tool_call_id: toolCallId, content }));
      // Mark this requestId as completed to guard against duplicate placements
      try { this.completedTextTo3DRequestIds.add(requestId); } catch {}
      this.completeToolCall(toolCallId);
      console.log(`[text_to_3d] ✅ SUCCESS - 3D generation complete in ${elapsed}s`);
    } catch (e:any) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(`[text_to_3d] ❌ FAILED after ${elapsed}s:`, e);
      console.error('[text_to_3d] Error details:', { message: e?.message, name: e?.name, stack: e?.stack?.substring(0, 200) });
      
      try {
        const errContent = JSON.stringify({ success: false, action: 'text_to_3d', error: e?.message || 'text_to_3d_failed', elapsed_seconds: elapsed });
        this.evi?.socket?.send(JSON.stringify({ type: 'tool_response', tool_call_id: toolCallId, content: errContent }));
      } catch {}
      
      const userMsg = e?.message?.includes('timeout') 
        ? 'The 3D generation took too long and timed out. Please try again with a simpler description.'
        : e?.message || '3D generation failed. Please try again or simplify your description.';
      this.sendToolErrorResponse(toolCallId, userMsg);
    } finally {
      this.endExternalTask();
    }
  }

  // Place a 3D model on the world map
  private async handlePlace3DModelOnMap(toolCallId: string, parameters: any) {
    if (!MAP_MODEL_PLACEMENT_AVAILABLE) {
      console.info('[place_3d_model_on_map] not available in this build');
      this.sendToolErrorResponse(toolCallId, 'not_available', PLACE_MODEL_ON_MAP_NOT_AVAILABLE);
      this.speak('Placing a generated 3D model on the map is not available yet. I can still generate a 3D model onto the canvas.');
      return;
    }

    // Guard against duplicate calls FIRST - before any async work
    if (this.place3DModelInProgress) {
      console.log('[place_3d_model_on_map] Already generating a 3D model, skipping duplicate request');
      // Don't speak - just silently complete the duplicate tool call
      const content = JSON.stringify({
        success: false,
        action: 'place_3d_model_on_map',
        error: 'Already generating a 3D model, please wait',
        skipped: true,
      });
      try {
        this.evi?.socket?.send(JSON.stringify({ type: 'tool_response', tool_call_id: toolCallId, content }));
      } catch {}
      this.completeToolCall(toolCallId);
      return;
    }
    
    // Set guard immediately to prevent race conditions
    this.place3DModelInProgress = true;
    
    const startTime = Date.now();
    try {
      const p = typeof parameters === 'string' ? (() => { try { return JSON.parse(parameters); } catch { return {}; } })() : (parameters || {});
      console.log('[place_3d_model_on_map] Starting with params:', p);
      
      const prompt = String(p.prompt || '').trim();
      if (!prompt) {
        this.place3DModelInProgress = false;
        throw new Error('Missing 3D object description');
      }

      // Get current map view for placement location
      const state = useComicStore.getState();
      const { isWorldMode, worldSettings, worldModePreference } = state;
      
      // Check if we're in world map mode
      if (!isWorldMode || worldModePreference !== 'map') {
        // Auto-activate world map mode if not already active
        console.log('[place_3d_model_on_map] Activating world map mode...');
        state.setWorldMode(true);
        state.setWorldModePreference('map');
      }
      
      // Determine placement location
      let placementLat: number;
      let placementLng: number;
      let placementAltitude: number;
      
      if (p.lat !== undefined && p.lng !== undefined) {
        // Use explicit coordinates if provided
        placementLat = Number(p.lat);
        placementLng = Number(p.lng);
        placementAltitude = Number(p.altitude) || 0;
      } else if (p.location) {
        // Geocode the location
        this.speak(`Finding ${p.location} on the map...`);
        const { geocodeQuery } = await import('../lib/googleMaps3d');
        const result = await geocodeQuery(p.location);
        if (!result) {
          throw new Error(`Could not find location: ${p.location}`);
        }
        placementLat = result.location.lat;
        placementLng = result.location.lng;
        placementAltitude = Number(p.altitude) || 50;
        
        // Navigate to the location
        const { pickMapAltitude, estimateMapRange } = await import('../lib/worldMapUtils');
        const camAlt = pickMapAltitude(result.types || []);
        const camRange = estimateMapRange(result.viewport);
        
        state.setWorldSettings({
          mapTarget: {
            query: p.location,
            lat: placementLat,
            lng: placementLng,
            altitude: camAlt,
            heading: 0,
            tilt: 60,
            range: camRange,
            resolvedName: result.formattedAddress,
            types: result.types,
          },
          mapStatus: 'ready',
        });
      } else if (worldSettings.mapView) {
        // Use current camera view center
        placementLat = worldSettings.mapView.lat;
        placementLng = worldSettings.mapView.lng;
        placementAltitude = Number(p.altitude) || 50;
      } else if (worldSettings.mapTarget) {
        // Use target location
        placementLat = worldSettings.mapTarget.lat;
        placementLng = worldSettings.mapTarget.lng;
        placementAltitude = Number(p.altitude) || 50;
      } else {
        throw new Error('No location specified and no map view available. Please specify a location or navigate to a place first.');
      }

      this.beginExternalTask('generating');
      this.speak(`Creating 3D model of ${prompt}. This will take a few minutes.`);

      // Generate the 3D model using Meshy
      const { meshyService } = await import('./meshyService');
      console.log('[place_3d_model_on_map] Submitting to Meshy API...');
      const requestId = await meshyService.submit(prompt, {
        mode: p.mode || 'full',
        topology: p.topology || 'triangle',
        enable_pbr: p.enable_pbr !== false,
      });
      console.log(`[place_3d_model_on_map] Submitted. Request ID: ${requestId}`);

      let lastLog = '';
      const result = await meshyService.waitForResult(requestId, 5 * 60 * 1000, (msg) => {
        if (msg && msg !== lastLog) {
          lastLog = msg;
          console.log(`[place_3d_model_on_map] Progress: ${msg}`);
        }
      });

      // Extract URL from the model_urls object (glb/fbx have a .url property)
      let modelUrl = result?.model_urls?.glb?.url || result?.model_urls?.fbx?.url || result?.model_glb?.url || '';
      const thumb = result?.thumbnail?.url || '';

      console.log('[place_3d_model_on_map] Model URL extracted:', modelUrl ? modelUrl.substring(0, 80) + '...' : 'NONE');

      if (!modelUrl || typeof modelUrl !== 'string') {
        console.error('[place_3d_model_on_map] Invalid model URL:', modelUrl, 'Full result:', JSON.stringify(result?.model_urls || {}).substring(0, 200));
        throw new Error('3D model generation completed but no valid model URL was returned');
      }

      // Google Maps 3D makes credentialed requests (withCredentials: true), which means
      // Access-Control-Allow-Origin: * doesn't work. Both fal.ai and Cloudinary return wildcards.
      // Solution: Proxy the model through our own API endpoint which returns the exact origin.
      const proxyUrl = `/api/proxy-model?url=${encodeURIComponent(modelUrl)}`;
      console.log('[place_3d_model_on_map] Using proxied model URL for Google Maps 3D CORS compatibility');

      // Add the model to the world map
      const modelId = `world-model-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // AI models (Meshy) are often in mm/cm units, NOT meters as glTF standard suggests
      // A typical Meshy model might be 1-10cm tall, so we need scale=200+ to make it visible
      // Default scale of 200 makes a 10cm model appear as ~20 meters tall (clearly visible)
      // Users can adjust via the scale parameter if needed
      const scale = Number(p.scale) || 200;
      
      // Boost altitude by 100m to ensure model is above water/terrain
      // This helps with visibility especially over water like the East River
      const boostedAltitude = placementAltitude + 100;

      const modelData = {
        id: modelId,
        modelUrl: proxyUrl,
        thumbnailUrl: thumb,
        prompt,
        position: {
          lat: placementLat,
          lng: placementLng,
          altitude: boostedAltitude,
        },
        orientation: {
          heading: Number(p.heading) || 0,
          tilt: 0,
          roll: 0,
        },
        scale,
        // ABSOLUTE altitude mode places the model at exact altitude above sea level
        // This is more reliable for visibility than RELATIVE_TO_MESH which can clip into terrain
        altitudeMode: (p.altitudeMode as 'clamp-to-ground' | 'relative-to-ground' | 'relative-to-mesh' | 'absolute') || 'absolute',
        createdAt: new Date().toISOString(),
      };
      
      console.log('[place_3d_model_on_map] Adding model to store:', modelData);
      state.addWorld3DModel(modelData);
      
      // Verify it was added
      const updatedModels = useComicStore.getState().world3DModels;
      console.log('[place_3d_model_on_map] Store now has', updatedModels.length, 'models');

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[place_3d_model_on_map] ✅ Model placed on map in ${elapsed}s`);

      // Removed explicit "Done" - the 3D model appearing on the map is confirmation enough

      const content = JSON.stringify({
        success: true,
        action: 'place_3d_model_on_map',
        model_id: modelId,
        model_url: proxyUrl,
        original_url: modelUrl,
        thumbnail: thumb,
        position: { lat: placementLat, lng: placementLng, altitude: boostedAltitude },
        scale,
        elapsed_seconds: elapsed,
      });
      this.evi?.socket?.send(JSON.stringify({ type: 'tool_response', tool_call_id: toolCallId, content }));
      this.completeToolCall(toolCallId);

    } catch (e: any) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(`[place_3d_model_on_map] ❌ FAILED after ${elapsed}s:`, e);

      try {
        const errContent = JSON.stringify({ success: false, action: 'place_3d_model_on_map', error: e?.message, elapsed_seconds: elapsed });
        this.evi?.socket?.send(JSON.stringify({ type: 'tool_response', tool_call_id: toolCallId, content: errContent }));
      } catch {}

      this.sendToolErrorResponse(toolCallId, e?.message || 'Failed to place 3D model on map');
    } finally {
      this.place3DModelInProgress = false;
      this.endExternalTask();
    }
  }

  // Mood board creation tool - Enhanced with Qwen VL vision, adaptive beats, and multi-reference support
  private async handleCreateMoodBoard(toolCallId: string, parameters: any) {
    // Extract isUiTriggered flag early so it's in scope for catch block
      const p = typeof parameters === 'string' ? (() => { try { return JSON.parse(parameters); } catch { return {}; } })() : (parameters || {});
    const isUiTriggered = p?._uiTriggered === true; // Check if this is a UI-triggered action

    // CONCURRENT GENERATION CHECK: Prevent duplicate moodboard runs
    if (moodboardState.isGenerating) {
      console.log('[AI] create_mood_board BLOCKED: Another moodboard is already generating.');
      const content = JSON.stringify({
        success: false,
        action: 'create_mood_board',
        message: 'A moodboard is already being generated. Please wait for it to complete.',
        blocked: true
      });
      this.evi?.socket?.send(JSON.stringify({ type: 'tool_response', tool_call_id: toolCallId, content }));
      this.completeToolCall(toolCallId);
      return;
    }

    // COOLDOWN CHECK: Prevent endless moodboard generation loops
    const now = Date.now();
    const timeSinceLastMoodboard = now - this.lastMoodboardTimestamp;
    if (timeSinceLastMoodboard < this.MOODBOARD_COOLDOWN_MS) {
      const remainingSecs = Math.ceil((this.MOODBOARD_COOLDOWN_MS - timeSinceLastMoodboard) / 1000);
      console.log(`[AI] create_mood_board COOLDOWN: ${remainingSecs}s remaining. Skipping to prevent loop.`);
      // Send a friendly response instead of creating another moodboard
      const content = JSON.stringify({ 
        success: false, 
        action: 'create_mood_board', 
        message: `Moodboard was just created. Please wait ${remainingSecs} seconds before creating another.`,
        cooldown: true 
      });
      this.evi?.socket?.send(JSON.stringify({ type: 'tool_response', tool_call_id: toolCallId, content }));
      this.completeToolCall(toolCallId);
      return;
    }
    
    // Update timestamp at the start of generation
    this.lastMoodboardTimestamp = now;
    
    // Set flag to suppress auto-captioning/detection during moodboard (includes cooldown)
    moodboardState.start();
    
    try {
      // Target tile count: 6 images + 1 palette panel (2 rows × 3 cols + palette)
      const count: number = 6;
      const aspect: string = '1:1';
      const stylePrompt: string = typeof p?.style_prompt === 'string' ? p.style_prompt.trim() : '';
      // Remember the raw moodboard intent for Notion summary
      try { this.lastMoodboardPrompt = stylePrompt || ''; } catch {}

      const state = useComicStore.getState() as State;
      const currentPage = state.currentPageIndex;
      const panels = state.currentComic?.pages[currentPage] || [];

      // Multi-reference support: collect all specified reference images
      const referenceUrls: string[] = [];
      
      // Check for explicitly provided reference URLs (array or single)
      if (Array.isArray(p?.reference_image_urls)) {
        referenceUrls.push(...p.reference_image_urls.filter((u: any) => typeof u === 'string' && u.startsWith('http')));
      } else if (typeof p?.reference_image_url === 'string' && p.reference_image_url.startsWith('http')) {
        referenceUrls.push(p.reference_image_url);
      }
      
      // Check for target element IDs (can be array or single)
      const targetIds = Array.isArray(p?.target_element_ids) ? p.target_element_ids : 
                        (typeof p?.target_element_id === 'string' ? [p.target_element_id] : []);
      for (const tid of targetIds) {
        const t = this.findPanelBySemanticId(tid, panels);
        if (t && t.url && !referenceUrls.includes(t.url)) referenceUrls.push(t.url);
      }
      
      // Fallback: find any image on the page if we still don't have references
      if (referenceUrls.length === 0) {
        const firstImg = panels.find(x => x && x.type === 'image' && x.url);
        if (firstImg) {
          referenceUrls.push(firstImg.url);
          console.log(`[AI] create_mood_board fallback: using first available image on page: ${firstImg.id}`);
        }
      }
      
      if (referenceUrls.length === 0) {
        this.sendToolErrorResponse(toolCallId, 'No reference image found on canvas. Please add an image first.');
        return;
      }
      
      console.log(`[AI] create_mood_board using ${referenceUrls.length} reference(s):`, referenceUrls.map(u => u.slice(0, 60)));

      // Ensure board mode + collapse side UI
      try { if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('enter-board-mode')); } catch {}
      try { if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('side-menu-set-collapsed', { detail: { collapsed: true } })); } catch {}
      try { if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('page-manager-set-collapsed', { detail: { collapsed: true } })); } catch {}

      // Only show Hon indicator if this was triggered by Hon (not by the UI button)
      // Use beginExternalTask to prevent other events from overriding the indicator state
      if (!isUiTriggered) {
      this.beginExternalTask('generating');
      }

      // Enhanced scene analysis using OpenRouter Vision (Qwen VL) for adaptive beats
      let sceneAnalysis: { 
        type: 'portrait' | 'product' | 'environment' | 'lifestyle' | 'abstract' | 'group' | 'unknown';
        subjects: string[];
        objects: string[];
        setting: string;
        mood: string;
        colors: string[];
        description: string;
      } = { type: 'unknown', subjects: [], objects: [], setting: '', mood: '', colors: [], description: '' };
      
      try {
        const visionPrompt = `Analyze this image for a moodboard. Respond in JSON only (no markdown):
{
  "type": "portrait|product|environment|lifestyle|abstract|group",
  "subjects": ["list of people/characters if any"],
  "objects": ["key objects, products, or items"],
  "setting": "location/environment description",
  "mood": "emotional tone/atmosphere",
  "colors": ["dominant colors"],
  "description": "brief scene description"
}`;
        
        const visionResp = await fetch('/api/fal/openrouter-vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_urls: referenceUrls.slice(0, 4), // Send up to 4 references for analysis
            prompt: visionPrompt,
            system_prompt: 'You are an expert visual analyst. Respond only with valid JSON, no markdown or explanation.',
            model: 'qwen/qwen3-vl-235b-a22b-instruct',
            temperature: 0.3
          })
        });
        
        if (visionResp.ok) {
          const visionData = await visionResp.json();
          const output = visionData?.output || '';
          // Parse JSON from response (handle potential markdown wrapping)
          const jsonMatch = output.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              sceneAnalysis = { ...sceneAnalysis, ...JSON.parse(jsonMatch[0]) };
              console.log('[AI] create_mood_board Qwen VL analysis:', sceneAnalysis);
            } catch {}
          }
        }
      } catch (e) {
        console.warn('[AI] create_mood_board vision analysis failed, using fallback:', e);
      }
      
      // Build scene description from analysis
      const sceneBase = sceneAnalysis.description || sceneAnalysis.setting || 'same scene';
      const paletteHints = sceneAnalysis.colors.length > 0 
        ? sceneAnalysis.colors.slice(0, 3).join(', ') 
        : '';

      // Identity/Object lock text applied to every variant
      const subjectLock = sceneAnalysis.subjects.length > 0 
        ? `Preserve the EXACT same ${sceneAnalysis.subjects.join(', ')} — same faces, expressions, poses, clothing, and accessories.`
        : '';
      const objectLock = sceneAnalysis.objects.length > 0
        ? `Keep the SAME ${sceneAnalysis.objects.slice(0, 5).join(', ')} with identical details, brands, and appearance.`
        : '';
      const identityLock = [subjectLock, objectLock].filter(Boolean).join(' ') || 
        `Preserve the EXACT same people and objects from the reference — same faces, skin tones, hair, accessories, logos, wardrobe colors, and the SAME hero objects. Do NOT add or remove people or objects.`;
      const negatives = `no grid, no collage, no multiple images, no split screen, no panels, no frames, no moodboard layout, no triptych, no diptych, single continuous image only, no extra people, no strangers, no watermark, no logos change`;

      // WORLDBUILDING BEATS - expand the environment/world from the reference
      // Each beat has { prompt, includeIdentity } to control whether characters appear
      const beats = this.generateWorldbuildingBeats(sceneAnalysis);

      // Storyboard slot positions - 6 panels arranged in 2 rows × 3 cols
      // Based on BOARD_CELL_W=307, BOARD_ITEM_SCALE=1.19, spacing=32 → ~397px per cell
      // For 6 panels: cols=3, spacing centered
      const storyboardSlots = [
        { x: -397, y: -198 },  // 0: row 0, col 0
        { x: 0, y: -198 },     // 1: row 0, col 1
        { x: 397, y: -198 },   // 2: row 0, col 2
        { x: -397, y: 198 },   // 3: row 1, col 0
        { x: 0, y: 198 },      // 4: row 1, col 1
        { x: 397, y: 198 },    // 5: row 1, col 2
      ];

      // Launch Seedream v4.5 edits in parallel (one per beat) – each as a new panel
      // Seedream is optimized for batch generation with better quality and speed
      console.log(`[AI] create_mood_board launching ${Math.min(beats.length, count)} Seedream jobs`);
      const jobs: Array<Promise<{ url: string; idx: number }>> = beats.slice(0, count).map(async (beat, idx) => {
        console.log(`[AI] create_mood_board job ${idx + 1}/${count} starting (Seedream v4.5)`);
        // Only apply identity lock for shots that should include characters/objects
        const identityText = beat.includeIdentity ? identityLock : 'NO people, NO characters, NO vehicles in this shot.';
        // CRITICAL: Start prompt with single-image instruction to prevent collage/grid outputs
        const singleImagePrefix = 'ONE single continuous photograph, NOT a collage, NOT a grid, NOT multiple panels, NOT split screen. ';
        const prompt = `${singleImagePrefix}${stylePrompt ? stylePrompt + ', ' : ''}${sceneBase}. ${beat.prompt}. ${identityText}${paletteHints ? ' Colors: ' + paletteHints + '.' : ''} Negative: ${negatives}.`;
        try {
          const resp = await fetch('/api/fal/seedream-edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt,
              image_urls: referenceUrls.slice(0, 4), // Use all reference images (up to 4)
              num_images: 1
            })
          });
          if (!resp.ok) {
            const err = await resp.text().catch(()=> 'Seedream v4.5 edit failed');
            console.error(`[AI] create_mood_board job ${idx + 1} HTTP error:`, err);
            throw new Error(err);
          }
          const data = await resp.json();
          // Seedream returns { images: [...], imageUrl: first }
          const url = data?.imageUrl || data?.images?.[0]?.url;
          if (!url) {
            console.error(`[AI] create_mood_board job ${idx + 1} no URL in response:`, data);
            throw new Error('No image URL');
          }
          console.log(`[AI] create_mood_board job ${idx + 1}/${count} completed (Seedream)`);
          return { url, idx };
        } catch (jobErr) {
          console.error(`[AI] create_mood_board job ${idx + 1}/${count} failed:`, jobErr);
          throw jobErr;
        }
      });

      const createdIds: string[] = [];
      await Promise.allSettled(jobs.map(p => p.then(async ({ url, idx }) => {
          const id = nanoid();
          const panel: Panel = { id, type: 'image', url, caption: stylePrompt || '', size: 'medium', aspectRatio: 1, position: { row: 0, col: 0 } };
          await (useComicStore.getState() as any).updatePanel(panel, currentPage);
          createdIds.push(id);
          // Position panel immediately in storyboard slot to avoid overlap
          const slot = storyboardSlots[idx] || { x: idx * 397 - 595, y: 198 };
          const posMap: any = {}; posMap[id] = slot;
          try { if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('board-layout-apply', { detail: { positions: posMap } })); } catch {}
      })));

      if (createdIds.length === 0) {
        this.sendToolErrorResponse(toolCallId, 'All image edits failed');
        return;
      }

      // Palette extraction from all media (only images sampled; simple and robust)
      const urlsForPalette = (useComicStore.getState() as any).currentComic.pages[currentPage]
        .filter((p: Panel) => p.type === 'image' || p.type === 'video')
        .map((p: Panel) => p.url)
        .slice(0, 12);
      const colors = await this.extractPaletteFromUrls(urlsForPalette, 7, referenceUrls[0]);
      const paletteId = nanoid();
      const palettePanel: Panel = {
        id: paletteId,
        type: 'palette',
        url: JSON.stringify({ colors }),
        caption: '',
        size: 'medium',
        aspectRatio: 1,
        position: { row: 0, col: 0 }
      };
      await (useComicStore.getState() as any).updatePanel(palettePanel, currentPage);
      // Position palette to the right of the 2×3 grid (acts as 7th slot)
      const palettePos = { x: 794, y: 198 };
      const palettePosMap: any = {}; palettePosMap[paletteId] = palettePos;
      try { if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('board-layout-apply', { detail: { positions: palettePosMap } })); } catch {}

      // Respond to tool - complete the external task to release the indicator
      if (!isUiTriggered) {
      this.completeExternalTask();
      }
      const content = JSON.stringify({ success: true, action: 'create_mood_board', images: createdIds.length, has_video: false, palette: colors });
      this.evi?.socket?.send(JSON.stringify({ type: 'tool_response', tool_call_id: toolCallId, content }));
      this.completeToolCall(toolCallId);
      
      // Clear moodboard generation flag (starts cooldown to prevent immediate auto-analysis)
      moodboardState.end();
    } catch (e: any) {
      // Clear moodboard generation flag on error too
      moodboardState.end();

      if (!isUiTriggered) {
      this.completeExternalTask();
      }
      this.sendToolErrorResponse(toolCallId, e?.message || 'Mood board creation failed');
    }
  }

  /**
   * Generate WORLDBUILDING beats that expand the environment/world from the reference
   *
   * Returns beats with { prompt, includeIdentity } so we know which shots should
   * preserve characters/objects and which should be environment-only.
   *
   * TRUE WORLDBUILDING means some shots have NO characters - just the world itself.
   */
  private generateWorldbuildingBeats(analysis: {
    type: string;
    subjects: string[];
    objects: string[];
    setting: string;
    mood: string;
  }): Array<{ prompt: string; includeIdentity: boolean }> {
    const setting = analysis.setting || 'this environment';
    const mood = analysis.mood || 'atmospheric';
    const subjects = analysis.subjects.slice(0, 2).join(' and ') || 'the characters';
    const objects = analysis.objects.slice(0, 3).join(', ') || 'the objects';

    // Worldbuilding beats - mix of environment-only and character shots
    // includeIdentity: false = ENVIRONMENT ONLY, no characters/vehicles
    // includeIdentity: true = include the main subjects
    return [
      // 1. ENVIRONMENT ONLY - What's beyond the frame? NO characters.
      {
        prompt: `EMPTY ENVIRONMENT: The ${setting} with NO people, NO characters, NO vehicles. Just the landscape, architecture, and atmosphere. Pan camera to show what exists BEYOND the original frame. Same lighting, same world, empty and vast.`,
        includeIdentity: false
      },

      // 2. ENVIRONMENTAL DETAIL - Close-up of world details, NO characters
      {
        prompt: `ENVIRONMENTAL DETAIL: Extreme close-up of a surface or object in ${setting}. Weathered textures, signage, debris, or architectural detail. NO people, NO vehicles. Just the world's texture and story.`,
        includeIdentity: false
      },

      // 3. WIDE ESTABLISHING - Characters tiny in vast world
      {
        prompt: `EPIC WIDE SHOT: Dramatically pull back. ${subjects} appear TINY in the vast expanse of ${setting}. Environment dominates 90% of frame. Cinematic scale.`,
        includeIdentity: true
      },

      // 4. DIFFERENT TIME - Same place, different atmosphere, NO characters
      {
        prompt: `TIME SHIFT: The ${setting} at a completely different time of day - dramatic sunset, blue hour, or night. NO people, NO vehicles. Just the environment transformed by different lighting. ${mood} mood intensified.`,
        includeIdentity: false
      },

      // 5. ADJACENT SPACE - Nearby location, NO characters
      {
        prompt: `ADJACENT LOCATION: A different area in the same world - around the corner, over the hill, nearby but NOT the same spot. Same aesthetic and color palette. NO people, NO vehicles. Pure environment exploration.`,
        includeIdentity: false
      },

      // 6. HERO OBJECT - Feature the main vehicle/object
      {
        prompt: `OBJECT FEATURE: ${objects} as the hero of the shot. Different angle, dramatic lighting. The object tells the story. Environment visible but object dominates.`,
        includeIdentity: true
      },
    ];
  }

  // Keep old function as alias for backwards compatibility (returns just prompts)
  private generateAdaptiveBeats(analysis: {
    type: string;
    subjects: string[];
    objects: string[];
    setting: string;
    mood: string;
  }): string[] {
    return this.generateWorldbuildingBeats(analysis).map(b => b.prompt);
  }

  // Basic palette extractor: fetch as blobs, sample pixels, k-means in RGB
  // Optimized to process images in parallel for faster extraction
  private async extractPaletteFromUrls(urls: string[], k: number = 6, referenceUrl?: string): Promise<string[]> {
    try {
      const all = referenceUrl ? [referenceUrl, ...urls] : urls;
      // Limit to first 6 images for performance
      const limitedUrls = all.slice(0, 6);

      // Process images in parallel
      const imageResults = await Promise.allSettled(
        limitedUrls.map(async (u, idx) => {
          const resp = await fetch(u);
          if (!resp.ok) return null;
          const blob = await resp.blob();
          const bmp = await createImageBitmap(blob);
          const cnv = document.createElement('canvas');
          cnv.width = 100; cnv.height = Math.max(1, Math.round((bmp.height / bmp.width) * 100));
          const ctx = cnv.getContext('2d');
          if (!ctx) return null;
          ctx.drawImage(bmp, 0, 0, cnv.width, cnv.height);
          const { data } = ctx.getImageData(0, 0, cnv.width, cnv.height);
          // Sample every 16th pixel (faster)
          const step = 64;
          const weight = (referenceUrl && idx === 0) ? 2 : 1;
          const samples: number[][] = [];
          for (let i = 0; i < data.length; i += step) {
            const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
            if (a < 128) continue;
            for (let w = 0; w < weight; w++) samples.push([r, g, b]);
          }
          return samples;
        })
      );

      // Collect all samples from successful fetches
      const samples: number[][] = [];
      for (const result of imageResults) {
        if (result.status === 'fulfilled' && result.value) {
          samples.push(...result.value);
        }
      }

      if (samples.length === 0) return ['#888888'];
      // k-means
      const centers: number[][] = samples.slice(0, k);
      const dist = (a: number[], b: number[]) => {
        const dr = a[0]-b[0], dg=a[1]-b[1], db=a[2]-b[2]; return dr*dr+dg*dg+db*db;
      };
      for (let iter=0; iter<12; iter++) {
        const sums = Array.from({length:k},()=>[0,0,0,0]);
        for (const s of samples) {
          let m=0, md=Infinity; for (let i=0;i<k;i++){ const d=dist(s,centers[i]); if(d<md){md=d; m=i;} }
          sums[m][0]+=s[0]; sums[m][1]+=s[1]; sums[m][2]+=s[2]; sums[m][3]+=1;
        }
        for (let i=0;i<k;i++){ if(sums[i][3]>0){ centers[i]=[sums[i][0]/sums[i][3], sums[i][1]/sums[i][3], sums[i][2]/sums[i][3]]; }}
      }
      const hex = (r:number,g:number,b:number)=>'#'+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
      const unique: string[] = [];
      for (const c of centers) {
        const h = hex(c[0], c[1], c[2]);
        if (!unique.includes(h)) unique.push(h);
      }
      return unique.slice(0, k);
    } catch { return ['#888888']; }
  }

  // New tool: seedream_reference_generate
  private async handleSeedreamReferenceGenerate(toolCallId: string, parameters: any) {
    try {
      let parsedParams = parameters;
      if (typeof parameters === 'string') {
        try { parsedParams = JSON.parse(parameters); } catch { parsedParams = {}; }
      }
      const prompt: string = parsedParams?.prompt || '';
      const target_element_id: string | undefined = parsedParams?.target_element_id;
      if (!prompt) {
        this.sendToolErrorResponse(toolCallId, 'Missing required parameter: prompt');
        return;
      }

      // Collect all image URLs on current page as references
      const state = useComicStore.getState() as State;
      const panels = state.currentComic?.pages[state.currentPageIndex] || [];
      const refs: string[] = panels
        .filter(p => p && p.type === 'image' && typeof p.url === 'string' && p.url.length > 0)
        .map(p => p.url);
      if (refs.length === 0) {
        this.sendToolErrorResponse(toolCallId, 'No reference images found on the canvas');
        return;
      }

      this.updateVisualIndicator(true, 'generating');

      // Call backend Seedream edit endpoint with all on-canvas images as image_urls
      const resp = await fetch('/api/fal/seedream-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, image_urls: refs })
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => 'Seedream reference generate failed');
        throw new Error(errText);
      }
      const data = await resp.json();
      const resultUrl: string | undefined = data.imageUrl;
      if (!resultUrl) throw new Error('No image URL from Seedream');

      // Place on canvas: if target provided, update it; else next available
      const currentPage = state.currentPageIndex;
      let placed = false;
      if (target_element_id) {
        const target = this.findPanelBySemanticId(target_element_id, panels);
        if (target) {
          const updated = { ...target, url: resultUrl, caption: prompt };
          await (useComicStore.getState() as any).updatePanel(updated, currentPage);
          placed = true;
        }
      }
      if (!placed) {
        const next = this.findNextAvailablePanel(panels);
        if (next) {
          await (useComicStore.getState() as any).updatePanel(next, currentPage);
          const updatedNext = { ...next, url: resultUrl, caption: prompt };
          await (useComicStore.getState() as any).updatePanel(updatedNext, currentPage);
          placed = true;
        }
      }
      if (!placed) {
        const newPanel: Panel = { id: nanoid(), type: 'image', url: resultUrl, caption: prompt, size: 'medium', aspectRatio: 1, position: { row: 0, col: 0 } };
        await (useComicStore.getState() as any).updatePanel(newPanel, currentPage);
      }

      // Respond success
      this.updateVisualIndicator(true, 'inspiring');
      const content = JSON.stringify({ success: true, action: 'seedream_reference_generate', result_url: resultUrl, refs_count: refs.length });
      this.evi?.socket?.send(JSON.stringify({ type: 'tool_response', tool_call_id: toolCallId, content }));
      this.completeToolCall(toolCallId);
    } catch (e:any) {
      this.updateVisualIndicator(true, 'idle');
      this.sendToolErrorResponse(toolCallId, e?.message || 'Seedream reference generate failed');
    }
  }

  // New: Add Sound Effects tool handler
  private async handleAddSoundEffectsTool(toolCallId: string, params: any) {
    try {
      const { action, target_element_id, input_video_url, text_prompt, num_samples, seed, duration_seconds } = params || {};
      // Accept either explicit action or empty (some configs omit it)
      if (action && action !== 'add_sound_effects') {
        console.warn('[AI] sfx_tool unexpected_action', { action });
      }
      console.log('[AI] sfx_tool start', { id: toolCallId });

      // Resolve target panel and video URL
      const state = useComicStore.getState() as State;
      const currentPage = state.currentPageIndex;
      const panels = state.currentComic?.pages[currentPage] || [];
      let targetPanel: Panel | null = null;
      if (target_element_id) {
        targetPanel = this.findPanelBySemanticId(target_element_id, panels);
      }
      // Fallback: first video panel on page
      if (!targetPanel) {
        targetPanel = panels.find(p => p && p.type === 'video') || null;
      }
      const videoUrl = (typeof input_video_url === 'string' && input_video_url) || targetPanel?.url;
      if (!videoUrl) {
        this.sendToolErrorResponse(toolCallId, 'No target video found');
        return;
      }

      const targetPanelId = targetPanel?.id || null;
      if (targetPanelId) {
        // show progress on the panel and indicator
        this.updateVisualIndicator(true, 'processing');
        useComicStore.getState().setPanelGenerationProgress(targetPanelId, true, 'Adding sound effects...');
      }

      // Determine duration: prefer provided, else try to read from DOM video element
      let duration = typeof duration_seconds === 'number' ? duration_seconds : undefined;
      if (!duration && typeof document !== 'undefined') {
        try {
          const vids = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
          const el = vids.find(v => v.currentSrc === videoUrl || v.src === videoUrl);
          if (el && isFinite(el.duration) && el.duration > 0) {
            duration = Math.floor(el.duration);
          }
        } catch {}
      }

      // Always fetch a fresh video-understanding caption for SFX prompting
      let prompt = '';
      try {
        const vuRes = await fetch('/api/fal/video-understanding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoUrl: videoUrl,
            prompt: 'Briefly caption the on-screen actions and ambience for sound design sync.'
          })
        });
        if (vuRes.ok) {
          const vuJson = await vuRes.json();
          const analysisText = (vuJson?.analysis || '').toString().trim();
          if (analysisText) {
            prompt = `Synced cinematic SFX for this scene: ${analysisText}. Emphasize natural actions and environment. No music, no speech.`;
          }
        }
      } catch (e) {
        console.warn('Video understanding caption fetch failed for SFX; will fallback to panel caption:', e);
      }
      // Fallback to any stored caption if video understanding unavailable
      if (!prompt) {
        const fallbackCaption = (targetPanel?.aiCaption || targetPanel?.caption || '').trim();
        if (fallbackCaption) {
          prompt = `Synced cinematic SFX for this scene: ${fallbackCaption}. Emphasize natural actions and environment. No music, no speech.`;
        }
      }
      // Append any tool-specified user guidance last
      if (typeof text_prompt === 'string' && text_prompt.trim()) {
        prompt = prompt
          ? `${prompt} Additional guidance: ${text_prompt.trim()}`
          : text_prompt.trim();
      }
      if (!prompt) {
        prompt = 'Synced cinematic sound effects. Natural, no music, no speech.';
      }

      // Submit SFX job
      const submitRes = await fetch('/api/sfx/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_url: videoUrl,
          text_prompt: prompt,
          ...(typeof num_samples === 'number' ? { num_samples } : {}),
          ...(typeof seed === 'number' ? { seed } : {}),
          ...(typeof duration === 'number' ? { duration } : {})
        })
      });
      if (submitRes.status !== 202) {
        const err = await submitRes.json().catch(() => ({} as any));
        throw new Error(err.error || 'SFX submit failed');
      }
      const { request_id } = await submitRes.json();

      // Poll status
      let audioUrl: string | null = null;
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const statusRes = await fetch(`/api/sfx/status?requestId=${encodeURIComponent(request_id)}`);
        if (!statusRes.ok) continue;
        const status = await statusRes.json();
        if (status?.status === 'COMPLETED' && status?.result?.audio?.length) {
          audioUrl = status.result.audio[0].url;
          break;
        }
      }
      if (!audioUrl) throw new Error('SFX generation timed out');

      // Mux audio with video
      const muxRes = await fetch('/api/sfx/mux', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_url: videoUrl, audio_url: audioUrl, duration, persist: true })
      });
      if (!muxRes.ok) {
        const err = await muxRes.json().catch(() => ({} as any));
        throw new Error(err.error || 'SFX mux failed');
      }
      const { videoUrl: muxedUrl } = await muxRes.json();

      // Update panel on canvas
      if (targetPanelId) {
        const nowState = useComicStore.getState() as State;
        const currPage = nowState.currentPageIndex;
        const currPanels = nowState.currentComic?.pages[currPage] || [];
        const found = currPanels.find(p => p.id === targetPanelId) || null;
        if (found) {
          // call updatePanel from store instance
          await (useComicStore.getState() as any).updatePanel({ ...found, url: muxedUrl, type: 'video' }, currPage);
        }
        useComicStore.getState().clearPanelGenerationProgress(targetPanelId);
      }

      this.updateVisualIndicator(true, 'inspiring');
      console.log('[AI] sfx_tool success', { id: toolCallId });
      this.sendToolSuccessResponse(toolCallId, 'Sound effects applied. Continue to next task silently.');
    } catch (e: any) {
      console.error('[AI] sfx_tool error', { id: toolCallId, message: e?.message || e });
      // Ensure panel overlay and indicator are cleared on failure
      try {
        const tpid = (typeof (params?.target_element_id) === 'string') ? params.target_element_id : null;
        if (tpid) {
          useComicStore.getState().clearPanelGenerationProgress(tpid);
        }
      } catch {}
      this.updateVisualIndicator(true, 'idle');
      this.sendToolErrorResponse(toolCallId, e?.message || 'SFX tool failed');
    }
  }

  // --- Memory tool handlers ---
  private async handleMemoryPut(toolCallId: string, parameters: any) {
    try {
      const p = typeof parameters === 'string' ? JSON.parse(parameters) : parameters || {};
      const result = await memoryService.put({
        key: p.key,
        value: p.value || {},
        tags: p.tags,
        importance: p.importance,
        scope: p.scope,
        projectId: p.projectId,
      });
      const content = JSON.stringify({ success: !!result });
      this.evi?.socket?.send(JSON.stringify({ type: 'tool_response', tool_call_id: toolCallId, content }));
      this.completeToolCall(toolCallId);
    } catch (e:any) {
      this.sendToolErrorResponse(toolCallId, e?.message || 'memory_put failed');
    }
  }

  private async handleMemoryGet(toolCallId: string, parameters: any) {
    try {
      const p = typeof parameters === 'string' ? JSON.parse(parameters) : parameters || {};
      const result = await memoryService.get(p.key);
      const content = JSON.stringify({ memory: result });
      this.evi?.socket?.send(JSON.stringify({ type: 'tool_response', tool_call_id: toolCallId, content }));
      this.completeToolCall(toolCallId);
    } catch (e:any) {
      this.sendToolErrorResponse(toolCallId, e?.message || 'memory_get failed');
    }
  }

  private async handleMemorySearch(toolCallId: string, parameters: any) {
    try {
      const p = typeof parameters === 'string' ? JSON.parse(parameters) : parameters || {};
      const result = await memoryService.search({ tag: p.tag, limit: p.limit });
      const content = JSON.stringify({ memories: result });
      this.evi?.socket?.send(JSON.stringify({ type: 'tool_response', tool_call_id: toolCallId, content }));
      this.completeToolCall(toolCallId);
    } catch (e:any) {
      this.sendToolErrorResponse(toolCallId, e?.message || 'memory_search failed');
    }
  }

  // Handle find_similar_panels tool - arranges similar panels together
  private async handleFindSimilarPanels(toolCallId: string, parameters: any) {
    try {
      const p = typeof parameters === 'string' ? JSON.parse(parameters) : parameters || {};
      const layoutType = p?.layout_type || p?.layoutType || 'grid';
      const normalizedType = layoutType.toLowerCase().trim();

      // Map to similarity-based arrangement
      let eventName = '';
      if (normalizedType === 'grid' || normalizedType.includes('grid')) {
        eventName = 'board-arrange-similar-grid';
      } else if (normalizedType === 'timeline' || normalizedType.includes('timeline')) {
        eventName = 'board-arrange-similar-timeline';
      } else if (normalizedType === 'storyboard' || normalizedType.includes('storyboard')) {
        eventName = 'board-arrange-similar-storyboard';
      } else if (normalizedType === 'cluster' || normalizedType.includes('cluster')) {
        eventName = 'board-arrange-similar-cluster';
      } else {
        // Default to grid
        eventName = 'board-arrange-similar-grid';
      }

      // Dispatch the event to trigger similarity-based arrangement
      if (typeof document !== 'undefined' && eventName) {
        document.dispatchEvent(new CustomEvent(eventName, { 
          detail: { baseLayoutType: normalizedType } 
        }));
        console.log(`[find_similar_panels] Dispatched similarity arrangement event: ${eventName}`);
      }

      const content = JSON.stringify({
        success: true,
        action: 'arrange_similar_panels',
        layout_type: normalizedType,
        message: 'Panels grouped by similarity and arranged'
      });

      this.evi?.socket?.send(JSON.stringify({ type: 'tool_response', tool_call_id: toolCallId, content }));
      this.completeToolCall(toolCallId);
    } catch (e: any) {
      console.error('[find_similar_panels] Error:', e);
      this.sendToolErrorResponse(toolCallId, e?.message || 'find_similar_panels failed');
    }
  }

  private async handleMemoryDelete(toolCallId: string, parameters: any) {
    try {
      const p = typeof parameters === 'string' ? JSON.parse(parameters) : parameters || {};
      const ok = await memoryService.delete(p.key);
      const content = JSON.stringify({ success: ok });
      this.evi?.socket?.send(JSON.stringify({ type: 'tool_response', tool_call_id: toolCallId, content }));
      this.completeToolCall(toolCallId);
    } catch (e:any) {
      this.sendToolErrorResponse(toolCallId, e?.message || 'memory_delete failed');
    }
  }

  private async handleSessionUpsert(toolCallId: string, parameters: any) {
    try {
      const p = typeof parameters === 'string' ? JSON.parse(parameters) : parameters || {};
      await memoryService.upsertSessionSnapshot(p.snapshot || {});
      const content = JSON.stringify({ success: true });
      this.evi?.socket?.send(JSON.stringify({ type: 'tool_response', tool_call_id: toolCallId, content }));
      this.completeToolCall(toolCallId);
    } catch (e:any) {
      this.sendToolErrorResponse(toolCallId, e?.message || 'session_upsert failed');
    }
  }

  private async handleSessionGet(toolCallId: string) {
    try {
      const snap = await memoryService.getSessionSnapshot();
      const content = JSON.stringify({ snapshot: snap });
      this.evi?.socket?.send(JSON.stringify({ type: 'tool_response', tool_call_id: toolCallId, content }));
      this.completeToolCall(toolCallId);
    } catch (e:any) {
      this.sendToolErrorResponse(toolCallId, e?.message || 'session_get failed');
    }
  }
  // Enqueue audio segments for gapless playback (exact same as landing page)
  private enqueueAudioSegment(base64Data: string) {
    try {
      console.log("Converting base64 to audio buffer for gapless queue...");
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      // Strip WAV header to get raw audio data (CRITICAL for preventing thumps)
      const rawAudioData = this.stripWavHeader(bytes);
      console.log(`Stripped WAV header, raw audio: ${rawAudioData.byteLength} bytes`);
      
      // Add to gapless queue and process
      this.audioQueue.push(rawAudioData.buffer as ArrayBuffer);
      this.processGaplessAudioQueue();
    } catch (error) {
      console.error('Error converting base64 to audio buffer:', error);
    }
  }

  // Strip WAV header to get raw PCM data for seamless concatenation (exact same as landing page)
  private stripWavHeader(wavData: Uint8Array): Uint8Array {
    // WAV file structure:
    // Bytes 0-3: "RIFF"
    // Bytes 4-7: File size
    // Bytes 8-11: "WAVE"
    // Bytes 12-15: "fmt "
    // Bytes 16-19: Format chunk size (usually 16)
    // Bytes 20-35: Format data
    // Bytes 36-39: "data"
    // Bytes 40-43: Data chunk size
    // Bytes 44+: Raw audio data
    
    // Find the "data" chunk
    for (let i = 12; i < wavData.length - 4; i++) {
      if (wavData[i] === 0x64 && wavData[i + 1] === 0x61 && 
          wavData[i + 2] === 0x74 && wavData[i + 3] === 0x61) {
        // Found "data" chunk, audio data starts 8 bytes later
        const audioDataStart = i + 8;
        console.log(`Found audio data at offset ${audioDataStart}`);
        return wavData.slice(audioDataStart);
      }
    }
    
    // Fallback: assume standard 44-byte header
    console.log("Using fallback 44-byte header strip");
    return wavData.slice(44);
  }

  // Handle audio interruptions (user speaking, interruption events)
  private handleAudioInterruption() {
    console.log("handleAudioInterruption: Stopping current audio and clearing queue");
    
    // Stop current audio source with short fade-out to prevent clicks
    if (this.currentSource && this.audioContext && this.mainGainNode) {
      try {
        const end = this.audioContext.currentTime + 0.03;
        this.mainGainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
        this.mainGainNode.gain.setValueAtTime(this.mainGainNode.gain.value, this.audioContext.currentTime);
        this.mainGainNode.gain.linearRampToValueAtTime(0.0, end);
        this.currentSource.stop(end);
        this.currentSource.disconnect();
        // Restore main gain for subsequent playback
        this.mainGainNode.gain.setValueAtTime(1.0, end + 0.01);
      } catch (e) {
        console.warn("handleAudioInterruption: Error stopping audio source:", e);
      }
      this.currentSource = null;
    }
    
    // Clear audio queue and reset state
    this.audioQueue = [];
    this.isPlayingAudio = false;
    
    // IMPORTANT: Do NOT affect activeToolCalls - ongoing tool executions continue
    if (this.activeToolCalls.size > 0) {
      console.log(`handleAudioInterruption: ${this.activeToolCalls.size} tool calls still active - these will continue processing`);
    }
    
    console.log("handleAudioInterruption: Audio interrupted and queue cleared");
  }

  // Create continuous audio buffer from raw PCM segments (exact same as landing page)
  private async createContinuousAudioBuffer(rawAudioSegments: ArrayBuffer[]): Promise<AudioBuffer> {
    // Calculate total length
    const crossfadeSamples = Math.floor(0.005 * 44100); // 5ms crossfade
    let sampleCount = 0;
    for (let i = 0; i < rawAudioSegments.length; i++) {
      const segSamples = new Int16Array(rawAudioSegments[i]).length;
      sampleCount += segSamples;
      if (i > 0) sampleCount -= crossfadeSamples; // overlap
    }
    
    console.log(`Creating continuous buffer: ${sampleCount} samples from ${rawAudioSegments.length} segments`);
    
    // Create audio buffer (44.1kHz, mono, 16-bit as per Hume)
    const audioBuffer = this.audioContext!.createBuffer(1, sampleCount, 44100);
    const channelData = audioBuffer.getChannelData(0);
    
    // Concatenate with short crossfades between segments
    let writeIndex = 0;
    for (let s = 0; s < rawAudioSegments.length; s++) {
      const int16Array = new Int16Array(rawAudioSegments[s]);
      const segmentLength = int16Array.length;

      if (s === 0) {
        for (let i = 0; i < segmentLength; i++) {
          channelData[writeIndex++] = int16Array[i] / 32768.0;
        }
      } else {
        const overlap = Math.min(crossfadeSamples, writeIndex, segmentLength);
        // Crossfade: fade out end of previous, fade in start of current
        for (let i = 0; i < overlap; i++) {
          const fadeOutPos = writeIndex - overlap + i;
          const fadeOutGain = 1 - i / overlap;
          const fadeInGain = i / overlap;
          const incoming = int16Array[i] / 32768.0;
          channelData[fadeOutPos] = channelData[fadeOutPos] * fadeOutGain + incoming * fadeInGain;
        }
        // Append remainder of current segment after overlap
        for (let i = overlap; i < segmentLength; i++) {
          channelData[writeIndex++] = int16Array[i] / 32768.0;
        }
      }
    }
    
    console.log(`Continuous buffer created: ${audioBuffer.duration.toFixed(3)}s`);
    return audioBuffer;
  }

  // Continuous buffer processing with zero-click approach (exact same as landing page)
  private async processGaplessAudioQueue() {
    if (this.isPlayingAudio || this.audioQueue.length === 0) {
      if (this.isPlayingAudio) console.log("Continuous audio system active.");
      if (this.audioQueue.length === 0) console.log("Continuous queue empty.");
      return;
    }

    // Initialize professional audio context
    this.initializeContinuousAudioContext();

    if (!this.audioContext) {
      console.error("Cannot process gapless queue - audio context failed");
      return;
    }

    this.isPlayingAudio = true;
    console.log("Starting continuous audio buffer playback...");
    
    // Collect all available segments for continuous playback
    const availableSegments = [...this.audioQueue];
    this.audioQueue = []; // Clear queue
    
    try {
      // Create one continuous buffer from all segments
      const continuousBuffer = await this.createContinuousAudioBuffer(availableSegments);
    
      // Create and configure source with per-source gain for smooth fades
      const source = this.audioContext.createBufferSource();
      source.buffer = continuousBuffer;
      const sourceGain = this.audioContext.createGain();
      sourceGain.gain.setValueAtTime(0.0, this.audioContext.currentTime);
      source.connect(sourceGain);
      sourceGain.connect(this.mainGainNode!);
      
      console.log(`Playing continuous buffer: ${continuousBuffer.duration.toFixed(3)}s`);
      
      // Set up completion handler
      source.onended = () => {
        console.log("Continuous buffer playback complete");
        this.isPlayingAudio = false;
        this.currentSource = null;
        // Check if more segments arrived during playback
        this.processGaplessAudioQueue();
      };
      
      // Start playback with quick fade-in to avoid clicks
      const now = this.audioContext.currentTime;
      source.start(now);
      sourceGain.gain.linearRampToValueAtTime(1.0, now + 0.03);
      this.currentSource = source;
      
    } catch (error) {
      console.error('Error in continuous buffer playback:', error);
      this.isPlayingAudio = false;
      // Try processing any remaining segments
      this.processGaplessAudioQueue();
    }
  }

  // Initialize audio context for continuous buffer playback (exact same as landing page)
  private initializeContinuousAudioContext(): void {
    if (!this.audioContext) {
      try {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 44100,
          latencyHint: 'interactive'
        });
        
        // Create main gain node for volume control
        this.mainGainNode = this.audioContext.createGain();
        this.mainGainNode.gain.setValueAtTime(1.0, this.audioContext.currentTime);
        this.mainGainNode.connect(this.audioContext.destination);
        
        console.log("Continuous audio context initialized for zero-click playback");

        // iOS/Safari: unlock/resume AudioContext on first user gesture
        const resumeOnGesture = () => {
          try { this.audioContext?.resume(); } catch {}
          document.removeEventListener('touchstart', resumeOnGesture);
          document.removeEventListener('click', resumeOnGesture);
        };
        document.addEventListener('touchstart', resumeOnGesture, { once: true });
        document.addEventListener('click', resumeOnGesture, { once: true });
      } catch (error) {
        console.warn("Failed to initialize continuous audio context:", error);
      }
    }
  }

  // NOTE: Removed sendCanvasMetadata - Hume doesn't support custom 'chat_metadata' message type
  // Canvas state is now only sent via the get_canvas_state tool when explicitly requested
  private sendCanvasMetadata(reason: 'session_open' | 'assistant_message_stale' | 'manual'): void {
    // No-op: Hume only accepts: audio_input, session_settings, user_input, assistant_input,
    // tool_response, tool_error, pause_assistant_message, resume_assistant_message
    // Just update local presence instead
    try {
      this.updatePresence({ focusPanelId: null });
    } catch (e) {
      console.warn('sendCanvasMetadata (presence update) failed:', e);
    }
  }

  // --- REMOVED handleScreenStateTool ---

  // Handle getCanvasState tool call - Reads aiCaption FROM STORE STATE
  private async handleCanvasStateTool(toolCallId: string, parameters: any) {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCanvasStateCallTime;
    this.lastCanvasStateCall = now;
    this.lastCanvasStateCallTime = now;
    
    const isInternalRefresh = !!(parameters && typeof parameters === 'object' && (parameters as any)._internalOnly);

    console.log('[AI] get_canvas_state invoked', { 
      toolCallId, 
      ts: this.lastCanvasStateCall,
      timeSinceLastCall,
      internal: isInternalRefresh
    });
    
    if (!isInternalRefresh && (!this.evi || !this.evi.socket)) {
      console.error("Cannot handle canvas state tool: evi or evi.socket is null.");
      return; 
    }
    
    // Show processing state for tool call
    if (!isInternalRefresh) {
      this.updateVisualIndicator(true, 'reasoning');
    }
    console.log('[AI] get_canvas_state start', { id: toolCallId, internal: isInternalRefresh });
    
    try {
      let detail = 'full';
      try {
        if (parameters && typeof parameters === 'object' && parameters.detail) {
          detail = parameters.detail === 'basic' ? 'basic' : 'full';
        }
      } catch (e) {
        console.warn('Failed to parse tool parameters, defaulting to "full" detail:', e);
      }
      
      // Smart auto-detection: frequent calls = send less data for efficiency
      if (timeSinceLastCall < this.FREQUENT_CALL_THRESHOLD && detail === 'full') {
        detail = 'focused';
        console.log('[AI] Frequent call detected, auto-switching to focused context for efficiency');
      }
      
      console.log('[AI] get_canvas_state detail', { detail, auto: timeSinceLastCall < this.FREQUENT_CALL_THRESHOLD });

      // Get current state from Zustand store (already includes aiCaption on panels)
      const state = useComicStore.getState() as State;
      const currentPage = state.currentPageIndex;
      const currentComic = state.currentComic;
      const currentPagePanels = currentComic ? currentComic.pages[currentPage] || [] : [];
      const currentTemplate = currentComic ? currentComic.pageTemplates?.[currentPage] || null : null;

      let responsePayload: any;

      if (detail === 'basic') {
        responsePayload = {
          currentPageIndex: currentPage,
          selectedPanelId: state.selectedPanelId, 
          panelCount: currentPagePanels.length,
          templateName: currentTemplate?.name || null,
          userActionType: state.currentUserAction?.type || null 
        };
      } else if (detail === 'focused') {
        // Focused mode: Only essential context for frequent calls
        console.log('[AI] get_canvas_state focused mode - minimal context');
        
        const isCustomTemplate = currentTemplate?.id === 'custom';
        let orderedPanels: Panel[];
        if (isCustomTemplate) {
          orderedPanels = [...currentPagePanels];
        } else {
          orderedPanels = [...currentPagePanels].sort((a, b) => {
            if (a.position.row !== b.position.row) {
              return a.position.row - b.position.row;
            }
            return a.position.col - b.position.col;
          });
        }
        
        // Only include panels with content (skip empty panels)
        const panelsWithContent = orderedPanels
          .filter(panel => !!panel.url)
          .map((panel, index) => ({
            id: panel.id,
            semanticId: `panel-${index + 1}`,
            type: panel.type,
            urlPreview: panel.url?.substring(0, 30) + '...' || '',
            hasCaption: !!panel.aiCaption,
            isEditable: panel.type === 'image' && !!panel.url
          }));
          
          // Log all captions being sent to Hon
          currentPagePanels.forEach(panel => {
            if (panel.aiCaption) {
              console.log(`[Hon Eyes] 📤 Sending Moondream caption to Hon for panel ${panel.id}: "${panel.aiCaption}"`);
            }
          });
        
        const selectedPanelId = getSelectedPanelId(state);
        const selectedPanel = selectedPanelId ? orderedPanels.find(p => p.id === selectedPanelId) : null;
        const selectedPanelData = selectedPanel ? {
          id: selectedPanel.id,
          semanticId: `panel-${orderedPanels.indexOf(selectedPanel) + 1}`,
          type: selectedPanel.type,
          caption: selectedPanel.caption || '',
          imageCaption: selectedPanel.aiCaption || ''
        } : null;
        
        responsePayload = {
          currentPageIndex: currentPage,
          selectedPanelId: selectedPanelId,
          selectedPanel: selectedPanelData,
          panelsWithContent: panelsWithContent,
          totalPanels: orderedPanels.length,
          editablePanelCount: panelsWithContent.filter(p => p.isEditable).length,
          comicPageCount: currentComic?.pages.length || 0
        };
      } else { // Full detail
        // Keep logs minimal in production
        console.log('[AI] get_canvas_state panels', { count: currentPagePanels.length });
        
        // Detect board mode by checking if a scale/viewport event was recently dispatched
        // Board mode = user zoomed out to see all pages at once (scale <= 0.85)
        let boardModeState: any = null;
        try {
          const boardModeEl = document.querySelector('[data-board-mode-state]');
          if (boardModeEl) {
            boardModeState = JSON.parse(boardModeEl.getAttribute('data-board-mode-state') || '{}');
          }
        } catch {}
        const isInBoardMode = boardModeState?.isInBoardMode || false;
        
        // Check if any panels need captions (with caching to avoid redundant API calls)
        const panelsNeedingCaptions = currentPagePanels.filter(panel => {
          if (panel.type !== 'image' || !panel.url) return false;
          if (!(panel.url.startsWith('http') || panel.url.startsWith('blob:'))) return false;
          if (panel.aiCaption) return false; // Already has caption
          
          // Check cache
          const cached = this.captionCache.get(panel.url);
          if (cached && Date.now() - cached.timestamp < this.CAPTION_CACHE_TTL) {
            // Use cached caption
            panel.aiCaption = cached.caption;
            return false;
          }
          
          return !panel.captionAttempted;
        });
        
        if (panelsNeedingCaptions.length > 0) {
          console.log('[AI] get_canvas_state missing_captions', { 
            count: panelsNeedingCaptions.length,
            cacheSize: this.captionCache.size 
          });
          // Switch to "dreaming" state while fetching captions
          this.updateVisualIndicator(true, 'dreaming');
          
          // Don't await these to avoid blocking the response
          panelsNeedingCaptions.forEach(panel => {
            // Fetch caption and cache it
            useComicStore.getState().fetchAndSetPanelAICaption(panel.id, currentPage)
              .then(() => {
                // Cache the caption for future calls
                const updatedPanel = useComicStore.getState().currentComic?.pages[currentPage]
                  .find(p => p.id === panel.id);
                if (updatedPanel?.aiCaption && panel.url) {
                  this.captionCache.set(panel.url, {
                    caption: updatedPanel.aiCaption,
                    timestamp: Date.now()
                  });
                }
              })
              .catch(err => console.warn('[AI] Caption fetch failed:', err));
          });
        }
        
        // Periodic cache cleanup (remove entries older than TTL)
        if (this.captionCache.size > 100) { // Only cleanup if cache is large
          const now = Date.now();
          for (const [url, entry] of this.captionCache.entries()) {
            if (now - entry.timestamp > this.CAPTION_CACHE_TTL) {
              this.captionCache.delete(url);
            }
          }
        }
        
        // Enhanced panel data with semantic references for better Hon integration
        const isCustomTemplate = currentTemplate?.id === 'custom';
        
        // In board mode, provide ALL panels from ALL pages with their spatial context
        // In focus mode, provide only current page panels (legacy behavior)
        const allPagesData: Array<{pageIndex: number, panels: Panel[], template: any}> = [];
        let allPanelsFlat: Array<Panel & {pageIndex: number, globalIndex: number, indexInPage: number}> = [];
        
        if (isInBoardMode && currentComic) {
          console.log('[AI] Board mode detected - providing all-pages context');
          let globalIdx = 0;
          currentComic.pages.forEach((page, pageIdx) => {
            const pageTemplate = currentComic.pageTemplates?.[pageIdx] || null;
            allPagesData.push({pageIndex: pageIdx, panels: page, template: pageTemplate});
            page.forEach((panel, indexInPage) => {
              allPanelsFlat.push({
                ...panel, 
                pageIndex: pageIdx, 
                indexInPage: indexInPage, // Per-page index for semantic IDs
                globalIndex: globalIdx++
              });
            });
          });
        }
        
        // Create ordered panel list for semantic referencing
        let orderedPanels: Panel[];
        if (isCustomTemplate) {
          // Custom templates: Use creation order (array order)
          orderedPanels = [...currentPagePanels];
        } else {
          // Regular templates: Sort by position (row, col) for grid order
          orderedPanels = [...currentPagePanels].sort((a, b) => {
            if (a.position.row !== b.position.row) {
              return a.position.row - b.position.row;
            }
            return a.position.col - b.position.col;
          });
        }
        
        // Prepare panels data with semantic references and editing context
        const panelsData = orderedPanels.map((panel, index) => {
          // Format captions differently based on availability
          let formattedCaption = panel.caption || '';
          let imageDescription = panel.aiCaption || '';
          
          // Log when sending captions to Hon
          if (panel.aiCaption) {
            console.log(`[Hon Eyes] 📤 Sending Moondream caption to Hon for panel ${panel.id} (panel-${index + 1}): "${panel.aiCaption}"`);
          }
          
          // Determine if panel is suitable for editing
          const isEditable = panel.type === 'image' && !!panel.url;
          const hasContent = !!panel.url;
          
          // Build enhanced description with semantic referencing
          // NOTE: Isaac is now event-driven (triggered only when panel content changes),
          // so we do not trigger it here during routine canvas-state serialization.

          return {
            id: panel.id,
            semanticId: `panel-${index + 1}`, // 1-indexed for Hon: "edit panel-1" (not panel-0)
            type: panel.type,
            url: panel.url || '', // Keep full URL for video understanding tool
            urlPreview: panel.url?.substring(0, 50) + '...' || '', // Truncated for display
            caption: formattedCaption, // User-entered caption/prompt
            imageCaption: imageDescription, // AI-generated caption
            hasCaption: !!panel.aiCaption, // Boolean flag for easy checking
            position: panel.position,
            isEditable: isEditable, // Hon can prioritize editable panels
            hasContent: hasContent, // Whether panel has any content
            panelOrder: index + 1, // 1-based ordering for user-friendly references
            orderingStrategy: isCustomTemplate ? 'creation_order' : 'position_order'
          };
        });
        
        // Add enhanced editing context for Hon's decision making and workflow guidance
        const editablePanels = panelsData.filter(p => p.isEditable);
        const selectedPanelId = getSelectedPanelId(state);
        const selectedPanelSemanticId = selectedPanelId ? 
          panelsData.find(p => p.id === selectedPanelId)?.semanticId : null;
        const mostRecentImagePanel = editablePanels.slice(-1)[0]?.semanticId || null;
        
        const editingContext = {
          editablePanels: editablePanels,
          editablePanelCount: editablePanels.length,
          selectedPanelSemanticId: selectedPanelSemanticId,
          mostRecentImagePanel: mostRecentImagePanel,
          recommendedEditTarget: selectedPanelSemanticId || mostRecentImagePanel,
          
          // Workflow guidance for Hon
          workflowGuidance: {
            nextAction: editablePanels.length > 0 ? 'ready_to_edit' : 'generate_content_first',
            editingInstructions: editablePanels.length > 0 
              ? `Use canvas_editor_tool with action="edit_image" and target_element_id="${selectedPanelSemanticId || mostRecentImagePanel}" to edit existing images`
              : 'No editable images found. Use canvas_editor_tool with action="generate_image" to create new content first',
            targetingNote: 'Always specify target_element_id using semantic IDs like panel-0, panel-1, etc. for accurate results'
          }
        };

        // Build board mode spatial context if applicable
        let boardModeContext: any = null;
        let spatialContext: any = null;
        let allPanelsWithSpatial: any[] = [];
        
        if (isInBoardMode && boardModeState) {
          console.log('[AI] Building board mode spatial context');
          
          // Viewport and canvas bounds
          boardModeContext = {
            isInBoardMode: true,
            zoomLevel: boardModeState.scale || 1,
            viewportCenter: boardModeState.viewportCenter || {x: 0, y: 0},
            viewportBounds: boardModeState.viewportBounds || {minX: 0, maxX: 0, minY: 0, maxY: 0},
            canvasBounds: boardModeState.canvasBounds || {minX: 0, maxX: 0, minY: 0, maxY: 0}
          };
          
          // Get board positions and scales from DOM data attributes
          const boardPositions: Record<string, {x: number, y: number}> = {};
          const panelScales: Record<string, number> = {};
          try {
            const boardPosEl = document.querySelector('[data-board-positions]');
            if (boardPosEl) {
              Object.assign(boardPositions, JSON.parse(boardPosEl.getAttribute('data-board-positions') || '{}'));
            }
            const panelScalesEl = document.querySelector('[data-panel-scales]');
            if (panelScalesEl) {
              Object.assign(panelScales, JSON.parse(panelScalesEl.getAttribute('data-panel-scales') || '{}'));
            }
          } catch {}
          
          // Build all-panels data with spatial info
          allPanelsWithSpatial = allPanelsFlat
            .filter(p => p.type !== 'palette' && p.type !== 'notion') // Exclude utility panels
            .map((panel) => {
              const pos = boardPositions[panel.id] || {x: 0, y: 0};
              const scale = panelScales[panel.id] || 1;
              const width = 360 * 0.72 * scale; // BOARD_CELL_W * BOARD_ITEM_SCALE * scale
              const height = 240 * 0.72 * scale; // BOARD_CELL_H * BOARD_ITEM_SCALE * scale
              
              return {
                id: panel.id,
                // Fixed: Use per-page index instead of global index for semantic IDs
                semanticId: `page${panel.pageIndex + 1}-panel${(panel as any).indexInPage + 1}`,  // 1-indexed for Hon
                globalSemanticId: `panel-${panel.globalIndex + 1}`, // Also 1-indexed
                pageIndex: panel.pageIndex,  // Keep 0-indexed for internal use
                type: panel.type,
                url: panel.url || '',
                urlPreview: (panel.url || '').substring(0, 50) + '...',
                caption: panel.caption || '',
                imageCaption: panel.aiCaption || '',
                hasCaption: !!panel.aiCaption,
                isEditable: panel.type === 'image' && !!panel.url,
                hasContent: !!panel.url,
                worldPosition: pos,
                scale: scale,
                bounds: {
                  centerX: pos.x,
                  centerY: pos.y,
                  width: width,
                  height: height,
                  minX: pos.x - width / 2,
                  maxX: pos.x + width / 2,
                  minY: pos.y - height / 2,
                  maxY: pos.y + height / 2
                }
              };
            });
          
          // Calculate spatial relationships (proximity)
          const proximityThreshold = 500; // world units
          spatialContext = {
            totalPanels: allPanelsWithSpatial.length,
            proximity: allPanelsWithSpatial.map(panel => {
              const nearby = allPanelsWithSpatial
                .filter(other => other.id !== panel.id)
                .map(other => {
                  const dx = other.worldPosition.x - panel.worldPosition.x;
                  const dy = other.worldPosition.y - panel.worldPosition.y;
                  const distance = Math.sqrt(dx * dx + dy * dy);
                  return {panelId: other.id, distance};
                })
                .filter(({distance}) => distance < proximityThreshold)
                .sort((a, b) => a.distance - b.distance)
                .slice(0, 5); // Top 5 nearest
              
              return {panelId: panel.id, nearbyPanels: nearby};
            }).filter(({nearbyPanels}) => nearbyPanels.length > 0)
          };
        }
        
        // Multi-select context
        const selectedPanelIds = getAllSelectedPanelIds(state);
        const multiSelectContext = selectedPanelIds.length > 1 ? {
          selectedCount: selectedPanelIds.length,
          selectedPanelIds: selectedPanelIds,
          canBulkEdit: selectedPanelIds.length > 0,
          selectionNote: `${selectedPanelIds.length} panels currently selected - operations will apply to all selected panels`
        } : null;

        responsePayload = {
          currentPageIndex: currentPage,
          selectedPanelId: getSelectedPanelId(state),
          panels: panelsData, // Enhanced panels with semantic IDs and editing context (current page in focus mode)
          editingContext: editingContext, // Guidance for Hon to make smart editing decisions
          template: currentTemplate ? { 
             id: currentTemplate.id,
             name: currentTemplate.name,
             rows: currentTemplate.layout.rows,
             cols: currentTemplate.layout.cols,
             isCustomTemplate: currentTemplate.id === 'custom'
          } : null,
          userAction: state.currentUserAction, 
          comicTitle: currentComic?.title || null,
          comicPageCount: currentComic?.pages.length || 0,
          
          // NEW: Board mode awareness
          boardMode: boardModeContext,
          
          // NEW: All-pages data (only in board mode)
          ...(isInBoardMode && allPanelsWithSpatial.length > 0 ? {
            allPanels: allPanelsWithSpatial,
            spatialContext: spatialContext
          } : {}),
          
          // NEW: Multi-select context
          ...(multiSelectContext ? {multiSelect: multiSelectContext} : {})
        };
      }

      const responseContent = JSON.stringify(responsePayload);
      
      if (isInternalRefresh) {
        console.log('[AI] get_canvas_state internal refresh complete');
        return;
      }
      
      if (!this.evi || !this.evi.socket) {
        console.warn("Cannot send tool response: Connection closed while preparing payload.");
        return; 
      }

      // Switch to inspiring state when sending the response
      this.updateVisualIndicator(true, 'inspiring');
      
      const response = JSON.stringify({
        type: 'tool_response',
        tool_call_id: toolCallId,
        content: responseContent 
      });
      console.log("Sending tool response (canvas state with panel captions) to Hon:", JSON.parse(response));
      this.evi.socket.send(response);
      
      // Mark this tool call as completed
      this.completeToolCall(toolCallId);
      
      // Keep inspiring state - let assistant_end event return to idle
      // this.updateVisualIndicator(true, 'idle'); // Removed for better timing
    } catch (error) {
      console.error('Error handling/sending canvas state tool response:', error);
      if (isInternalRefresh) {
        console.warn('Internal canvas state refresh failed; continuing without snapshot.');
        return;
      }
      if (this.evi && this.evi.socket) { 
        this.sendToolErrorResponse(toolCallId, 'Failed to get canvas state');
      } else {
         console.error("Cannot send tool error response: Connection closed.");
      }
      // Return to idle processing state after error
      this.updateVisualIndicator(true, 'idle');
    }
  }

  // Handle get_panel_vision (Isaac-01 streaming)
  private async handleGetPanelVision(toolCallId: string, parameters: any) {
    try {
      if (!this.evi || !this.evi.socket) {
        console.error('get_panel_vision: no active socket');
        return;
      }

      // Parse params safely
      let p: any = parameters;
      if (typeof parameters === 'string') {
        try { p = JSON.parse(parameters); } catch {}
      }
      const requestedStyle = (p?.response_style as string) || 'text';
      const prompt = (p?.prompt as string) || 'Describe salient objects and relations.';
      let imageUrl = (p?.image_url as string) || '';
      let targetId = (p?.target_element_id as string) || '';
      console.log('[AI] get_panel_vision params', { toolCallId, targetId, hasImageUrl: !!imageUrl, requestedStyle });

      // Resolve target by semantic id if no direct image URL
      if (!imageUrl) {
        const state = useComicStore.getState() as State;
        const currentPage = state.currentPageIndex;
        const panels = state.currentComic?.pages[currentPage] || [];
        const imagePanels = panels.filter(x => x?.type === 'image' && x.url);
        const selectedPanelId = getSelectedPanelId(state);
        if (!targetId && selectedPanelId) {
          // Map selected to semantic id if possible
          const sel = panels.find(x => x.id === selectedPanelId) || null;
          if (sel) {
            const idx = panels.indexOf(sel);
            targetId = `panel-${idx}`;
          }
        }
        if (targetId) {
          const panel = this.findPanelBySemanticId(targetId, panels);
          if (panel && panel.url) {
            imageUrl = panel.url;
            // Focus presence on target
            this.updatePresence({ focusPanelId: panel.id });
            console.log('[AI] get_panel_vision resolved via target_element_id', { targetId, panelId: panel.id });
          }
        }
        // Ambiguity handling: if multiple images and no explicit target, ask for a target instead of guessing
        if (!imageUrl) {
          if (imagePanels.length === 1) {
            const only = imagePanels[0];
            imageUrl = only.url;
            this.updatePresence({ focusPanelId: only.id });
            console.log('[AI] get_panel_vision fell back to the only image on page', { panelId: only.id });
          } else if (imagePanels.length > 1) {
            console.warn('[AI] get_panel_vision ambiguous: multiple image panels, no target provided');
            this.sendToolErrorResponse(
              toolCallId,
              'Multiple images present; specify target_element_id',
              'Multiple image panels on page. Call getCanvasState, then call get_panel_vision with target_element_id like "panel-0".'
            );
            return;
          }
        }
      }

      if (!imageUrl) {
        console.warn('[AI] get_panel_vision: no image URL resolved');
        this.sendToolErrorResponse(toolCallId, 'No image to analyze', 'No image_url or valid target_element_id');
        return;
      }

      // Indicator to processing
      this.updateVisualIndicator(true, 'processing');

      // Find panel ID for overlay updates
      let panelId: string | null = null;
      try {
        const state = useComicStore.getState() as State;
        const currentPage = state.currentPageIndex;
        const panels = state.currentComic?.pages[currentPage] || [];
        const panel = panels.find(p => p.url === imageUrl);
        if (panel) panelId = panel.id;
      } catch {}

      // Use enhanced vision service (SAM3 + Isaac) for better accuracy
      try {
        const { analyzeWithEnhancedVision } = await import('./enhancedVisionService');
        
        console.log('[AI] enhanced-vision:tool start', { toolCallId, requestedStyle, imageUrl: imageUrl.substring(0, 50) + '...' });
        
        // Run enhanced vision analysis
        const enhancedResult = await analyzeWithEnhancedVision(imageUrl, {
          prompt: prompt,
          response_style: requestedStyle as any,
          useSAM3: true, // Include SAM3 for object detection
          useIsaac: true // Include Isaac for semantic understanding
        }, (partial) => {
          // Stream partial results to Hume
          if (this.evi?.socket) {
            try {
              const content = JSON.stringify({
                output: partial?.output || '',
                response_style: partial?.response_style || requestedStyle,
                partial: true,
                detected_objects: partial?.detectedObjects || [],
                boxes: partial?.boxes,
                points: partial?.points,
                polygons: partial?.polygons
              });
              this.evi.socket.send(JSON.stringify({ type: 'tool_response', tool_call_id: toolCallId, content }));
            } catch {}
          }
        });
        
        // Send final result to Hume
        const finalOutput = enhancedResult.combinedAnalysis || enhancedResult.output || 'No analysis available';
        const finalDetectedObjects = enhancedResult.detectedObjects || [];
        
        this.sendToolSuccessResponse(toolCallId, JSON.stringify({
          output: finalOutput,
          detected_objects: finalDetectedObjects,
          response_style: enhancedResult.response_style || requestedStyle,
          boxes: enhancedResult.boxes,
          points: enhancedResult.points,
          polygons: enhancedResult.polygons
        }));
        
        this.completeToolCall(toolCallId);
        this.updateVisualIndicator(true, 'inspiring');
        
        // Update vision overlay if available
        try {
          const state = useComicStore.getState() as State & { setVisionOverlay?: any };
          if (panelId && typeof state.setVisionOverlay === 'function') {
            state.setVisionOverlay(panelId, {
              responseStyle: (enhancedResult.response_style || requestedStyle) as any,
              boxes: enhancedResult.boxes,
              points: enhancedResult.points,
              polygons: enhancedResult.polygons,
              detectedObjects: finalDetectedObjects
            });
          }
        } catch {}
        
        console.log('[AI] enhanced-vision:tool end', { toolCallId, outputLength: finalOutput.length, objectsDetected: finalDetectedObjects.length });
        return;
      } catch (enhancedError) {
        console.warn('[AI] Enhanced vision failed, falling back to Isaac:', enhancedError);
      }
      
      // Fallback to original Isaac stream if enhanced vision fails
      console.log('[AI] isaac:tool start (fallback)', { toolCallId, requestedStyle });
      const resp = await fetch('/api/fal/isaac-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, prompt, response_style: requestedStyle })
      });
      if (!resp.ok || !(resp as any).body) {
        const msg = await resp.text().catch(() => 'stream failed');
        console.error('[AI] isaac:tool stream open failed', msg);
        this.sendToolErrorResponse(toolCallId, 'Isaac stream failed', msg);
        return;
      }

      const reader = (resp as any).body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const flushChunks = (chunks: string[]) => {
        for (const chunk of chunks) {
          const lines = chunk.split('\n');
          const eventLine = lines.find(l => l.startsWith('event:')) || '';
          const dataLine = lines.find(l => l.startsWith('data:')) || '';
          const evt = eventLine.replace('event: ', '').trim();
          const dataStr = dataLine.replace('data: ', '');
          try {
            const data = JSON.parse(dataStr);
            if (evt === 'isaac-partial') {
              const content = JSON.stringify({
                output: data?.output || '',
                response_style: data?.response_style || requestedStyle,
                partial: true,
                boxes: data?.boxes,
                points: data?.points,
                polygons: data?.polygons
              });
              this.evi?.socket?.send(JSON.stringify({ type: 'tool_response', tool_call_id: toolCallId, content }));
          } else if (evt === 'isaac-final') {
              const content = JSON.stringify({
                output: data?.output || '',
                response_style: data?.response_style || requestedStyle,
                boxes: data?.boxes,
                points: data?.points,
                polygons: data?.polygons
              });
              this.evi?.socket?.send(JSON.stringify({ type: 'tool_response', tool_call_id: toolCallId, content }));
              this.completeToolCall(toolCallId);
              this.updateVisualIndicator(true, 'inspiring');
            // Push overlays into store if we resolved a panel
            try {
                const state = useComicStore.getState() as State & { setVisionOverlay?: any };
                const currentPage = state.currentPageIndex;
                const panels = state.currentComic?.pages[currentPage] || [];
                if (this.currentPresence?.focusPanelId) {
                  const overlayPanel = panels.find(p => p.id === this.currentPresence!.focusPanelId);
                  if (overlayPanel && typeof state.setVisionOverlay === 'function') {
                    state.setVisionOverlay(overlayPanel.id, {
                      responseStyle: (data?.response_style || requestedStyle) as any,
                      boxes: data?.boxes,
                      points: data?.points,
                      polygons: data?.polygons
                    });
                  }
                }
            } catch {}
            } else if (evt === 'isaac-error') {
              this.sendToolErrorResponse(toolCallId, data?.error || 'Isaac error');
            }
          } catch (e) {
            // ignore parse errors
          }
        }
      };

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        flushChunks(parts);
      }
      // Flush remaining
      if (buffer) flushChunks([buffer]);
      console.log('[AI] isaac:tool end', { toolCallId });
    } catch (error) {
      console.error('[AI] get_panel_vision error', error);
      this.sendToolErrorResponse(toolCallId, 'Isaac failed', error instanceof Error ? error.message : String(error));
    }
  }

  // Handle canvas_editor_tool for voice commands (generate/edit images)
  private async handleCanvasEditorTool(toolCallId: string, parameters: any) {
    if (!this.evi || !this.evi.socket) {
      console.error("Cannot handle canvas editor tool: evi or evi.socket is null.");
      return; 
    }
    
    // Show processing state for image operations
    this.updateVisualIndicator(true, 'generating');
    console.log(`Handling canvas_editor_tool (ID: ${toolCallId}) with params:`, parameters);
    
    try {
      // Parse parameters if they come as a JSON string
      let parsedParams = parameters;
      if (typeof parameters === 'string') {
        try {
          parsedParams = JSON.parse(parameters);
          console.log('Parsed string parameters to object:', parsedParams);
        } catch (e) {
          console.error('Failed to parse parameters string:', e);
          throw new Error('Invalid parameters format');
        }
      }
      
      // Extract parameters from the tool call
      const action = parsedParams?.action;
      const prompt = parsedParams?.prompt;
      const target_element_id = parsedParams?.target_element_id;
      const image_url = parsedParams?.image_url;
      const output_parameters = parsedParams?.output_parameters;
      
      console.log('Extracted parameters:', { action, prompt, target_element_id, image_url });
      
      if (action === 'edit_image') {
        const timeSinceCanvasStateCall = this.lastCanvasStateCall ? (Date.now() - this.lastCanvasStateCall) : Number.POSITIVE_INFINITY;
        if (timeSinceCanvasStateCall > this.canvasStateCallThreshold) {
          console.log('[canvas_editor] Canvas state stale before edit. Auto-refreshing context.');
          try {
            await this.handleCanvasStateTool(`auto-refresh-${toolCallId}`, { detail: 'focused', _internalOnly: true });
          } catch (refreshError) {
            console.warn('[canvas_editor] Auto canvas refresh failed:', refreshError);
          }
        }
      }
      
      // Check if Hon is following proper workflow for editing
      if (action === 'edit_image' && target_element_id) {
        const timeSinceCanvasStateCall = Date.now() - this.lastCanvasStateCall;
        if (timeSinceCanvasStateCall < this.canvasStateCallThreshold) {
          console.log(`✅ GOOD WORKFLOW: getCanvasState ${Math.round(timeSinceCanvasStateCall / 1000)}s ago; target_element_id="${target_element_id}"`);
        } else {
          console.log('⚠️ edit_image requested without recent getCanvasState; proceeding but results may be less accurate.');
        }
      }
      
      if (!action || !prompt) {
        console.error('Parameter validation failed:', { action, prompt, parameters });
        throw new Error('Missing required parameters: action and prompt are required');
      }
      
      let resultUrl: string;
      // Cross-branch flags/messages used in final response
      let editingFailedGlobal = false;
      let placementMessageGlobal = '';
      
      if (action === 'generate_image') {
        // Use Flux.1 Krea for generation with streaming progress
        console.log(`Voice command: Generating image with Flux.1 Krea - prompt: "${prompt}"`);
        
        // Determine target panel ID for progress tracking
        const targetPanelId = target_element_id || `temp-panel-${Date.now()}`;
        
        // Use Flux.1 Krea with streaming progress that integrates with Hon indicator
        resultUrl = await fluxKreaService.generateWithStreaming(prompt, {
          image_size: 'landscape_4_3',
          num_inference_steps: 28,
          guidance_scale: 4.5,
          acceleration: 'regular'
        }, (event: StreamProgressEvent) => {
          // Handle streaming progress with Hon indicator integration
          if (event.type === 'progress') {
            console.log('Hon Voice: Flux Krea streaming progress:', event.message);
            
            // Update processing state based on progress
            if (event.status === 'starting') {
              this.updateVisualIndicator(true, 'processing');
              // Set panel-specific progress
              useComicStore.getState().setPanelGenerationProgress(targetPanelId, true, event.message || 'Initializing...');
            } else if (event.status === 'generating') {
              this.updateVisualIndicator(true, 'generating');
              // Update panel-specific progress with partial image
              useComicStore.getState().setPanelGenerationProgress(
                targetPanelId, 
                true, 
                event.message || 'Generating with Flux.1 Krea...', 
                event.partialImageUrl
              );
            }
            
          } else if (event.type === 'complete') {
            console.log('Hon Voice: Flux Krea generation completed');
            this.updateVisualIndicator(true, 'inspiring');
            this.updatePresence({ progressPercent: 100, progressLabel: 'Complete', etaSeconds: 0 });
            // Keep progress active until panel is updated - will be cleared after updatePanel
          } else if (event.type === 'error') {
            console.error('Hon Voice: Flux Krea streaming error:', event.error);
            this.updateVisualIndicator(true, 'idle');
            this.updatePresence({ progressPercent: undefined, progressLabel: undefined, etaSeconds: null });
            // Clear panel-specific progress on error
            useComicStore.getState().clearPanelGenerationProgress(targetPanelId);
          }
        });
        
        // Update canvas with generated image
        const state = useComicStore.getState();
        const currentPage = state.currentPageIndex;
        
        if (target_element_id) {
          // Replace specific panel (search across all pages for board mode support)
          const result = this.findPanelBySemanticIdAcrossPages(target_element_id, state.currentComic);
          
          if (result) {
            const updatedPanel = {
              ...result.panel,
              url: resultUrl,
              caption: prompt
            };
            await (useComicStore.getState() as any).updatePanel(updatedPanel, result.pageIndex);
            console.log(`🎨 Panel ${target_element_id} successfully updated with image! Actual panel ID: ${result.panel.id} on ${formatPageReference(result.pageIndex)} at position [${result.panel.position.row}, ${result.panel.position.col}]`);
            // Clear panel progress after successful update
            useComicStore.getState().clearPanelGenerationProgress(result.panel.id);
          } else {
            console.warn(`Panel ${target_element_id} not found and no available positions - image generated but not placed`);
          }
        } else {
          // Create new panel
          const newPanel: Panel = {
            id: nanoid(),
            type: 'image',
            url: resultUrl,
            caption: prompt,
            size: 'medium',
            aspectRatio: 1,
            position: { row: 0, col: 0 }
          };
          await (useComicStore.getState() as any).updatePanel(newPanel, currentPage);
          // Clear panel progress after successful update
          useComicStore.getState().clearPanelGenerationProgress(targetPanelId);
        }
        
      } else if (action === 'edit_image') {
        // Switch to editing state for green glow
        this.updateVisualIndicator(true, 'editing');
        
        // Check for multi-selection - if user lassoed multiple panels, edit ALL of them
        const editState = useComicStore.getState() as State;
        const editSelectedIds = getAllSelectedPanelIds(editState);
        const hasEditMultiSelection = editSelectedIds.length > 1;
        
        if (hasEditMultiSelection && editState.currentComic) {
          console.log('[canvas_editor] Multi-selection detected for editing - processing all selected panels', { count: editSelectedIds.length });
          
          // Build flat list of all image panels across all pages
          const allImagePanels: Array<{panel: any, pageIdx: number}> = [];
          editState.currentComic.pages.forEach((page, pageIdx) => {
            page.forEach(p => {
              if (p && p.type === 'image' && p.url) {
                allImagePanels.push({panel: p, pageIdx});
              }
            });
          });
          
          // Process each selected panel
          const editPromises = editSelectedIds.map(async (panelId) => {
            const found = allImagePanels.find(({panel}) => panel.id === panelId);
            if (!found) return;
            
            const {panel, pageIdx} = found;
            console.log(`[canvas_editor] Editing panel ${panelId} on ${formatPageReference(pageIdx)}`);
            
            try {
              // Use Nano Banana Pro Edit
              const editedUrl = await nanoBananaEditService.editImage(prompt, [panel.url], {
                num_images: 1
              });
              
              if (editedUrl) {
                const updatedPanel = { ...panel, url: editedUrl, caption: panel.caption || prompt };
                await useComicStore.getState().updatePanel(updatedPanel, pageIdx);
                console.log(`[canvas_editor] ✅ Successfully edited panel ${panelId}`);
              }
            } catch (e) {
              console.error(`[canvas_editor] Failed to edit panel ${panelId}:`, e);
            }
          });
          
          await Promise.all(editPromises);
          
          // Complete tool call and return
          this.sendToolSuccessResponse(
            toolCallId,
            `Successfully edited ${editSelectedIds.length} selected panels with prompt: "${prompt}"`
          );
          this.updateVisualIndicator(true, 'idle');
          return;
        }
        
        // Single panel editing: Use Nano Banana Pro Edit for editing
        let editImageUrl = image_url;
        let resolvedTargetPanel: Panel | null = null;
        let resolvedPageIndex = -1;
        
        const state = useComicStore.getState();
        const currentPage = state.currentPageIndex;
        
        // ALWAYS try to resolve target panel for updating (even if image_url is provided)
        // This ensures edited images replace the source panel, not create new ones
        if (target_element_id) {
          // ✅ Good workflow: Hon specified a target panel (likely called getCanvasState first)
          // Search across ALL pages to find the target (board mode support)
          if (state.currentComic) {
            const result = this.findPanelBySemanticIdAcrossPages(target_element_id, state.currentComic);
            if (result) {
              resolvedTargetPanel = result.panel;
              resolvedPageIndex = result.pageIndex;
              if (!editImageUrl && resolvedTargetPanel.url) {
                editImageUrl = resolvedTargetPanel.url;
              }
              console.log(`[canvas_editor] ✅ Found target panel ${target_element_id} on ${formatPageReference(resolvedPageIndex)} (panel ID: ${resolvedTargetPanel.id})`);
            }
          }
        }
        
        // If no target specified, try selected panel
        if (!resolvedTargetPanel) {
          const selectedId = getSelectedPanelId(state);
          if (selectedId && state.currentComic) {
            // Search all pages for selected panel
            for (let pageIdx = 0; pageIdx < state.currentComic.pages.length; pageIdx++) {
              const panels = state.currentComic.pages[pageIdx] || [];
              const found = panels.find(p => p.id === selectedId);
              if (found && found.type === 'image') {
                resolvedTargetPanel = found;
                resolvedPageIndex = pageIdx;
                if (!editImageUrl && found.url) {
                  editImageUrl = found.url;
                }
                console.log(`[canvas_editor] 🔄 Using selected panel from ${formatPageReference(pageIdx)} (panel ID: ${found.id})`);
                break;
              }
            }
          }
        }
        
        if (!editImageUrl) {
          throw new Error('No image URL provided for editing. Please select a panel or specify target_element_id.');
        }
        
        if (!resolvedTargetPanel) {
          console.warn('[canvas_editor] ⚠️ No target panel resolved - edited image will be placed in next available slot');
        }
        
        if (!editImageUrl) {
          throw new Error('No image URL provided for editing');
        }
        
        console.log(`Voice command: Editing image with Nano Banana Pro - prompt: "${prompt}"`);
        
        // Attempt edit via Nano Banana; we keep fallback to generation for reliability
        let editingFailed = false;
        let editErrorMessage = '';
        
        try {
          // References only upon request (explicit flag or prompt intent)
          const paramsObj = typeof parameters === 'string' ? (() => { try { return JSON.parse(parameters); } catch { return {}; } })() : (parameters || {});
          const explicitRefs = paramsObj?.use_references || paramsObj?.useReferences || paramsObj?.use_refs;
          const intentRefs = typeof prompt === 'string' && /use\s+reference|match\s+style|same\s+style|keep\s+style|style\s+consistent|use\s+images\s+on\s+canvas/i.test(prompt);
          const shouldUseRefs = !!explicitRefs || !!intentRefs;
          
          // Check for object-specific editing (use Seedream with mask, not Nano Banana)
          const objectName = paramsObj?.object_name || paramsObj?.objectName;
          const highlightedObjects = useComicStore.getState().highlightedObjects[resolvedTargetPanel?.id || ''];
          const targetObject = objectName || (highlightedObjects && highlightedObjects.length > 0 ? highlightedObjects[0] : null);

          // If object-specific editing is requested, use SAM3 mask + Seedream (Seedream supports masks, Nano Banana doesn't)
          if (targetObject && resolvedTargetPanel) {
            console.log(`[canvas_editor] Object-specific edit: "${targetObject}" using Seedream with SAM3 mask`);
            try {
              const { editWithMask } = await import('./sam3MaskService');
              resultUrl = await editWithMask(editImageUrl, prompt, targetObject, {
                detectionThreshold: 0.3,
                strength: 0.8
              });
              console.log(`[canvas_editor] ✅ Object-specific edit completed with Seedream + SAM3 mask`);
            } catch (maskError) {
              console.warn(`[canvas_editor] Seedream mask editing failed, falling back to Nano Banana:`, maskError);
              // Fall through to regular Nano Banana editing
            }
          }

          // Regular editing with Nano Banana (if object-specific editing wasn't used or failed)
          if (!resultUrl) {
            let imageUrls: string[] = [editImageUrl];
            if (shouldUseRefs) {
              const st = useComicStore.getState();
              const currPageIdx = st.currentPageIndex;
              const pagePanels = st.currentComic?.pages[currPageIdx] || [];
              const candidateRefs = pagePanels
                .filter(p => p && p.type === 'image' && typeof p.url === 'string' && p.url.length > 0)
                .map(p => p.url);

              // De-duplicate with target first
              const seen = new Set<string>([editImageUrl]);
              for (const u of candidateRefs) {
                if (!u || seen.has(u)) continue;
                imageUrls.push(u);
                seen.add(u);
              }

              // If there are more than 4 images on canvas, aim for at least 6 references (including target)
              const moreThanFourOnCanvas = candidateRefs.length > 4;
              const desiredMax = moreThanFourOnCanvas ? 6 : 4;
              imageUrls = imageUrls.slice(0, Math.min(desiredMax, imageUrls.length));
            }

            console.log('[AI] Nano Banana Pro edit refs:', { enabled: shouldUseRefs, count: imageUrls.length, first: imageUrls[0]?.slice(0, 72) });
            resultUrl = await nanoBananaEditService.editImage(prompt, imageUrls, { num_images: 1 });
            console.log("Nano Banana Pro edit completed successfully, result ready:", resultUrl);
          }
        } catch (error) {
          editingFailed = true;
          editErrorMessage = error instanceof Error ? error.message : 'Unknown editing error';
          console.warn(`🚨 Nano Banana Pro editing failed: ${editErrorMessage}`);
          
          // Check if it's a timeout error and if we should try fallback
          const isTimeoutError = editErrorMessage.includes('timeout') || editErrorMessage.includes('timed out');
          
          if (isTimeoutError) {
            console.log(`⏰ Timeout detected - attempting Nano Banana Pro generation as fallback for prompt: "${prompt}"`);
            // Fallback: Generate a new image with the editing prompt
            try {
              resultUrl = await nanoBananaService.generateImage(prompt, { num_images: 1 });
              console.log("✅ Nano Banana Pro fallback generation completed, result ready:", resultUrl);
              editingFailed = false; // Reset since fallback succeeded
            } catch (fallbackError) {
              console.error(`❌ Nano Banana Pro fallback generation also failed: ${fallbackError}`);
              throw new Error(`Image editing timed out and Nano Banana Pro fallback failed: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown fallback error'}`);
            }
          } else {
            // For non-timeout errors, re-throw the original error
            throw error;
          }
        }
        
        // Update canvas with edited image - use correct page index
        // Note: state and currentPage already declared at top of edit_image block
        const targetPageIndex = resolvedPageIndex >= 0 ? resolvedPageIndex : currentPage;
        let panelUpdateSuccessful = false;
        let placementMessage = '';
        
        // Try to update the resolved target panel first
        if (resolvedTargetPanel && resolvedPageIndex >= 0) {
          try {
            const updatedPanel = {
              ...resolvedTargetPanel,
              url: resultUrl,
              caption: prompt
            };
            await (useComicStore.getState() as any).updatePanel(updatedPanel, targetPageIndex);
            panelUpdateSuccessful = true;
            placementMessage = `[canvas_editor] ✏️ Panel successfully updated on ${formatPageReference(targetPageIndex)}! Panel ID: ${resolvedTargetPanel.id}`;
            console.log(placementMessage);
          } catch (updateError) {
            console.warn(`[canvas_editor] Failed to update target panel ${resolvedTargetPanel.id}: ${updateError}`);
            panelUpdateSuccessful = false;
          }
        }
        
        // If original panel update failed or no target was resolved, try fallback options
        if (!panelUpdateSuccessful) {
          const panels = state.currentComic?.pages[currentPage] || [];
          
          // Option 1: Try to find the target panel again if we have a target_element_id (search all pages)
          if (target_element_id && !resolvedTargetPanel && state.currentComic) {
            const result = this.findPanelBySemanticIdAcrossPages(target_element_id, state.currentComic);
            if (result) {
              try {
                const updatedPanel = {
                  ...result.panel,
                  url: resultUrl,
                  caption: prompt
                };
                await (useComicStore.getState() as any).updatePanel(updatedPanel, result.pageIndex);
                panelUpdateSuccessful = true;
                placementMessage = `✏️ Panel ${target_element_id} successfully updated with ${editingFailed ? 'generated' : 'edited'} image! Actual panel ID: ${result.panel.id} on ${formatPageReference(result.pageIndex)} at position [${result.panel.position.row}, ${result.panel.position.col}]`;
                console.log(placementMessage);
              } catch (updateError) {
                console.warn(`Failed to update fallback target panel ${result.panel.id}: ${updateError}`);
              }
            }
          }
          
          // Option 2: If we still haven't placed the content, find next available panel
          if (!panelUpdateSuccessful) {
            const nextAvailablePanel = this.findNextAvailablePanel(panels);
            if (nextAvailablePanel) {
              try {
                // Add the new panel to the store first, then update it with content
                await (useComicStore.getState() as any).updatePanel(nextAvailablePanel, currentPage);
                const updatedNextPanel = {
                  ...nextAvailablePanel,
                  url: resultUrl,
                  caption: prompt
                };
                await (useComicStore.getState() as any).updatePanel(updatedNextPanel, currentPage);
                panelUpdateSuccessful = true;
              placementMessage = `🎯 Content placed in next available panel at position [${nextAvailablePanel.position.row}, ${nextAvailablePanel.position.col}] - ID: ${nextAvailablePanel.id}`;
                console.log(placementMessage);
              } catch (updateError) {
                console.warn(`Failed to place content in next available panel: ${updateError}`);
              }
            }
          }
          
          // Option 3: Last resort - create a new panel at (0,0)
          if (!panelUpdateSuccessful) {
            try {
              const newPanel: Panel = {
                id: nanoid(),
                type: 'image',
                url: resultUrl,
                caption: prompt,
                size: 'medium',
                aspectRatio: 1,
                position: { row: 0, col: 0 }
              };
              await (useComicStore.getState() as any).updatePanel(newPanel, currentPage);
              panelUpdateSuccessful = true;
              placementMessage = `📍 Created new panel with ${editingFailed ? 'generated' : 'edited'} image at default position [0, 0]`;
              console.log(placementMessage);
        // Preserve for final response outside this branch
        editingFailedGlobal = editingFailed;
        placementMessageGlobal = placementMessage;
            } catch (updateError) {
              console.error(`❌ Failed to create new panel as last resort: ${updateError}`);
              throw new Error(`Content generation succeeded but panel placement failed completely: ${updateError}`);
            }
          }
        }
        
      } else {
        throw new Error(`Unsupported action: ${action}`);
      }

      // Preload the image to ensure it's visible before Hon responds
      if (resultUrl) {
        console.log('[canvas_editor] Preloading image before sending response...');
        await this.preloadImage(resultUrl, 5000);
      }

      // Send success response to Hon
      // Include hint for batch operations to continue silently
      const silentContinueHint = ' Continue to next task silently.';
      const responseContent = JSON.stringify({
        success: true,
        action,
        result_url: resultUrl,
        target_element_id,
        message: action === 'generate_image'
          ? `Image generated.${silentContinueHint}`
          : editingFailedGlobal
            ? `Image edited (fallback to generation).${silentContinueHint}`
            : `Image edited.${silentContinueHint}`
      });
      
      if (!this.evi || !this.evi.socket) {
        console.warn("Cannot send tool response: Connection closed while processing image.");
        return; 
      }
      
      // Switch to inspiring state when sending response (after processing is complete)
      this.updateVisualIndicator(true, 'inspiring');
      
      const response = JSON.stringify({
        type: 'tool_response',
        tool_call_id: toolCallId,
        content: responseContent 
      });
      
      console.log("Sending canvas editor tool response to Hon:", JSON.parse(response));
      this.evi.socket.send(response);
      
      // Mark this tool call as completed
      this.completeToolCall(toolCallId);
      
      // Keep inspiring state - let assistant_end event return to idle
      // this.updateVisualIndicator(true, 'idle'); // Removed for better timing
      
    } catch (error) {
      console.error('Error handling canvas editor tool:', error);
      if (this.evi && this.evi.socket) { 
        this.sendToolErrorResponse(toolCallId, `Canvas editor failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      } else {
         console.error("Cannot send tool error response: Connection closed.");
      }
      // Return to idle state after error
      this.updateVisualIndicator(true, 'idle');
    }
  }

  // Handle video_generator tool call - Generate videos using Luma API
  private async handleVideoGeneratorTool(toolCallId: string, parameters: any) {
    if (!this.evi || !this.evi.socket) {
      console.error("Cannot handle video generator tool: evi or evi.socket is null.");
      return; 
    }
    
    // Show dreaming state for video generation
    this.updateVisualIndicator(true, 'dreaming');
    console.log(`Handling video_generator tool call (ID: ${toolCallId}) with params:`, parameters);
    
    try {
      // Parse parameters if they come as a string
      let parsedParams = parameters;
      if (typeof parameters === 'string') {
        try {
          parsedParams = JSON.parse(parameters);
        } catch (parseError) {
          throw new Error(`Failed to parse tool parameters: ${parseError}`);
        }
      }

      // Extract parameters using same pattern as image generation
      const { 
        prompt = '', 
        target_element_id,
        start_image_url,
        end_image_url,
        mode = 'text-to-video',
        operation_type = 'text_to_video',
        ...otherParams 
      } = parsedParams || {};

      console.log(`Video generation parameters:`, { 
        prompt: prompt.substring(0, 100), 
        target_element_id, 
        operation_type,
        hasStartImage: !!start_image_url 
      });
      
      // Use same simple logic as image generation - no complex parsing
      let detectedPanelId = target_element_id as string | undefined;
      let detectedImageUrl = start_image_url as string | undefined;
      let detectedRealPanelId: string | undefined; // Preserve actual selected panel id when available

      // Check for multi-selection first - if user has lassoed multiple panels, use ALL of them
        const state = useComicStore.getState() as State;
        const selectedIds = getAllSelectedPanelIds(state);
      const hasMultiSelection = selectedIds.length > 1;
      console.log('[video_gen] Selection state:', { 
        selectedIds, 
        hasMultiSelection, 
        selectedPanelId: state.selectedPanelId,
        selectedCount: selectedIds.length
      });
      
      // If multi-selection exists, prioritize it over any single target Hon detected
      if (!hasMultiSelection) {
        // Single selection: prefer user selection over any pre-filled reference
        // In board mode, search across ALL pages, not just current page
        try {
          const firstSel = getSelectedPanelId(state);
          
          if (firstSel && state.currentComic) {
            // Use cross-page resolution to find the selected panel
            const result = this.findPanelBySemanticIdAcrossPages(firstSel, state.currentComic);
            
            if (result && result.panel.type === 'image' && result.panel.url) {
              // Get semantic ID for this panel on its page
              const pagePanels = state.currentComic.pages[result.pageIndex] || [];
              const panelIndex = pagePanels.findIndex(p => p.id === result.panel.id);
              
              detectedPanelId = panelIndex >= 0 ? `panel-${panelIndex + 1}` : undefined;
              detectedRealPanelId = firstSel; // Use actual panel ID for reliable binding
              detectedImageUrl = result.panel.url;
              console.log(`[video_gen] Using selected panel from ${formatPageReference(result.pageIndex)}:`, {
                panelId: firstSel,
                semanticId: detectedPanelId,
                pageIndex: result.pageIndex
              });
            }
          }
        } catch (e) {
          console.warn('[video_gen] Failed to resolve selected panel:', e);
        }
      }
      
      const finalOperationType = start_image_url ? 'image_to_video' : 'text_to_video';



      console.log('Video generation logic results:', {
        detectedPanelId,
        detectedImageUrl: detectedImageUrl ? detectedImageUrl.substring(0, 30) + '...' : 'none',
        finalOperationType
      });

      // Prepare the API request
      const apiPayload = {
        prompt,
        operation_type: finalOperationType,
        target_element_id: detectedRealPanelId || detectedPanelId,
        start_image_url: detectedImageUrl,
        end_image_url,
        ...otherParams
      };

      console.log('Sending video generation request to API:', {
        ...apiPayload,
        start_image_url: apiPayload.start_image_url ? apiPayload.start_image_url.substring(0, 30) + '...' : 'none'
      });

      // Multi-selection: if user has lassoed 2+ panels, apply operation to ALL of them
      // This takes priority over any single target Hon detected
      try {
        if (hasMultiSelection && state.currentComic) {
          console.log('[video_gen] Multi-selection mode activated - processing all selected panels', { count: selectedIds.length });
          // Re-broadcast selection so UI clearly highlights the targets
          try { if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('board-selection-changed', { detail: { panelIds: selectedIds } })); } catch {}
          
          // Build a flat list of all panels across all pages for multi-select targeting
          const allPanelsFlat: Array<{panel: any, pageIdx: number, panelIdx: number}> = [];
          state.currentComic.pages.forEach((page, pageIdx) => {
            page.forEach((p, panelIdx) => {
              if (p && p.type === 'image' && p.url) {
                allPanelsFlat.push({panel: p, pageIdx, panelIdx});
              }
            });
          });
          
          for (const realId of selectedIds) {
            const found = allPanelsFlat.find(({panel}) => panel.id === realId);
            if (!found) continue;
            const {panel: p, pageIdx, panelIdx} = found;
            const semanticId = `page${pageIdx}-panel${panelIdx}`;
            // Use Veo 3.1 for image-to-video with 1080p, no audio
            // Normalize duration to Veo 3.1 format (4s, 6s, 8s)
            const dur = otherParams.duration?.replace(/s$/i, '') || '4';
            const veoDuration = ['4', '6', '8'].includes(dur) ? `${dur}s` : '4s';
            const payloadEach: any = {
              prompt,
              image_url: p.url,
              aspect_ratio: otherParams.aspect_ratio || '16:9',
              resolution: otherParams.resolution || '1080p',
              duration: veoDuration,
              generate_audio: otherParams.generate_audio ?? false
            };
            console.log('Submitting Veo 3.1 image-to-video for selection', { semanticId, image_url: payloadEach.image_url.substring(0,30)+'...' });
            // Mark panel as generating in the UI
            try { (useComicStore.getState() as any).setPanelGenerationProgress(realId, true, 'Queued'); } catch {}
            const resp = await fetch('/api/veo31/image-to-video', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payloadEach)
            });
            if (!resp.ok) {
              const err = await resp.text().catch(()=>'');
              console.warn('Veo 3.1 (multi) call failed for', semanticId, err);
              continue;
            }
            const json = await resp.json();
            // Track completion by real panel id to avoid semantic-id mismatches
            this.pollSeedanceVideoCompletion(toolCallId, json.request_id, 'image-to-video', 'image_to_video', realId, true);
          }
          // Keep dreaming indicator; polling will send completion messages
          return;
        }
      } catch (e) {
        console.warn('Multi-selection video path failed, falling back to single target:', e);
      }

      // Determine which endpoint to use - Veo 3.1 for image-to-video, Seedance for text-to-video
      const isImageToVideo = finalOperationType === 'image_to_video' && !!detectedImageUrl;
      const videoEndpoint = isImageToVideo ? '/api/veo31/image-to-video' : '/api/seedance/text-to-video';
      
      // Prepare payload based on the model
      // Veo 3.1 requires duration with 's' suffix (4s, 6s, 8s)
      const normalizeDuration = (d: string | undefined): string => {
        if (!d) return '4s';
        const num = d.replace(/s$/i, '');
        // Map to valid Veo 3.1 durations
        if (num === '4' || num === '6' || num === '8') return `${num}s`;
        // Default to 4s for fastest output
        return '4s';
      };
      
      const videoPayload = isImageToVideo ? {
        // Veo 3.1 Fast image-to-video payload
        prompt,
        image_url: detectedImageUrl,
        aspect_ratio: otherParams.aspect_ratio || '16:9',
        resolution: otherParams.resolution || '1080p',  // Default 1080p
        duration: normalizeDuration(otherParams.duration),  // Veo needs 4s, 6s, or 8s
        generate_audio: otherParams.generate_audio ?? false  // Default no audio
      } : {
        // Seedance text-to-video payload
        prompt,
        ...(end_image_url && { end_image_url }),
        aspect_ratio: otherParams.aspect_ratio || '16:9',
        resolution: otherParams.resolution || '720p',
        duration: otherParams.duration || '5',
        camera_fixed: otherParams.camera_fixed || false,
        ...(otherParams.seed !== undefined && { seed: otherParams.seed })
      };

      console.log(`Using ${isImageToVideo ? 'Veo 3.1' : 'Seedance'} endpoint: ${videoEndpoint}`, {
        ...videoPayload,
        image_url: (videoPayload as any).image_url ? (videoPayload as any).image_url.substring(0, 30) + '...' : undefined
      });

      // Visually confirm the intended single target and set progress state for UI
      try { if (typeof document !== 'undefined' && (detectedRealPanelId || detectedPanelId)) document.dispatchEvent(new CustomEvent('board-selection-changed', { detail: { panelIds: [detectedRealPanelId || detectedPanelId] } })); } catch {}
      try { if (detectedRealPanelId) (useComicStore.getState() as any).setPanelGenerationProgress(detectedRealPanelId, true, 'Queued'); } catch {}

      // Make the API call
      // De-dupe key: one outstanding request per panel+prompt+op
      const opKey = `${finalOperationType}|${(detectedRealPanelId||'none')}|${(detectedImageUrl||'')}|${(prompt||'').slice(0,80)}`;
      if (this.inFlightOpKeys.has(opKey)) {
        console.warn('[video_gen] Skipping duplicate video request for key:', opKey);
        this.sendToolErrorResponse(toolCallId, 'Already processing that request');
        return;
      }
      this.inFlightOpKeys.add(opKey);
      const response = await fetch(videoEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(videoPayload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
        throw new Error(`Video generation failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
      }

      const result = await response.json();
      console.log(`${isImageToVideo ? 'Veo 3.1' : 'Seedance'} video generation initiated:`, {
        request_id: result.request_id,
        status: result.status,
        model: isImageToVideo ? 'veo3.1-fast' : 'seedance'
      });

      // Map request id to opKey for cleanup on completion and bind target panel id at submission time
      // CRITICAL: Always bind the actual panel ID (not semantic ID) for reliable panel updates
      try {
        if (result?.request_id) {
          this.seedanceRequestToOpKey.set(result.request_id, opKey);
          // Always prefer actual panel ID over semantic ID for binding
          const hardTargetId = detectedRealPanelId || getSelectedPanelId(state) || '';
          if (hardTargetId) {
            this.seedanceRequestToTargetId.set(result.request_id, hardTargetId);
            console.log('[video_gen] Bound target panel ID for request:', { requestId: result.request_id, panelId: hardTargetId });
          }
        }
      } catch {}

      // Always start polling for video completion (keep indicator in dreaming state)
      // CRITICAL: Always pass the real panel ID to ensure we update the selected panel, not create a new one
      // Prefer actual panel ID, fall back to semantic ID only if no selection exists
      const targetForPolling = detectedRealPanelId || getSelectedPanelId(state) || detectedPanelId;
      console.log('[video_gen] Starting poll with target:', { 
        targetForPolling, 
        detectedRealPanelId, 
        selectedPanelId: getSelectedPanelId(state),
        detectedPanelId,
        boundTargetId: result?.request_id ? this.seedanceRequestToTargetId.get(result.request_id) : undefined
      });
      
      this.pollSeedanceVideoCompletion(
        toolCallId, 
        result.request_id, 
        isImageToVideo ? 'image-to-video' : 'text-to-video',
        finalOperationType,
        targetForPolling || undefined,
        isImageToVideo  // Use Veo 3.1 for image-to-video
      );

      // DON'T send success response yet - wait for video completion!

    } catch (error) {
      console.error('Video generation error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Video generation failed';
      this.sendToolErrorResponse(toolCallId, errorMessage);
      // Cleanup in-flight guard on error
      try { this.seedanceRequestToOpKey.forEach((key, rid) => { if (key && this.inFlightOpKeys.has(key)) this.inFlightOpKeys.delete(key); }); } catch {}
    }
    // Note: Don't reset indicator here - let polling system handle state when video completes
  }

  // Handle aleph_video_editor tool call - Runway Aleph video-to-video editing
  private async handleAlephVideoEditorTool(toolCallId: string, parameters: any) {
    if (!this.evi || !this.evi.socket) {
      console.error("Cannot handle aleph video editor tool: evi or evi.socket is null.");
      return; 
    }
    // Concurrency guard: only one Aleph job at a time
    if (this.alephTaskActive) {
      console.warn('Video edit requested while another is active. Blocking to prevent extra credit usage.');
      this.sendToolErrorResponse(toolCallId, 'Another video edit is already in progress. Please wait for it to complete.');
      return;
    }

    // Set editing state after passing concurrency guard
    this.updateVisualIndicator(true, 'editing');

    try {
      let parsedParams = parameters;
      if (typeof parameters === 'string') {
        try { parsedParams = JSON.parse(parameters); } catch (e) { throw new Error('Invalid parameters format'); }
      }

      const {
        prompt,
        input_video_url,
        target_element_id,
        output_parameters = {},
        camera_control,
        motion_brush,
        style,
        lighting,
        strength,
        seed
      } = parsedParams || {};

      if (!prompt) throw new Error('Missing required parameter: prompt');

      // Resolve actual input video URL. Hume may pass a semantic id like "panel-0".
      let resolvedVideoUrl: string | null = null;
      if (typeof input_video_url === 'string' && input_video_url.startsWith('http')) {
        resolvedVideoUrl = input_video_url;
      } else {
        const state = useComicStore.getState();
        const targetId = (typeof input_video_url === 'string' && input_video_url) || target_element_id;
        if (targetId && state.currentComic) {
          // Search across all pages (board mode support)
          const result = this.findPanelBySemanticIdAcrossPages(targetId, state.currentComic);
          if (result && result.panel.url) {
            if (result.panel.type !== 'video') {
              throw new Error('Selected panel is not a video. Please choose a video panel for editing.');
            }
            resolvedVideoUrl = result.panel.url;
          }
        }
      }

      if (!resolvedVideoUrl) {
        throw new Error('No valid input video found. Provide a video URL or a video panel id like "panel-0".');
      }

      // Start backend task using fal.ai Lucy Edit
      const payload: any = {
        video_url: resolvedVideoUrl,
        prompt: prompt
      };

      const response = await fetch('/api/fal/lucy-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Lucy Edit start failed: ${errorData}`);
      }

      const { id: taskId } = await response.json();
      // Begin polling and update canvas when complete
      this.pollAlephCompletion(toolCallId, taskId, target_element_id, prompt);
      // Mark Aleph as active
      this.alephTaskActive = true;
      this.alephCurrentTaskId = taskId || null;
      // Keep indicator green while editing until completion
      this.updateVisualIndicator(true, 'editing');
      // Ensure keepalive during long-running Aleph tasks
      this.startKeepalive();
    } catch (error) {
      console.error('Video editor error:', error);
      const message = error instanceof Error ? error.message : 'Video edit failed';
      this.sendToolErrorResponse(toolCallId, message);
      // Release concurrency lock on immediate failure
      this.alephTaskActive = false;
      this.alephCurrentTaskId = null;
      this.updateVisualIndicator(true, 'idle');
      // Stop keepalive if no other tools are active
      if (this.activeToolCalls.size === 0) {
        this.stopKeepalive();
      }
    }
  }

  private async pollAlephCompletion(toolCallId: string, taskId: string, targetElementId?: string, prompt?: string) {
    const maxAttempts = 120;
    let attempts = 0;
    const poll = async () => {
      if (attempts++ >= maxAttempts) {
        this.updateVisualIndicator(true, 'idle');
        this.sendToolErrorResponse(toolCallId, 'Video edit timed out');
        // Complete and release lock on timeout
        this.completeToolCall(toolCallId);
        this.alephTaskActive = false;
        this.alephCurrentTaskId = null;
        if (this.activeToolCalls.size === 0) {
          this.stopKeepalive();
        }
        return;
      }
      try {
        const res = await fetch(`/api/fal/lucy-edit-status?requestId=${encodeURIComponent(taskId)}`);
        if (!res.ok) { setTimeout(poll, 5000); return; }
        const data = await res.json();
        // Handle explicit failure statuses
        if (data.status === 'failed' || data.status === 'FAILED' || data.status === 'error') {
          this.updateVisualIndicator(true, 'idle');
          this.sendToolErrorResponse(toolCallId, 'Video edit failed');
          this.completeToolCall(toolCallId);
          this.alephTaskActive = false;
          this.alephCurrentTaskId = null;
          return;
        }
        if ((data.status === 'completed' || data.status === 'succeeded') && data.output?.length) {
          const videoUrl = data.output[0];
          // place into canvas
          const state = useComicStore.getState();
          if (targetElementId && state.currentComic) {
            // Search across all pages (board mode support)
            const result = this.findPanelBySemanticIdAcrossPages(targetElementId, state.currentComic);
            if (result) {
              await state.updatePanel({ ...result.panel, type: 'video', url: videoUrl, caption: prompt || result.panel.caption }, result.pageIndex);
            }
          } else {
            const newPanel: Panel = {
              id: nanoid(),
              type: 'video',
              url: videoUrl,
              caption: prompt || '',
              size: 'medium',
              aspectRatio: 1,
              position: { row: 0, col: 0 }
            };
            await state.updatePanel(newPanel, state.currentPageIndex);
          }
          // Release concurrency lock FIRST so audio isn't suppressed
          this.alephTaskActive = false;
          this.alephCurrentTaskId = null;
          // respond success - content must be a string for Hume
          const content = JSON.stringify({ status: 'ok', url: videoUrl });
          this.evi?.socket?.send(JSON.stringify({ type: 'tool_response', tool_call_id: toolCallId, content }));
          this.completeToolCall(toolCallId);
          this.updateVisualIndicator(true, 'inspiring');
          this.updatePresence({ progressPercent: 100, progressLabel: 'Complete', etaSeconds: 0 });
          // Removed explicit completion speech - the video appearing is confirmation enough
          // Stop keepalive if no other tools are active
          if (this.activeToolCalls.size === 0) {
            this.stopKeepalive();
          }
          return;
        }
        setTimeout(poll, 5000);
      } catch (e) {
        setTimeout(poll, 5000);
      }
    };
    poll();
  }

  // Helper function to find panel by semantic ID across all pages (for board mode)
  // Returns both panel and page index, or null if not found
  private findPanelBySemanticIdAcrossPages(
    semanticId: string,
    comic: Comic | null
  ): { panel: Panel; pageIndex: number } | null {
    if (!comic || !comic.pages) {
      return null;
    }

    // Handle global semantic IDs like "page1-panel1", "page2-panel3" (board mode format)
    const globalMatch = semanticId.match(/^page(\d+)[-_]panel(\d+)$/i);
    if (globalMatch) {
      const pageNum = parseInt(globalMatch[1], 10);
      const panelNum = parseInt(globalMatch[2], 10);
      const pageIndex = pageNum - 1; // Convert 1-indexed to 0-indexed
      const panelIndex = panelNum - 1; // Convert 1-indexed to 0-indexed

      if (pageIndex >= 0 && pageIndex < comic.pages.length) {
        const panels = comic.pages[pageIndex] || [];
        const state = useComicStore.getState();
        const currentTemplate = comic.pageTemplates?.[pageIndex];
        const isCustomTemplate = currentTemplate?.id === 'custom';

        let sortedPanels: Panel[];
        if (isCustomTemplate) {
          sortedPanels = [...panels];
        } else {
          sortedPanels = [...panels].sort((a, b) => {
            if (a.position.row !== b.position.row) {
              return a.position.row - b.position.row;
            }
            return a.position.col - b.position.col;
          });
        }

        if (panelIndex >= 0 && panelIndex < sortedPanels.length) {
          const panel = sortedPanels[panelIndex];
          console.log(`[panel_resolution] ✅ Resolved global semantic ID "${semanticId}" to panel "${panel.id}" on ${formatPageReference(pageIndex)}`);
          return { panel, pageIndex };
        }
      }
      console.warn(`[panel_resolution] Global semantic ID "${semanticId}" out of range`);
      return null;
    }

    // Handle per-page semantic IDs like "panel-1", "panel-2" (search all pages)
    const panelMatch = semanticId.match(/^panel[-_](\d+)$/);
    if (panelMatch) {
      const panelIndex = parseInt(panelMatch[1], 10) - 1; // Convert 1-indexed to 0-indexed

      // Search all pages
      for (let pageIdx = 0; pageIdx < comic.pages.length; pageIdx++) {
        const panels = comic.pages[pageIdx] || [];
        const state = useComicStore.getState();
        const currentTemplate = comic.pageTemplates?.[pageIdx];
        const isCustomTemplate = currentTemplate?.id === 'custom';

        let sortedPanels: Panel[];
        if (isCustomTemplate) {
          sortedPanels = [...panels];
        } else {
          sortedPanels = [...panels].sort((a, b) => {
            if (a.position.row !== b.position.row) {
              return a.position.row - b.position.row;
            }
            return a.position.col - b.position.col;
          });
        }

        if (panelIndex >= 0 && panelIndex < sortedPanels.length) {
          const panel = sortedPanels[panelIndex];
          console.log(`[panel_resolution] ✅ Resolved semantic ID "${semanticId}" to panel "${panel.id}" on ${formatPageReference(pageIdx)} (searched all pages)`);
          return { panel, pageIndex: pageIdx };
        }
      }

      console.warn(`[panel_resolution] Semantic ID "${semanticId}" not found across any page`);
      return null;
    }

    // Handle direct panel ID (search all pages)
    for (let pageIdx = 0; pageIdx < comic.pages.length; pageIdx++) {
      const panels = comic.pages[pageIdx] || [];
      const directMatch = panels.find(p => p.id === semanticId);
      if (directMatch) {
        console.log(`[panel_resolution] ✅ Found panel by direct ID "${semanticId}" on ${formatPageReference(pageIdx)}`);
        return { panel: directMatch, pageIndex: pageIdx };
      }
    }

    console.warn(`[panel_resolution] Panel ID "${semanticId}" not found across any page`);
    return null;
  }

  // Helper function to convert semantic panel IDs to actual panels (single page)
  private findPanelBySemanticId(semanticId: string, panels: Panel[]): Panel | null {
    // Handle semantic IDs like "panel-0", "panel-1", "panel_0", "panel_1", etc.
    // Support both hyphen and underscore formats for maximum compatibility
    const panelMatch = semanticId.match(/^panel[-_](\d+)$/);
    if (panelMatch) {
      const panelIndex = parseInt(panelMatch[1], 10);
      
      // Get the current template to determine if it's a custom template
      const state = useComicStore.getState();
      const currentTemplate = state.currentComic?.pageTemplates[state.currentPageIndex];
      const isCustomTemplate = currentTemplate?.id === 'custom';
      
      let sortedPanels: Panel[];
      
      if (isCustomTemplate) {
        // For custom templates: Use creation order (array index represents creation order)
        // "first panel" = panels[0], "second panel" = panels[1], etc.
        sortedPanels = [...panels]; // Keep original array order (creation order)
        console.log(`Custom template detected - using creation order for panel resolution`);
      } else {
        // For regular templates: Sort by position (row first, then column) for consistent grid ordering  
        // "first panel" = top-left, "second panel" = next in reading order, etc.
        sortedPanels = [...panels].sort((a, b) => {
          if (a.position.row !== b.position.row) {
            return a.position.row - b.position.row;
          }
          return a.position.col - b.position.col;
        });
        console.log(`Regular template detected - using position-based sorting for panel resolution`);
      }
      
      // Return the panel at the specified index
      if (panelIndex >= 0 && panelIndex < sortedPanels.length) {
        const resolvedPanel = sortedPanels[panelIndex];
        console.log(`Resolved semantic ID "${semanticId}" to panel with actual ID "${resolvedPanel.id}" at position [${resolvedPanel.position.row}, ${resolvedPanel.position.col}] (${isCustomTemplate ? 'custom template - creation order' : 'regular template - position order'})`);
        return resolvedPanel;
      } else {
        console.warn(`Panel index ${panelIndex} out of range (available: 0-${sortedPanels.length - 1}) for ${isCustomTemplate ? 'custom' : 'regular'} template`);
        
        // FALLBACK: If the requested panel index is out of range, try to find next available empty panel
        console.log(`Attempting fallback: finding next available empty panel for failed lookup "${semanticId}"`);
        return this.findNextAvailablePanel(panels);
      }
    }
    
    // If not a semantic ID, try to find by actual ID
    const directMatch = panels.find(p => p.id === semanticId);
    if (directMatch) {
      return directMatch;
    }
    
    // FALLBACK: If no direct match, try to find next available empty panel
    console.log(`Panel ID "${semanticId}" not found, attempting to find next available empty panel`);
    return this.findNextAvailablePanel(panels);
  }

  // Helper function to find the next available empty panel position
  private findNextAvailablePanel(existingPanels: Panel[]): Panel | null {
    const state = useComicStore.getState();
    const currentTemplate = state.currentComic?.pageTemplates[state.currentPageIndex];
    
    if (!currentTemplate) {
      console.warn('No template found for finding next available panel');
      return null;
    }

    if (currentTemplate.id === 'custom') {
      // For custom templates: Just return null as we can't auto-place panels in free-form layouts
      console.log('Custom template - cannot auto-place panel, user must specify position');
      return null;
    }

    // For regular templates: Find next empty position in the template layout
    const usedPositions = existingPanels.map(p => `${p.position.row}-${p.position.col}`);
    const nextPosition = currentTemplate.layout.areas.find((area: any) => 
      !usedPositions.includes(`${area.position.row}-${area.position.col}`)
    )?.position;

    if (nextPosition) {
      // Create a panel object representing the next available position
      // This will be used as a template for content placement
      const nextPanel: Panel = {
        id: nanoid(), // Generate new ID
        type: 'image', // Will be updated when content is placed
        url: '', // Will be updated when content is placed
        caption: '',
        size: 'medium',
        aspectRatio: 1,
        position: nextPosition
      };
      
      console.log(`Found next available panel position: [${nextPosition.row}, ${nextPosition.col}] (generated ID: ${nextPanel.id})`);
      return nextPanel;
    }

    console.warn('No available panel positions found in template layout');
    // Auto-create a new page with a random template and return its first panel position
    try {
      const templates: any[] = (state.currentComic?.pageTemplates || []).filter(Boolean) as any[];
      // Fallback base template if none exist yet
      const fallbackTemplate = templates.find(t => t && t.layout && Array.isArray(t.layout.areas)) || null;
      // If we have no template definitions at all, create a blank page and let caller update after placement
      state.addNewPage();
      const newIndex = (useComicStore.getState().currentPageIndex);
      const newPageTemplate = (useComicStore.getState().currentComic?.pageTemplates[newIndex]) || fallbackTemplate;
      if (!newPageTemplate || !newPageTemplate.layout?.areas?.length) {
        console.warn('New page has no template; cannot auto-place.');
        return null;
      }
      const first = newPageTemplate.layout.areas[0].position;
      const nextPanel: Panel = {
        id: nanoid(),
        type: 'image',
        url: '',
        caption: '',
        size: 'medium',
        aspectRatio: 1,
        position: first
      };
      console.log(`Created new page at index ${newIndex} and prepared first panel at [${first.row}, ${first.col}]`);
      return nextPanel;
    } catch (e) {
      console.warn('Failed to auto-create new page for placement:', e);
      return null;
    }
  }

  // Poll video completion for both Veo 3.1 and Seedance with improved state management
  private async pollSeedanceVideoCompletion(
    toolCallId: string,
    requestId: string, 
    modelType: 'text-to-video' | 'image-to-video',
    operationType: string,
    targetPanelId?: string,
    useVeo31: boolean = false  // Flag to use Veo 3.1 status endpoint
  ) {
    const maxAttempts = 60; // 5 minutes at 5-second intervals
    let attempts = 0;
    const modelName = useVeo31 ? 'Veo 3.1' : 'Seedance';

    console.log(`Starting ${modelName} video polling for request ${requestId} (${modelType})`);

    const poll = async (): Promise<void> => {
      if (attempts >= maxAttempts) {
        console.warn(`${modelName} video polling timed out for request ${requestId}`);
        this.updateVisualIndicator(true, 'idle');
        this.sendToolErrorResponse(toolCallId, 'Video generation timed out. Please try again.');
        return;
      }

      attempts++;
      
      try {
        // Check video status via appropriate status API
        const statusEndpoint = useVeo31 
          ? `/api/veo31/status?request_id=${requestId}&model_type=${modelType}`
          : `/api/seedance/status?request_id=${encodeURIComponent(requestId)}&model_type=${modelType}`;
        const statusResponse = await fetch(statusEndpoint);
        
        if (!statusResponse.ok) {
          console.warn(`Failed to check ${modelName} video status: ${statusResponse.status}`);
          setTimeout(poll, 5000);
          return;
        }

        const statusResult = await statusResponse.json();
        console.log(`${modelName} video status check ${attempts}/${maxAttempts}:`, {
          request_id: requestId,
          status: statusResult.status,
          hasVideoUrl: !!statusResult.video_url
        });

        if (statusResult.status === 'COMPLETED') {
          // Check if we have a video URL
          if (!statusResult.video_url) {
            console.warn(`${modelName} COMPLETED but no video_url - retrying in 2s`);
            setTimeout(poll, 2000);
            return;
          }
          // Video is ready! 
          console.log(`✅ ${modelName} video completed! Full response:`, statusResult);
          console.log(`Video URL: ${statusResult.video_url}`);
          // De-dupe: if we already handled this request id, ignore
          if (this.completedSeedanceRequestIds.has(requestId)) {
            console.warn('[video_gen] Duplicate completion for requestId; ignoring placement:', requestId);
            this.updateVisualIndicator(true, 'idle');
            this.sendToolSuccessResponse(toolCallId, 'Video already placed.');
            return;
          }
          
          // Update panel using same logic as image generation
          const state = useComicStore.getState();
          const currentPage = state.currentPageIndex;
          
          if (targetPanelId) {
            // Replace specific panel - search across ALL pages since board mode shows all pages
            // Prefer bound target id for this request (hard binding at submission)
            const boundTargetId = this.seedanceRequestToTargetId.get(requestId) || targetPanelId;
            
            // Use cross-page resolution to find the panel (handles semantic IDs and direct IDs)
            const result = this.findPanelBySemanticIdAcrossPages(boundTargetId, state.currentComic);
            
            if (result) {
              const updatedPanel = {
                ...result.panel,
                url: statusResult.video_url,
                type: 'video' as const
              };
              await state.updatePanel(updatedPanel, result.pageIndex);
              try { (useComicStore.getState() as any).clearPanelGenerationProgress(result.panel.id); } catch {}
              console.log(`🎬 Panel ${boundTargetId} successfully updated with video! Actual panel ID: ${result.panel.id} on ${formatPageReference(result.pageIndex)}, position [${result.panel.position.row}, ${result.panel.position.col}]`);
              
              // Save to recent generations
              try {
                state.addRecentGeneration({
                  url: statusResult.video_url,
                  prompt: result.panel.caption || 'Video generation',
                  timestamp: new Date(),
                  model: 'Seedance',
                  type: 'video',
                  metadata: { operationType, modelType }
                });
              } catch (e) {
                console.warn('Failed to save video to recent generations:', e);
              }
            } else {
              // Fallback: try the currently selected panel(s) before creating anything new
              const preferredTargetId = getSelectedPanelId(state);
              if (preferredTargetId && state.currentComic) {
                // Use cross-page resolution to find selected panel
                const fallbackResult = this.findPanelBySemanticIdAcrossPages(preferredTargetId, state.currentComic);
                if (fallbackResult) {
                  const updated = { ...fallbackResult.panel, url: statusResult.video_url, type: 'video' as const };
                  await state.updatePanel(updated, fallbackResult.pageIndex);
                  try { (useComicStore.getState() as any).clearPanelGenerationProgress(fallbackResult.panel.id); } catch {}
                  console.log(`🎬 Fallback updated selected panel ${fallbackResult.panel.id} on ${formatPageReference(fallbackResult.pageIndex)}`);
                } else {
                  console.warn(`Preferred selected panel not found; skipping creation to avoid duplicates.`);
                }
              } else {
                console.warn(`Panel ${targetPanelId} not found and no selected target; skipping creation to avoid duplicates.`);
              }
            }
          } else {
            // Create new panel (same as image generation)
            // But only if nothing is selected; otherwise, force update the selected panel
            const preferredTargetId = getSelectedPanelId(state);
            if (preferredTargetId && state.currentComic) {
              // Use cross-page resolution to find selected panel
              const fallbackResult = this.findPanelBySemanticIdAcrossPages(preferredTargetId, state.currentComic);
              if (fallbackResult) {
                const updated = { ...fallbackResult.panel, url: statusResult.video_url, type: 'video' as const };
                await state.updatePanel(updated, fallbackResult.pageIndex);
                try { (useComicStore.getState() as any).clearPanelGenerationProgress(fallbackResult.panel.id); } catch {}
                console.log(`🎬 Forced update on selected panel ${fallbackResult.panel.id} on ${formatPageReference(fallbackResult.pageIndex)} instead of creating new.`);
              } else {
                console.warn('Selected id not found; skipping creation to avoid duplicates.');
              }
            } else {
              // No selection context; keep existing behavior and create a panel
            const newPanel: Panel = {
              id: nanoid(),
              type: 'video',
              url: statusResult.video_url,
              caption: '',
              size: 'medium',
              aspectRatio: 1,
              position: { row: 0, col: 0 }
            };
            await state.updatePanel(newPanel, currentPage);
              console.log(`🎬 New panel created with video (no selection to target).`);
            }
            
            // Save to recent generations
            try {
              state.addRecentGeneration({
                url: statusResult.video_url,
                prompt: 'Video generation',
                timestamp: new Date(),
                model: 'Seedance',
                type: 'video',
                metadata: { operationType, modelType }
              });
            } catch (e) {
              console.warn('Failed to save video to recent generations:', e);
            }
          }
          
          // Mark complete and release de-dupe flags
          try { this.completedSeedanceRequestIds.add(requestId); } catch {}
          try {
            const key = this.seedanceRequestToOpKey.get(requestId);
            if (key) { this.inFlightOpKeys.delete(key); this.seedanceRequestToOpKey.delete(requestId); }
          } catch {}
          
          // Video generation complete - return to idle state and send success to Hume
          this.updateVisualIndicator(true, 'idle');
          this.sendToolSuccessResponse(toolCallId,
            operationType === 'image_to_video'
              ? 'Image converted to video. Continue to next task silently.'
              : 'Video generated. Continue to next task silently.'
          );
          
        } else if (statusResult.status === 'FAILED') {
          console.error(`❌ ${modelName} video generation failed: ${statusResult.error || 'Unknown error'}`);
          
          // Video generation failed - return to idle state and send error to Hume
          this.updateVisualIndicator(true, 'idle');
          try {
            const key = this.seedanceRequestToOpKey.get(requestId);
            if (key) { this.inFlightOpKeys.delete(key); this.seedanceRequestToOpKey.delete(requestId); }
          } catch {}
          this.sendToolErrorResponse(toolCallId, `Video generation failed: ${statusResult.error || 'Unknown error'}`);
          
        } else {
          // Still processing, continue polling while keeping dreaming state
          console.log(`${modelName} video still ${statusResult.status.toLowerCase()}... continuing to poll`);
          this.updateVisualIndicator(true, 'dreaming'); // Ensure we stay in dreaming state
          setTimeout(poll, 5000);
        }
        
      } catch (error) {
        console.error(`Error checking ${modelName} video status:`, error);
        
        // If we're not at max attempts, try again
        if (attempts < maxAttempts) {
          setTimeout(poll, 5000);
        } else {
          this.updateVisualIndicator(true, 'idle');
          this.sendToolErrorResponse(toolCallId, 'Failed to check video generation status');
        }
      }
    };

    // Start polling immediately
    poll();
  }



  // Handle getVideoContext tool call - Analyze video content using video understanding
  private async handleVideoContextTool(toolCallId: string, parameters: any) {
    if (!this.evi || !this.evi.socket) {
      console.error("Cannot handle video context tool: evi or evi.socket is null.");
      return; 
    }
    
    // Show reasoning state for video analysis
    this.updateVisualIndicator(true, 'reasoning');
    console.log(`Handling getVideoContext tool call (ID: ${toolCallId}) with params:`, parameters);
    
    try {
      // Parse parameters if they come as a JSON string
      let parsedParams = parameters;
      if (typeof parameters === 'string') {
        try {
          parsedParams = JSON.parse(parameters);
          console.log('Parsed string parameters to object:', parsedParams);
        } catch (e) {
          console.error('Failed to parse parameters string:', e);
          throw new Error('Invalid parameters format');
        }
      }
      
      // Extract parameters from the tool call
      const video_url = parsedParams?.video_url;
      const prompt = parsedParams?.prompt || 'What is happening in this video?';
      const detail = parsedParams?.detail || 'full';
      
      console.log('Extracted video analysis parameters:', { video_url, prompt, detail });
      
      if (!video_url) {
        throw new Error('Missing required parameter: video_url');
      }

      if (!prompt) {
        throw new Error('Missing required parameter: prompt');
      }
      
      console.log(`🎬 Analyzing video content: "${video_url.substring(0, 50)}..." with prompt: "${prompt}"`);
      
      // Video understanding is Hon's eyes - must never fail silently
      const maxRetries = 3;
      let attempt = 0;
      let analysisResult: any = null;
      
      while (attempt < maxRetries && !analysisResult) {
        try {
          attempt++;
          console.log(`[Video Understanding] 👁️ Analyzing video (attempt ${attempt}/${maxRetries})...`);
          
          // Call our video understanding API
          const response = await fetch('/api/fal/video-understanding', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              videoUrl: video_url,
              prompt: prompt
            }),
            signal: AbortSignal.timeout(60000) // 60s timeout for video
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            const errorMsg = `Video analysis failed: ${errorData.error || response.statusText}`;
            console.error(`[Video Understanding] ❌ Attempt ${attempt} failed:`, errorMsg);
            
            if (attempt < maxRetries) {
              const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff
              console.log(`[Video Understanding] ⏳ Retrying in ${delay}ms...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
            throw new Error(errorMsg);
          }

          const result = await response.json();
          
          if (!result.success || !result.analysis) {
            throw new Error('Invalid response from video analysis service');
          }

          analysisResult = result;
          console.log(`[Video Understanding] ✅ Analysis completed: "${analysisResult.analysis.substring(0, 200)}${analysisResult.analysis.length > 200 ? '...' : ''}"`);
          console.log(`[Video Understanding] 📤 Sending analysis to Hon: "${analysisResult.analysis}"`);
          break; // Success, exit retry loop
        } catch (error: any) {
          console.error(`[Video Understanding] ❌ Attempt ${attempt} error:`, error?.message || error);
          if (attempt < maxRetries && !error?.name?.includes('AbortError')) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            console.log(`[Video Understanding] ⏳ Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else if (attempt >= maxRetries) {
            console.error(`[Video Understanding] ❌ All ${maxRetries} attempts failed. Hon will work without video analysis.`);
            throw error; // Re-throw to be caught by outer try-catch
          }
        }
      }

      if (!analysisResult) {
        throw new Error('Video analysis failed after all retries');
      }

      // Send the analysis result back to Hume with clear instruction to immediately describe it
      const responseContent = `Video analysis complete. Immediately describe this to the user now:\n\n${analysisResult.analysis}\n\nPlease share these findings with the user right away.`;
      
      const toolResponse = JSON.stringify({
        type: 'tool_response',
        tool_call_id: toolCallId,
        content: responseContent
      });

      this.evi.socket.send(toolResponse);
      console.log('[AI] video_analysis response_sent', { id: toolCallId });
      
      // Mark this tool call as completed
      this.completeToolCall(toolCallId);
      
      // Switch to inspiring state after analysis is complete and response sent
      this.updateVisualIndicator(true, 'inspiring');
      
      // Keep inspiring state - let assistant_end event return to idle
      // this.updateVisualIndicator(true, 'idle'); // Removed for better timing
      
    } catch (error) {
      console.error('[AI] video_analysis error', { id: toolCallId, message: (error as any)?.message || error });
      const errorMessage = error instanceof Error ? error.message : 'Unknown error analyzing video';
      this.sendToolErrorResponse(toolCallId, errorMessage, `Failed to analyze video content: ${errorMessage}`);
    }
  }

  // Helper for sending tool success responses
  private sendToolSuccessResponse(toolCallId: string, message: string) {
    if (!this.evi || !this.evi.socket) {
      console.error("Cannot send tool success response: evi or evi.socket is null.");
      return;
    }
    try {
      const successResponse = JSON.stringify({
        type: 'tool_response',
        tool_call_id: toolCallId,
        content: message
      });
      console.log("Sending tool success:", successResponse);
      this.evi.socket.send(successResponse);
      
      // Mark this tool call as completed
      this.completeToolCall(toolCallId);
    } catch (e) {
      console.error("Failed to send tool success response:", e);
      // Still complete the tool call to prevent hanging
      this.completeToolCall(toolCallId);
    }
  }

  // Helper for sending tool errors
  private sendToolErrorResponse(toolCallId: string, errorMsg: string, content?: string) {
    // Complete tool call with failure status
    this.completeToolCall(toolCallId, false);
    if (!this.evi || !this.evi.socket) {
      console.error("Cannot send tool error response: evi or evi.socket is null.");
      return;
    }
    try {
      const errorResponse = JSON.stringify({
        type: 'tool_error',
        tool_call_id: toolCallId,
        error: errorMsg,
        content: content || `Error processing tool call ${toolCallId}`
      });
      console.log("Sending tool error:", errorResponse);
      this.evi.socket.send(errorResponse);
    } catch (e) {
      console.error("Failed to send tool error response:", e);
      // Still complete the tool call to prevent hanging (already called at start of function)
    }
  }

  // Send user text messages
  public async sendMessage(message: string): Promise<boolean> {
    if (!this.evi || !this.evi.socket) {
      console.warn('Cannot send message: No active Hon session or socket.');
      return false;
    }
    try {
      console.log('Sending user text message to Hon:', message);
      const messagePayload = JSON.stringify({
        type: 'user_input',
        text: message
      });
      this.evi.socket.send(messagePayload);
      return true;
    } catch (error) {
      console.error('Failed to send text message to Hon:', error);
      return false;
    }
  }

  // Microphone capture methods
  public async startAudioCapture(): Promise<boolean> {
    // ADDED MUTE CHECK
    if (this.isMuted) {
      console.log("startAudioCapture: Cannot start - User is muted.");
      return false;
    }
    // ... (rest of startAudioCapture remains the same) ...
    console.log("startAudioCapture: Attempting to start audio capture..."); 

    if (this.isCapturingAudio) {
      console.warn('startAudioCapture: Cannot start - Already capturing audio.');
      return false;
    }
    if (!this.evi) {
        console.warn('startAudioCapture: Cannot start - EVI connection is not active (this.evi is null).');
        return false;
    }
     if (this.currentStatus !== 'active') {
        console.warn(`startAudioCapture: Cannot start - Current status is '${this.currentStatus}', not 'active'.`);
        return false;
     }
    console.log("startAudioCapture: Initial checks passed."); 

    try {
      console.log("startAudioCapture: Calling navigator.mediaDevices.getUserMedia with Hume-recommended constraints..."); 
      // Enhanced audio constraints per Hume documentation
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,  // Required by Hume for voice chat
          noiseSuppression: true,  // Required by Hume for voice chat
          autoGainControl: true,   // Required by Hume for voice chat
          sampleRate: 16000,       // Hume recommended for speech
          channelCount: 1          // Mono for voice as per Hume docs
        }
      });
      console.log('startAudioCapture: Hume-compliant microphone access granted. Stream:', this.mediaStream); 

      console.log("startAudioCapture: Creating MediaRecorder..."); 
      // Choose best supported MIME type for consistent chunks
      let mimeType: string | undefined;
      const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ];
      for (const c of candidates) {
        if ((window as any).MediaRecorder && (MediaRecorder as any).isTypeSupported?.(c)) { mimeType = c; break; }
      }
      this.mediaRecorder = mimeType ? new MediaRecorder(this.mediaStream, { mimeType }) : new MediaRecorder(this.mediaStream);
      console.log("startAudioCapture: MediaRecorder created:", this.mediaRecorder); 

      this.mediaRecorder.ondataavailable = async (event: BlobEvent) => { 
        if (event.data.size > 0 && this.evi) {
          try {
             // Use Hume SDK helper available via Landing service import pattern
             const { convertBlobToBase64 } = await import('hume');
             const encodedAudioData: string = await (convertBlobToBase64 as any)(event.data);
             this.evi.sendAudioInput({ data: encodedAudioData });
          } catch (error) {
            console.error('startAudioCapture (ondataavailable): Error encoding or sending audio chunk:', error);
            this.stopAudioCapture(); 
          }
        } else if (!this.evi) {
            console.warn("startAudioCapture (ondataavailable): Audio data available but EVI session ended. Stopping capture.");
            this.stopAudioCapture();
        }
      };

      this.mediaRecorder.onerror = (event: Event) => {
        console.error('startAudioCapture (onerror): MediaRecorder error:', event);
        this.stopAudioCapture();
      };

      this.mediaRecorder.onstart = () => {
        console.log('startAudioCapture (onstart): Audio capture started event received.'); 
        this.isCapturingAudio = true;
      };

      this.mediaRecorder.onstop = () => {
        console.log('startAudioCapture (onstop): Audio capture stopped event received.'); 
        this.isCapturingAudio = false;
         this.mediaStream?.getTracks().forEach(track => track.stop());
         this.mediaStream = null;
         this.mediaRecorder = null;
         console.log('startAudioCapture (onstop): Cleaned up stream and recorder.');
      };

      console.log("startAudioCapture: Calling mediaRecorder.start(100)..."); 
      this.mediaRecorder.start(100);
      console.log("startAudioCapture: mediaRecorder.start(100) called."); 

      return true; 

    } catch (error) {
      console.error('startAudioCapture: Failed during getUserMedia or MediaRecorder setup:', error); 
      this.isCapturingAudio = false;
      if (this.mediaStream) {
           console.log("startAudioCapture (catch): Stopping media stream tracks due to error.");
           this.mediaStream.getTracks().forEach(track => track.stop());
           this.mediaStream = null;
      }
      this.mediaRecorder = null;
      return false; 
    }
  }

  public stopAudioCapture() {
    // ... (remains the same) ...
     console.log("stopAudioCapture: Attempting to stop audio capture..."); 
    if (!this.isCapturingAudio || !this.mediaRecorder) {
       console.log(`stopAudioCapture: Not stopping - isCapturingAudio: ${this.isCapturingAudio}, mediaRecorder exists: ${!!this.mediaRecorder}`); 
      return;
    }

    try {
      const currentState = this.mediaRecorder.state;
      console.log(`stopAudioCapture: Current MediaRecorder state: ${currentState}`); 
      if (currentState === 'recording' || currentState === 'paused') {
           console.log("stopAudioCapture: Calling mediaRecorder.stop()..."); 
           this.mediaRecorder.stop(); 
           console.log("stopAudioCapture: mediaRecorder.stop() called."); 
      } else {
           console.warn(`stopAudioCapture: MediaRecorder state is '${currentState}', not recording/paused. Performing manual cleanup.`); 
           this.isCapturingAudio = false;
           this.mediaStream?.getTracks().forEach(track => track.stop());
           this.mediaStream = null;
           this.mediaRecorder = null;
      }
    } catch (error) {
        console.error("stopAudioCapture: Error calling mediaRecorder.stop():", error); 
        this.isCapturingAudio = false;
        this.mediaStream?.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
        this.mediaRecorder = null;
    }
  }

  private async handleGenerateGameTool(toolCallId: string, parameters: any) {
    // Parameters from Hume can arrive as a JSON string or an object
    let parsed: any = parameters;
    if (typeof parameters === 'string') {
      try { parsed = JSON.parse(parameters); } catch { parsed = {}; }
    }
    let description: string = String(parsed?.description ?? parsed?.prompt ?? parsed?.game_description ?? '').trim();
    let provider: string | undefined = parsed?.provider;
    let model: string | undefined = parsed?.model;
    const options: any = parsed?.options || {};

    // Auto-detect model preference from description (e.g., "use claude to make..." or "with gemini...")
    const descLower = description.toLowerCase();
    if (!provider && !model) {
      if (descLower.includes('use claude') || descLower.includes('with claude') || descLower.includes('using claude')) {
        console.log('[generate_game] Detected Claude preference in description, switching model');
        useComicStore.getState().setPreferredGameModel('claude');
        // Clean the description
        description = description.replace(/\b(use|with|using)\s+claude\b/gi, '').trim();
      } else if (descLower.includes('use gemini') || descLower.includes('with gemini') || descLower.includes('using gemini')) {
        console.log('[generate_game] Detected Gemini preference in description, switching model');
        useComicStore.getState().setPreferredGameModel('gemini');
        // Clean the description
        description = description.replace(/\b(use|with|using)\s+gemini\b/gi, '').trim();
      }
    }

    if (!description) {
      // Return a tool error response in-band rather than throwing, to avoid noisy logs
      try {
        this.evi?.socket?.send(JSON.stringify({
          type: 'tool_response',
          tool_call_id: toolCallId,
          content: JSON.stringify({ success: false, action: 'generate_game', error: 'Missing description' })
        }));
        this.completeToolCall(toolCallId);
      } catch {}
      return;
    }

    const state = useComicStore.getState();
    const currentPage = state.currentPageIndex;

    // Check for selected 3D object to use as player character
    const selectedPanelIds = state.selectedPanelIds || [];
    let customAssets: Record<string, string> = {};
    
    console.log('[generate_game] Checking for selected 3D object...');
    console.log('[generate_game] selectedPanelIds:', selectedPanelIds);
    console.log('[generate_game] currentComic:', state.currentComic?.id);
    
    if (selectedPanelIds.length > 0) {
      // Access pages from currentComic, not state.pages
      const pages = state.currentComic?.pages || [];
      console.log('[generate_game] Total pages:', pages.length);
      const allPanels = pages.flatMap(page => page || []);
      console.log('[generate_game] Total panels across all pages:', allPanels.length);
      
      // Find the first selected panel that's a 3D object
      for (const panelId of selectedPanelIds) {
        console.log('[generate_game] Looking for panel ID:', panelId);
        const panel = allPanels.find(p => p.id === panelId);
        if (panel) {
          console.log('[generate_game] Found panel:', { id: panel.id, type: panel.type, hasUrl: !!panel.url, url: panel.url?.substring(0, 50) });
          if (panel.type === '3d' && panel.url) {
            // Use the 3D object as the player character
            customAssets.player = panel.url;
            console.log('[generate_game] ✅ Found selected 3D object, using as player:', panel.url.substring(0, 80) + '...');
            break; // Use first 3D object found
          } else {
            console.log('[generate_game] Panel is not 3D or missing URL. Type:', panel.type, 'Has URL:', !!panel.url);
          }
        } else {
          console.log('[generate_game] ⚠️ Panel not found in pages. Available panel IDs:', allPanels.map(p => p.id));
        }
      }
    } else {
      console.log('[generate_game] No panels selected');
    }
    
    console.log('[generate_game] Final customAssets:', customAssets);

    // Create panel upfront with loading state
    const panelId = nanoid();
    const newPanel = {
      id: panelId,
      type: 'game' as any, // Temp fix if needed
      url: '',
      gameCode: '',
      caption: '',
      size: 'large',
      aspectRatio: 1,
      // Make the panel wider (about 2x) so the overlay has room
      position: { row: 0, col: 0, rowSpan: 1, colSpan: 2 }
    } as any;
    await state.updatePanel(newPanel as any, currentPage);
    try { document.dispatchEvent(new CustomEvent('enter-board-mode')); } catch {}
    // Collapse side UI for focus while generating
    try { document.dispatchEvent(new CustomEvent('side-menu-set-collapsed', { detail: { collapsed: true } })); } catch {}
    try { document.dispatchEvent(new CustomEvent('page-manager-set-collapsed', { detail: { collapsed: true } })); } catch {}

    // Set initial progress
    state.setPanelGenerationProgress(panelId, true, customAssets.player ? 'Generating game with your 3D model...' : 'Generating game code...');

    // Determine which model to use: explicit parameter > store preference > default
    const preferredModel = state.preferredGameModel || 'gemini';
    const effectiveProvider = provider || (model ? (model.includes('claude') ? 'claude' : 'gemini') : preferredModel);
    const actualModel = model || (preferredModel === 'claude' ? 'claude-opus-4-5-20251101' : 'gemini-3-pro-preview');
    console.log(`[generate_game] Using model: ${actualModel} (provider: ${effectiveProvider}, preferred: ${preferredModel})`);

    // Try AI streaming FIRST for creative custom games
    try {
      try { await fetch('/api/game/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panelId, stage: 'start', message: 'Starting AI generation', has3DModel: !!customAssets.player, model: actualModel }) }); } catch {}
      const streamResp = await fetch('/api/game/generate-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          description, 
          provider: effectiveProvider,
          model: actualModel, 
          options,
          customAssets: Object.keys(customAssets).length > 0 ? customAssets : undefined
        }),
      } as any);
      if (!streamResp.ok || !(streamResp as any).body) throw new Error('Stream failed to start');

      const reader = (streamResp as any).body.getReader();
      const decoder = new TextDecoder();
      let gameCode = '';
      let buffer = '';
      console.log(`[generate_game] Starting stream read...`);
      
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          console.log(`[generate_game] Stream done. Accumulated code length: ${gameCode.length}`);
          break;
        }
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer
        
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6); // Remove 'data: ' prefix
          if (!data || data === '[DONE]') continue;
          
          try {
            const evt = JSON.parse(data);
            if (evt.event === 'delta' && typeof evt.text === 'string') {
              gameCode += evt.text;
              console.log(`[generate_game] Delta received, total length: ${gameCode.length}`);
              // Broadcast live delta to UI
              try { document.dispatchEvent(new CustomEvent('panel-game-code-delta', { detail: { panelId, text: evt.text } })); } catch {}
            } else if (evt.event === 'replace' && typeof evt.text === 'string') {
              // Replace event: discard accumulated code and use this instead (from auto-repair or template fallback)
              console.log(`[generate_game] Received replace event - using ${evt.text.length} chars of repaired/template code`);
              gameCode = evt.text;
            } else if (evt.event === 'done') {
              console.log(`[generate_game] Done event received`);
              break;
            }
          } catch (parseError) {
            console.warn(`[generate_game] Failed to parse stream line:`, data.substring(0, 100));
          }
        }
      }

      // Update progress to finalizing
      state.setPanelGenerationProgress(panelId, true, 'Initializing game...');
      try { await fetch('/api/game/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panelId, stage: 'complete', message: `Stream complete len=${gameCode.length}` }) }); } catch {}

      // Update panel with code
      const updatedPanel = { ...newPanel, gameCode };
      await state.updatePanel(updatedPanel, currentPage);

      // Clear progress
      state.clearPanelGenerationProgress(panelId);

      // Signal viewer to run the streamed code now with metadata
      try { 
        document.dispatchEvent(new CustomEvent('panel-game-code-run', { 
          detail: { 
            panelId,
            source: 'generated', // Streaming is AI-generated
            gameType: 'dodger' // Default for now
          } 
        })); 
      } catch {}
      try { await fetch('/api/game/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panelId, stage: 'run', message: 'Dispatch run event to GameViewer' }) }); } catch {}

      this.evi?.socket?.send(JSON.stringify({
        type: 'tool_response',
        tool_call_id: toolCallId,
        content: JSON.stringify({ success: true, action: 'generate_game', panel_id: panelId, method: 'ai' })
      }));
      this.completeToolCall(toolCallId);
    } catch (error) {
      console.warn('AI streaming failed, falling back to template:', error);
      
      // Fall back to template if AI fails
      try {
        try { await fetch('/api/game/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panelId, stage: 'start', message: 'AI failed - using template fallback' }) }); } catch {}
        
        const templateResp = await fetch('/api/game/generate-template', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            description,
            customAssets: Object.keys(customAssets).length > 0 ? customAssets : undefined
          })
        });
        
        if (templateResp.ok) {
          const templateData = await templateResp.json();
          if (templateData.gameCode) {
            const gameCode = templateData.gameCode;
            
            // Simulate streaming for consistent UX
            const chunks = gameCode.match(/.{1,50}/g) || [];
            for (let i = 0; i < chunks.length; i++) {
              const chunk = chunks[i];
              try { document.dispatchEvent(new CustomEvent('panel-game-code-delta', { detail: { panelId, text: chunk } })); } catch {}
              const delay = i < 10 ? 50 : (i < 30 ? 30 : 15);
              await new Promise(r => setTimeout(r, delay));
            }
            
            state.setPanelGenerationProgress(panelId, true, 'Initializing game...');
            try { await fetch('/api/game/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panelId, stage: 'complete', message: `Template fallback success len=${gameCode.length}` }) }); } catch {}
            
            const updatedPanel = { ...newPanel, gameCode };
            await state.updatePanel(updatedPanel, currentPage);
            
            try { 
              document.dispatchEvent(new CustomEvent('panel-game-code-run', { 
                detail: { 
                  panelId, 
                  source: templateData.source || 'template',
                  gameType: templateData.gameType || 'dodger'
                } 
              })); 
            } catch {}
            
            state.clearPanelGenerationProgress(panelId);
            this.evi?.socket?.send(JSON.stringify({
              type: 'tool_response',
              tool_call_id: toolCallId,
              content: JSON.stringify({ success: true, action: 'generate_game', panel_id: panelId, method: 'template_fallback' })
            }));
            this.completeToolCall(toolCallId);
            return;
          }
        }
      } catch (fallbackError) {
        console.error('Template fallback also failed:', fallbackError);
      }
      
      // If everything fails
      state.setPanelGenerationProgress(panelId, false, 'Generation failed');
      try {
        this.evi?.socket?.send(JSON.stringify({
          type: 'tool_response',
          tool_call_id: toolCallId,
          content: JSON.stringify({ success: false, action: 'generate_game', error: (error as any)?.message || 'failed' })
        }));
        this.completeToolCall(toolCallId);
      } catch {}
    }
  }

  // Handle switching the AI model for game generation
  private handleSetGameModelTool(toolCallId: string, parameters: any) {
    try {
      let parsed: any = parameters;
      if (typeof parameters === 'string') {
        try { parsed = JSON.parse(parameters); } catch { parsed = {}; }
      }

      const modelInput = String(parsed?.model ?? '').trim().toLowerCase();
      
      // Map user input to valid model values
      let model: 'gemini' | 'claude';
      if (modelInput.includes('claude') || modelInput.includes('opus') || modelInput.includes('anthropic')) {
        model = 'claude';
      } else if (modelInput.includes('gemini') || modelInput.includes('google')) {
        model = 'gemini';
      } else {
        // Default to toggling if unclear
        const state = useComicStore.getState();
        model = state.preferredGameModel === 'gemini' ? 'claude' : 'gemini';
      }

      const state = useComicStore.getState();
      state.setPreferredGameModel(model);

      const modelName = model === 'claude' ? 'Claude Opus 4.5' : 'Gemini 3 Pro';
      console.log(`[set_game_model] Switched to ${modelName}`);
      
      this.speak(`Switched to ${modelName} for game generation.`);

      this.evi?.socket?.send(JSON.stringify({
        type: 'tool_response',
        tool_call_id: toolCallId,
        content: JSON.stringify({ success: true, action: 'set_game_model', model, modelName })
      }));
      this.completeToolCall(toolCallId);
    } catch (e: any) {
      console.error('[set_game_model] Error:', e);
      this.sendToolErrorResponse(toolCallId, e?.message || 'Failed to switch model');
    }
  }

  private async handleEditGameTool(toolCallId: string, parameters: any) {
    try {
      // Parse parameters
      let parsed: any = parameters;
      if (typeof parameters === 'string') {
        try { parsed = JSON.parse(parameters); } catch { parsed = {}; }
      }

      const modification: string = String(parsed?.modification ?? '').trim();
      const currentCode: string = String(parsed?.current_code ?? '').trim();
      const panelId: string = String(parsed?.panel_id ?? '').trim();

      if (!modification || !currentCode) {
        this.evi?.socket?.send(JSON.stringify({
          type: 'tool_response',
          tool_call_id: toolCallId,
          content: JSON.stringify({ success: false, error: 'Missing modification or current_code. Call getCanvasState first.' })
        }));
        this.completeToolCall(toolCallId);
        return;
      }

      console.log(`[edit_game] Modifying game: "${modification}" for panel ${panelId}`);

      // Call the edit API
      const response = await fetch('/api/game/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_code: currentCode,
          modification,
          panel_id: panelId
        })
      });

      const result = await response.json();

      if (result.success && result.gameCode) {
        // Update the panel with the modified code
        const state = useComicStore.getState();
        const currentPage = state.currentPageIndex;
        const existingPanel = state.currentComic?.pages[currentPage]?.find((p: any) => p.id === panelId);

        if (existingPanel) {
          const updatedPanel = { ...existingPanel, gameCode: result.gameCode };
          await state.updatePanel(updatedPanel, currentPage);

          // Trigger game reload
          try {
            document.dispatchEvent(new CustomEvent('panel-game-code-run', {
              detail: {
                panelId,
                source: 'edited',
                gameType: 'unknown'
              }
            }));
          } catch {}

          this.evi?.socket?.send(JSON.stringify({
            type: 'tool_response',
            tool_call_id: toolCallId,
            content: JSON.stringify({ success: true, action: 'edit_game', panel_id: panelId, modification })
          }));
        } else {
          throw new Error('Panel not found');
        }
      } else {
        // Edit failed, keep original
        this.evi?.socket?.send(JSON.stringify({
          type: 'tool_response',
          tool_call_id: toolCallId,
          content: JSON.stringify({ 
            success: false, 
            message: result.message || 'Edit would break the game, keeping original',
            action: 'edit_game'
          })
        }));
      }

      this.completeToolCall(toolCallId);
    } catch (error) {
      console.error('[edit_game] Error:', error);
      this.evi?.socket?.send(JSON.stringify({
        type: 'tool_response',
        tool_call_id: toolCallId,
        content: JSON.stringify({ success: false, error: (error as any)?.message || 'Edit failed' })
      }));
      this.completeToolCall(toolCallId);
    }
  }

  // Handle highlight_objects tool - detect and highlight specific objects across panels
  private normalizePageIndex(requestedPage: any, totalPages: number, currentPage: number): number {
    if (typeof requestedPage === 'number' && !Number.isNaN(requestedPage)) {
      if (requestedPage >= 0 && requestedPage < totalPages) return requestedPage;
      if (requestedPage > 0 && requestedPage <= totalPages) return requestedPage - 1;
    }
    if (typeof requestedPage === 'string') {
      const numeric = parseInt(requestedPage, 10);
      if (!Number.isNaN(numeric)) {
        if (numeric >= 0 && numeric < totalPages) return numeric;
        if (numeric > 0 && numeric <= totalPages) return numeric - 1;
      }
    }
    return currentPage;
  }

  private async handleHighlightObjectsTool(toolCallId: string, parameters: any) {
    if (!this.evi || !this.evi.socket) {
      console.error("Cannot handle highlight objects tool: evi or evi.socket is null.");
      return;
    }

    try {
      this.updateVisualIndicator(true, 'processing');
      
      // Parse parameters
      let parsedParams = parameters;
      if (typeof parameters === 'string') {
        try {
          parsedParams = JSON.parse(parameters);
        } catch (e) {
          console.error('Failed to parse highlight_objects parameters:', e);
          throw new Error('Invalid parameters format');
        }
      }

      const objectName = (parsedParams?.object_name || parsedParams?.objectName || '').trim();
      if (!objectName) {
        throw new Error('Missing required parameter: object_name');
      }

      console.log(`[highlight_objects] Searching for "${objectName}"...`);

      const storeState = useComicStore.getState();
      const currentComic = storeState.currentComic;
      if (!currentComic) {
        this.sendToolSuccessResponse(toolCallId, `No comic loaded to search for "${objectName}"`);
        this.updateVisualIndicator(true, 'idle');
        return;
      }

      const totalPages = currentComic.pages.length;
      const requestedPanelIds = new Set<string>();
      const rawPanelIdCandidates = [
        parsedParams?.panel_id,
        parsedParams?.panelId,
        parsedParams?.panelID,
        parsedParams?.panel,
      ];
      rawPanelIdCandidates.forEach((val) => {
        if (typeof val === 'string' && val.trim()) {
          requestedPanelIds.add(val.trim());
        }
      });
      if (Array.isArray(parsedParams?.panel_ids)) {
        parsedParams.panel_ids.forEach((val: any) => {
          if (typeof val === 'string' && val.trim()) requestedPanelIds.add(val.trim());
        });
      }

      const pageParam = parsedParams?.page_index ?? parsedParams?.pageIndex ?? parsedParams?.page_number ?? parsedParams?.page;
      const targetPageIndex = this.normalizePageIndex(pageParam, totalPages, storeState.currentPageIndex);

      const panelsToScan: Array<{panel: Panel, pageIdx: number}> = [];

      if (requestedPanelIds.size > 0) {
        currentComic.pages.forEach((page, pageIdx) => {
          page.forEach(panel => {
            if (panel && requestedPanelIds.has(panel.id) && panel.type === 'image' && panel.url) {
              panelsToScan.push({ panel, pageIdx });
            }
          });
        });
      } else {
        const pagesToCheck = new Set<number>();
        pagesToCheck.add(targetPageIndex);
        if (Array.isArray(parsedParams?.page_indices)) {
          parsedParams.page_indices.forEach((idx: any) => {
            const normalized = this.normalizePageIndex(idx, totalPages, storeState.currentPageIndex);
            pagesToCheck.add(normalized);
          });
        }
        pagesToCheck.forEach(pageIdx => {
          const pagePanels = currentComic.pages[pageIdx] || [];
          pagePanels.forEach(panel => {
            if (panel && panel.type === 'image' && panel.url) {
              panelsToScan.push({ panel, pageIdx });
            }
          });
        });
      }

      if (panelsToScan.length === 0) {
        this.sendToolSuccessResponse(toolCallId, `No image panels found on canvas`);
        this.updateVisualIndicator(true, 'idle');
        return;
      }

      // Limit the number of panels scanned per request to control costs
      const MAX_PANELS_PER_REQUEST = Math.min(parsedParams?.max_panels ?? 12, 20);
      const panelsSubset = panelsToScan.slice(0, MAX_PANELS_PER_REQUEST);

      console.log(`[highlight_objects] Evaluating ${panelsSubset.length} panel(s) for "${objectName}"`);

      const { generateMask } = await import('./sam3MaskService');
      const highlightedPanels: string[] = [];

      for (const { panel, pageIdx } of panelsSubset) {
        try {
          const maskResult = await generateMask(panel.url, objectName, 0.2, { mode: 'visual' });

          const maskBox =
            (Array.isArray((maskResult as any).box) ? (maskResult as any).box : null) ||
            (Array.isArray(maskResult.mask_data?.box) ? maskResult.mask_data?.box ?? null : null);

          if (maskResult.success && maskBox && Array.isArray(maskBox)) {
            const storeApi = useComicStore.getState();
            storeApi.setPanelMaskData(panel.id, objectName, {
              box: maskBox,
              score: (maskResult as any).score ?? maskResult.mask_data?.score ?? null,
              mask_url: maskResult.mask_url ?? null,
            });
            const currentHighlighted = storeApi.highlightedObjects[panel.id] || [];
            if (!currentHighlighted.includes(objectName)) {
              storeApi.setHighlightedObjects(panel.id, [...currentHighlighted, objectName]);
            }
            highlightedPanels.push(panel.id);
            console.log(`[highlight_objects] Found "${objectName}" in panel ${panel.id} on page ${pageIdx + 1}`);
          } else {
            console.log(`[highlight_objects] "${objectName}" not found in panel ${panel.id}`);
          }
        } catch (error) {
          console.warn(`[highlight_objects] Failed to highlight panel ${panel.id}:`, error);
        }
      }

      // Enable mask visualization if not already enabled
      if (highlightedPanels.length > 0) {
        const store = useComicStore.getState();
        store.setShowSAM3Masks(true);
        console.log(`[highlight_objects] Enabled SAM3 masks for ${highlightedPanels.length} panels`);
        
        // Force a small delay to ensure state updates propagate before responding
        await new Promise(resolve => setTimeout(resolve, 100));
      } else {
        console.log(`[highlight_objects] No panels contained "${objectName}"`);
      }
        
      const scannedCount = panelsSubset.length;
      const message = highlightedPanels.length > 0
        ? `Found "${objectName}" in ${highlightedPanels.length} panel${highlightedPanels.length > 1 ? 's' : ''}. Masks are now visible.`
        : `Checked ${scannedCount} panel${scannedCount === 1 ? '' : 's'} but did not find "${objectName}".`;

      this.sendToolSuccessResponse(toolCallId, message);
      this.updateVisualIndicator(true, 'idle');
    } catch (error) {
      console.error('[highlight_objects] Error:', error);
      this.sendToolErrorResponse(toolCallId, `Failed to highlight objects: ${error instanceof Error ? error.message : 'Unknown error'}`);
      this.updateVisualIndicator(true, 'idle');
    }
  }
}

// Export a singleton instance
export const humeEviService = new HumeEviService(); 