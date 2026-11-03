// Generated code must not share the application's origin, storage, or DOM.
export const GAME_FRAME_SANDBOX = 'allow-scripts allow-pointer-lock';

const gameEvents = new Set(['hon-game-started', 'hon-game-error', 'hon-game-over']);

export function readGameFrameMessage(event: MessageEvent, frame: Window | null | undefined, panelId?: string) {
  if (!frame || event.source !== frame || event.origin !== 'null') return null;
  const data = event.data;
  if (!data || typeof data !== 'object' || Array.isArray(data) || !gameEvents.has(data.type)) return null;
  if (data.panelId && panelId && data.panelId !== panelId) return null;
  return {
    type: data.type as 'hon-game-started' | 'hon-game-error' | 'hon-game-over',
    message: typeof data.message === 'string' ? data.message.slice(0, 2000) : '',
  };
}
