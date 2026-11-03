/**
 * Simple shared state for moodboard generation
 * Used to suppress auto-captioning and detection during moodboard creation
 */

// Cooldown period after moodboard ends (ms) - prevents debounced hooks from triggering
const MOODBOARD_COOLDOWN_MS = 3000;

let cooldownUntil = 0;

export const moodboardState = {
  isGenerating: false,

  /**
   * Check if moodboard generation is active OR in cooldown period
   * Use this to prevent auto-analysis/captioning from triggering
   */
  get shouldSuppressAutoAnalysis(): boolean {
    return this.isGenerating || Date.now() < cooldownUntil;
  },

  /**
   * Start moodboard generation
   */
  start(): void {
    this.isGenerating = true;
    cooldownUntil = 0;
  },

  /**
   * End moodboard generation and start cooldown period
   */
  end(): void {
    this.isGenerating = false;
    cooldownUntil = Date.now() + MOODBOARD_COOLDOWN_MS;
  }
};
