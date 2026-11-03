// Simple debug logger for board/moodboard mode. Enable with:
// localStorage.setItem('hon-debug-board', '1')  // enable
// localStorage.removeItem('hon-debug-board')    // disable
// or: window.HON_DEBUG_BOARD = true

// Determine whether board debug logs are enabled
export function isBoardDebugEnabled(): boolean {
  try {
    // @ts-ignore
    if (typeof window !== 'undefined' && window.HON_DEBUG_BOARD) return true;
  } catch {}
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('hon-debug-board') === '1';
    }
  } catch {}
  return false;
}

export function boardDebug(...args: any[]) {
  if (!isBoardDebugEnabled()) return;
  try {
    const ts = new Date().toISOString().split('T')[1]?.replace('Z','');
    // eslint-disable-next-line no-console
    console.log(`[BOARD ${ts}]`, ...args);
  } catch {
    // ignore
  }
}


