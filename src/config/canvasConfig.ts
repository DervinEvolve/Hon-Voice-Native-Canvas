/**
 * Canvas Configuration - Centralized constants for the Creator canvas
 * 
 * All magic numbers and configuration values for the canvas experience.
 */

// Board mode layout constants
export const BOARD_CONFIG = {
  /** Base panel width in pixels */
  CELL_WIDTH: 307,
  /** Base panel height in pixels */
  CELL_HEIGHT: 307,
  /** Gap between panels in grid layout */
  GAP: 40,
  /** Base visual scale for board items */
  ITEM_SCALE: 1.19,
  /** Scale multiplier for game panels */
  GAME_SCALE_MULTIPLIER: 1.2,
} as const;

// Zoom configuration
export const ZOOM_CONFIG = {
  /** Minimum zoom level */
  MIN_ZOOM: 0.25,
  /** Maximum zoom level */
  MAX_ZOOM: 5,
  /** Zoom step for mouse wheel */
  ZOOM_STEP: 0.06,
  /** Zoom step for button controls */
  ZOOM_STEP_LARGE: 0.12,
  /** Scale threshold below which board/overview mode activates */
  OVERVIEW_THRESHOLD: 0.65,
} as const;

// Panel scale constraints
export const PANEL_SCALE_CONFIG = {
  /** Minimum panel scale */
  MIN_SCALE: 0.8,
  /** Maximum panel scale */
  MAX_SCALE: 1.6,
  /** Scale sensitivity (pixels per 1.0 scale change) */
  SENSITIVITY: 240,
} as const;

// Alignment/snapping configuration
export const ALIGNMENT_CONFIG = {
  /** Snap threshold in pixels (at scale 1.0) */
  SNAP_THRESHOLD: 10,
} as const;

// Animation durations (in milliseconds)
export const ANIMATION_CONFIG = {
  /** Canvas transform transition duration */
  CANVAS_TRANSITION: 100,
  /** Panel appear/disappear duration */
  PANEL_TRANSITION: 200,
  /** Quick edit menu appear duration */
  MENU_TRANSITION: 150,
  /** Mode switch transition duration */
  MODE_TRANSITION: 200,
} as const;

// Hon indicator colors by processing state
export const HON_COLORS = {
  generating: 'rgba(139, 92, 246, 1.0)', // Purple
  editing: 'rgba(34, 197, 94, 1.0)', // Green
  dreaming: 'rgba(236, 72, 153, 1.0)', // Pink
  inspiring: 'rgba(59, 130, 246, 1.0)', // Blue
  reasoning: 'rgba(139, 92, 246, 1.0)', // Purple
  processing: 'rgba(139, 92, 246, 1.0)', // Purple
  idle: 'rgba(59, 130, 246, 1.0)', // Default blue
} as const;

// Z-index layers
export const Z_INDEX = {
  /** Base canvas layer */
  CANVAS: 0,
  /** World mode layer */
  WORLD_MODE: 10,
  /** Selected panel layer */
  SELECTED_PANEL: 100,
  /** Quick action buttons */
  QUICK_ACTIONS: 30,
  /** Quick edit menu */
  QUICK_EDIT_MENU: 50,
  /** Alignment guides */
  ALIGNMENT_GUIDES: 50,
  /** Page manager */
  PAGE_MANAGER: 60,
  /** Hon indicator */
  HON_INDICATOR: 40,
  /** Dropdown menus */
  DROPDOWN: 60,
  /** Modal overlays */
  MODAL: 100,
  /** Drag ghost */
  DRAG_GHOST: 9999,
} as const;

// Debounce delays (in milliseconds)
export const DEBOUNCE_CONFIG = {
  /** Zoom tracking debounce */
  ZOOM_TRACKING: 500,
  /** Auto-save debounce */
  AUTO_SAVE: 2000,
  /** Search input debounce */
  SEARCH: 300,
} as const;

// Export type for Hon processing states
export type HonColorState = keyof typeof HON_COLORS;

// Helper to get Hon color by state
export function getHonColor(state: HonColorState): string {
  return HON_COLORS[state] || HON_COLORS.idle;
}

// Helper to get Hon color with custom opacity
export function getHonColorWithOpacity(state: HonColorState, opacity: number): string {
  const color = HON_COLORS[state] || HON_COLORS.idle;
  return color.replace('1.0', String(opacity));
}

