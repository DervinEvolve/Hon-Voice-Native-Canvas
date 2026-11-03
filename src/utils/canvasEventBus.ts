/**
 * Canvas Event Bus - Typed event system for canvas interactions
 * 
 * Replaces document.dispatchEvent/addEventListener with a type-safe event bus.
 */

type EventCallback<T = any> = (data: T) => void;

// Define all canvas event types
export interface CanvasEvents {
  // Zoom/Pan events
  'canvas-zoom-in': void;
  'canvas-zoom-out': void;
  'canvas-reset': void;
  'canvas-fit-view': void;
  
  // Mode events
  'enter-board-mode': void;
  'enter-focus-mode': { pageIndex: number };
  'panel-editor-open-state': { open: boolean };
  
  // Selection events
  'board-selection-changed': { panelIds: string[] };
  'clear-selection': void;
  
  // Panel events
  'panel-scale-set': { id: string; scale: number };
  'panel-move': { panelId: string; position: { x: number; y: number } };
  'panel-remove': { panelId: string; pageIndex: number };
  'panel-game-show-code': { panelId: string };
  
  // Layout events
  'board-layout-apply': { positions: Record<string, { x: number; y: number }>; force?: boolean };
  
  // Side menu events
  'side-menu-collapsed': { collapsed: boolean };
  'side-menu-set-collapsed': { collapsed: boolean };
  
  // Page manager events
  'page-manager-set-collapsed': { collapsed: boolean };
  
  // Notion events
  'add-notion-panel': { forceAuth?: boolean };
  'notion-type-bullets': { panelId: string; pageId: string; bullets: string[] };
  'request-notion-summarize': { panelId: string; pageId: string };
}

class CanvasEventBus {
  private listeners: Map<keyof CanvasEvents, Set<EventCallback>> = new Map();
  private legacyMode: boolean = true; // Enable legacy document events for backward compatibility

  /**
   * Subscribe to an event
   */
  on<K extends keyof CanvasEvents>(
    event: K,
    callback: EventCallback<CanvasEvents[K]>
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  /**
   * Subscribe to an event (alias for on)
   */
  subscribe<K extends keyof CanvasEvents>(
    event: K,
    callback: EventCallback<CanvasEvents[K]>
  ): () => void {
    return this.on(event, callback);
  }

  /**
   * Emit an event
   */
  emit<K extends keyof CanvasEvents>(
    event: K,
    data?: CanvasEvents[K]
  ): void {
    // Call typed listeners
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[CanvasEventBus] Error in listener for ${event}:`, error);
        }
      });
    }

    // Also dispatch legacy document event for backward compatibility
    if (this.legacyMode && typeof document !== 'undefined') {
      try {
        document.dispatchEvent(new CustomEvent(event, { detail: data }));
      } catch (error) {
        console.warn(`[CanvasEventBus] Failed to dispatch legacy event ${event}:`, error);
      }
    }
  }

  /**
   * Remove all listeners for an event
   */
  off<K extends keyof CanvasEvents>(event: K): void {
    this.listeners.delete(event);
  }

  /**
   * Remove all listeners
   */
  clear(): void {
    this.listeners.clear();
  }

  /**
   * Set legacy mode (document events)
   */
  setLegacyMode(enabled: boolean): void {
    this.legacyMode = enabled;
  }

  /**
   * Create a bridge listener that forwards legacy document events to the bus
   * Useful during migration period
   */
  bridgeLegacyEvent<K extends keyof CanvasEvents>(event: K): () => void {
    if (typeof document === 'undefined') {
      return () => {};
    }

    const handler = (e: Event) => {
      const customEvent = e as CustomEvent;
      // Don't re-emit if we're in legacy mode (would cause infinite loop)
      if (!this.legacyMode) {
        this.emit(event, customEvent.detail);
      }
    };

    document.addEventListener(event, handler);
    return () => document.removeEventListener(event, handler);
  }
}

// Singleton instance
export const canvasEventBus = new CanvasEventBus();

// Export type for event names
export type CanvasEventName = keyof CanvasEvents;

// Helper hooks-style function for React components
export function useCanvasEvent<K extends keyof CanvasEvents>(
  event: K,
  callback: EventCallback<CanvasEvents[K]>,
  deps: React.DependencyList = []
): void {
  // This would be used with useEffect in a React component
  // Implementation left to the component using it
}

