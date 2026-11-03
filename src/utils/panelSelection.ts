/**
 * Panel Selection Utilities
 * 
 * Provides consistent access to selected panel IDs across the application.
 * Handles both single-select (selectedPanelId) and multi-select (selectedPanelIds) states.
 * 
 * This ensures Hon's tool handlers can reliably find the selected panel(s)
 * regardless of which selection mechanism was used (focus mode vs board mode).
 */

import type { State } from '../store/useComicStore';

/**
 * Get the primary selected panel ID
 * 
 * Prioritizes multi-select (board mode), falls back to single-select (focus mode).
 * This ensures board mode selections work correctly even if selectedPanelId isn't synced.
 * 
 * @param state The comic store state
 * @returns The selected panel ID, or null if none selected
 * 
 * @example
 * const selectedId = getSelectedPanelId(useComicStore.getState());
 * if (selectedId) {
 *   // Use selectedId to find and update panel
 * }
 */
export function getSelectedPanelId(state: State): string | null {
  // Prioritize multi-select (board mode) - this is the newer, more reliable mechanism
  const multiSelect = state.selectedPanelIds?.[0];
  if (multiSelect) {
    return multiSelect;
  }
  
  // Fallback to single-select (focus mode) - legacy support
  return state.selectedPanelId || null;
}

/**
 * Get all selected panel IDs
 * 
 * Returns all selected panels, prioritizing multi-select array.
 * 
 * @param state The comic store state
 * @returns Array of selected panel IDs (may be empty)
 * 
 * @example
 * const selectedIds = getAllSelectedPanelIds(useComicStore.getState());
 * selectedIds.forEach(panelId => {
 *   // Process each selected panel
 * });
 */
export function getAllSelectedPanelIds(state: State): string[] {
  // Prioritize multi-select array (board mode)
  if (state.selectedPanelIds && state.selectedPanelIds.length > 0) {
    return [...state.selectedPanelIds]; // Return copy to prevent mutations
  }
  
  // Fallback: if single-select is set, return as array
  if (state.selectedPanelId) {
    return [state.selectedPanelId];
  }
  
  return [];
}

/**
 * Check if a specific panel is selected
 * 
 * @param state The comic store state
 * @param panelId The panel ID to check
 * @returns True if the panel is selected
 * 
 * @example
 * if (isPanelSelected(state, panel.id)) {
 *   // Panel is selected
 * }
 */
export function isPanelSelected(state: State, panelId: string): boolean {
  // Check multi-select array first
  if (state.selectedPanelIds?.includes(panelId)) {
    return true;
  }
  
  // Check single-select
  return state.selectedPanelId === panelId;
}

/**
 * Get selection count
 * 
 * @param state The comic store state
 * @returns Number of selected panels
 */
export function getSelectionCount(state: State): number {
  if (state.selectedPanelIds && state.selectedPanelIds.length > 0) {
    return state.selectedPanelIds.length;
  }
  return state.selectedPanelId ? 1 : 0;
}

