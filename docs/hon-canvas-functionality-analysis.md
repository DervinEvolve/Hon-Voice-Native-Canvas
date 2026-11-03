# Hon Canvas Functionality - Deep Analysis

## Executive Summary

This document provides a comprehensive analysis of Hon's functionality in the canvas, focusing on tool awareness, panel selection, and update mechanisms. The analysis identifies root causes for issues where:
1. Image editing doesn't update the selected panel in board mode
2. Video generation creates new panels instead of updating selected images

## Architecture Overview

### 0. Page Indexing System

**Important:** Pages use **0-indexed arrays internally** (standard JavaScript) but **1-indexed language for users/Hon**:
- Internal: `pages[0]`, `pages[1]`, `pages[2]` (0-indexed)
- User-facing: "page 1", "page 2", "page 3" (1-indexed)
- Conversion: `formatPageReference(0)` → "page 1"

**Why:** Keeps standard JavaScript array indexing while providing natural language for user communication.

**Location:** `src/utils/pageIndexing.ts` (helper functions for conversion)

### 1. Panel Selection System

**Two Selection Mechanisms:**
- `selectedPanelId` (string | null): Single panel selection (legacy, used in focus mode)
- `selectedPanelIds` (string[]): Multi-panel selection (board mode, lasso selection)

**Key Finding:** The store maintains both, but Hon's tool handlers primarily check `selectedPanelId` (singular), which may not reflect board mode multi-select state.

**Location:** `src/store/useComicStore.ts:38-39`

### 2. Semantic Panel ID System

**How It Works:**
- Panels are assigned semantic IDs like `panel-1`, `panel-2`, etc. (1-indexed for user-friendly references)
- Semantic IDs are generated **per-page** in `getCanvasState` tool
- Each page's panels are independently numbered starting from `panel-1`

**Critical Issue:** 
- `findPanelBySemanticId()` only searches within a **single page's panels array**
- In board mode, panels from all pages are visible, but semantic IDs are page-scoped
- When Hon references `panel-1`, it could mean different panels on different pages

**Location:** `src/services/humeEviService.ts:3589-3643`

### 3. Board Mode vs Focus Mode

**Focus Mode (Grid View):**
- Shows only current page panels (`currentPageIndex`)
- Panels arranged in template grid layout
- Semantic IDs work correctly (single page context)

**Board Mode (Infinite Canvas):**
- Shows panels from **all pages** simultaneously
- Panels positioned absolutely using `boardPositions` state
- Panels can be from different pages
- Semantic IDs become ambiguous (which page's `panel-1`?)

**Location:** `src/components/Creator.tsx:1137-1160`

## Tool System Analysis

### Tool: `getCanvasState`

**Purpose:** Provides Hon with current canvas state, panel information, and editing context

**Key Features:**
- Detects board mode (`isInBoardMode`) via scale threshold
- In board mode: Provides panels from **all pages** with `allPagesData` and `allPanelsFlat`
- Generates semantic IDs per-page: `semanticId: panel-${index + 1}` (1-indexed)
- Includes `selectedPanelSemanticId` and `recommendedEditTarget` for guidance

**Board Mode Behavior:**
```typescript
if (isInBoardMode && currentComic) {
  // Provides all pages data
  currentComic.pages.forEach((page, pageIdx) => {
    allPagesData.push({pageIndex: pageIdx, panels: page, template: pageTemplate});
    // Each page's panels get semantic IDs like panel-1, panel-2, etc.
  });
}
```

**Issue:** Semantic IDs are generated per-page, but when Hon uses them, `findPanelBySemanticId` only searches the current page.

**Location:** `src/services/humeEviService.ts:2074-2503`

### Tool: `canvas_editor_tool`

**Actions:** `generate_image`, `edit_image`

#### Image Editing Flow (`edit_image`)

**Current Implementation:**
1. **Target Resolution (lines 2871-2884):**
   - If `target_element_id` provided: Searches **all pages** for panel
   - Uses `findPanelBySemanticId()` which only searches **current page**
   - **BUG:** Multi-page search doesn't work because `findPanelBySemanticId` is page-scoped

2. **Fallback to Selected Panel (lines 2894-2911):**
   - Checks `state.selectedPanelId` (singular)
   - Searches all pages for selected panel ID
   - **Issue:** In board mode, `selectedPanelIds` (plural) may be set, but code checks `selectedPanelId` (singular)

3. **Panel Update (lines 2995-3009):**
   - Uses `resolvedPageIndex` and `resolvedTargetPanel`
   - Calls `updatePanel(updatedPanel, targetPageIndex)`
   - **Should work IF** target was correctly resolved

**Root Cause Analysis:**
- `findPanelBySemanticId()` is called within a loop over pages (line 2877)
- But `findPanelBySemanticId()` itself only searches the panels array passed to it
- The function doesn't know about board mode or multi-page context
- When semantic ID is `panel-1`, it finds the first panel on each page, not necessarily the intended one

**Location:** `src/services/humeEviService.ts:2805-3100`

#### Image Generation Flow (`generate_image`)

**Current Implementation:**
- If `target_element_id`: Updates existing panel
- Else: Creates new panel at (0,0)
- **Works correctly** because it uses direct panel lookup

**Location:** `src/services/humeEviService.ts:2720-2803`

### Tool: `luma_video_generation` / Seedance Video

**Current Implementation:**

**Video Generation Start (lines 3300-3399):**
1. Detects image-to-video vs text-to-video
2. Resolves target panel ID:
   - Uses `detectedRealPanelId` (from prompt parsing)
   - Falls back to `state.selectedPanelId` (singular)
   - Falls back to `selectedIds[0]` (from `selectedPanelIds` array)
3. Stores mapping: `seedanceRequestToTargetId.set(requestId, hardTargetId)`
4. Starts polling with `targetForPolling`

**Video Completion (lines 3756-3900):**
1. Retrieves bound target: `boundTargetId = seedanceRequestToTargetId.get(requestId) || targetPanelId`
2. Searches **all pages** for panel by direct ID (lines 3780-3799)
3. Updates panel if found
4. **Fallback:** If not found, checks `selectedPanelIds[0]` or `selectedPanelId`
5. **Last Resort:** Creates new panel if no selection

**Root Cause Analysis:**
- Video generation **does** search all pages (line 3781-3798)
- But it uses **direct panel ID**, not semantic ID
- The issue: When Hon uses semantic ID like `panel-1`, it needs to be resolved to actual panel ID first
- If semantic ID resolution fails (because `findPanelBySemanticId` only searches current page), the target isn't found
- Then it falls back to selected panel, but checks `selectedPanelId` (singular) which may be null in board mode
- Finally creates a new panel instead of updating

**Location:** `src/services/humeEviService.ts:3170-3900`

## Root Causes Identified

### Issue 1: Image Editing Not Updating Panel in Board Mode

**Root Causes:**
1. **Semantic ID Resolution Limitation:**
   - `findPanelBySemanticId()` only searches within a single page's panels array
   - When called in a loop (line 2877), it searches each page independently
   - If multiple pages have a `panel-1`, it finds the first one encountered, not necessarily the selected one

2. **Selected Panel Fallback Issue:**
   - Code checks `state.selectedPanelId` (singular)
   - In board mode, `selectedPanelIds` (plural array) may be set instead
   - The singular `selectedPanelId` may be null or point to wrong panel

3. **Page Index Resolution:**
   - Even if panel is found, `resolvedPageIndex` may be incorrect
   - Update happens on wrong page, making it appear like nothing happened

### Issue 2: Video Generation Creates New Panel Instead of Updating

**Root Causes:**
1. **Semantic ID to Real ID Conversion:**
   - Video generation receives semantic ID from Hon (e.g., `panel-1`)
   - Tries to resolve using `findPanelBySemanticId()` which only searches current page
   - If panel is on different page, resolution fails
   - Falls back to selected panel, but checks wrong selection state

2. **Selection State Mismatch:**
   - Board mode uses `selectedPanelIds` (array)
   - Video code checks `selectedPanelId` (singular) first
   - May be null or incorrect
   - Falls through to creating new panel

3. **Target Binding Timing:**
   - Target is bound at video start (line 3371)
   - If semantic ID resolution fails at start, `boundTargetId` is wrong
   - When video completes, wrong target is used or none found

## Current Workarounds and Fallbacks

### Image Editing Fallbacks:
1. Try to find target by semantic ID (searches all pages, but function is page-scoped)
2. Fallback to selected panel (checks singular `selectedPanelId`)
3. Fallback to next available panel position
4. Last resort: Create new panel at (0,0)

### Video Generation Fallbacks:
1. Use bound target ID from request start
2. Search all pages for direct panel ID match
3. Fallback to semantic ID search (current page only)
4. Fallback to selected panel (`selectedPanelIds[0]` or `selectedPanelId`)
5. Last resort: Create new panel

## Key Functions Analysis

### `findPanelBySemanticId(semanticId: string, panels: Panel[]): Panel | null`

**Current Behavior:**
- Takes semantic ID (e.g., `panel-1`) and single page's panels array
- Sorts panels by position (or creation order for custom templates)
- Returns panel at index (0-indexed, so `panel-1` = index 0)
- **Limitation:** Only works within single page context

**What It Should Do in Board Mode:**
- Accept panels from all pages
- Resolve semantic ID considering which page the panel is on
- Or use a global semantic ID system for board mode

**Location:** `src/services/humeEviService.ts:3589-3643`

### `getCanvasState` Tool Response

**Current Response Structure:**
```typescript
{
  currentPageIndex: number,
  selectedPanelId: string | null,
  selectedPanelSemanticId: string | null, // e.g., "panel-1"
  panels: [...], // Current page panels with semantic IDs
  // In board mode:
  allPagesData: [...], // All pages with panels
  allPanelsFlat: [...], // Flattened with pageIndex
}
```

**Issue:** Semantic IDs are per-page, but Hon may not understand which page a semantic ID refers to when in board mode.

## Board Mode Specific Challenges

1. **Multi-Page Visibility:** All panels visible simultaneously, but semantic IDs are page-scoped
2. **Selection State:** Uses `selectedPanelIds` array, but many tools check `selectedPanelId` singular
3. **Panel Resolution:** `findPanelBySemanticId` doesn't account for multi-page context
4. **Page Index Tracking:** When updating panels, correct page index must be determined

## Recommendations for Production-Ready Solutions

### Solution 1: Enhance `findPanelBySemanticId` for Board Mode

**Approach:**
- Modify function to accept optional `allPages` parameter
- When in board mode, search across all pages
- Return both panel and page index
- Use global semantic IDs in board mode (e.g., `page-0-panel-1`, `page-1-panel-2`)

**Pros:** Minimal changes, backward compatible
**Cons:** Semantic ID format change may confuse Hon

### Solution 2: Use Direct Panel IDs Instead of Semantic IDs

**Approach:**
- `getCanvasState` should include actual panel IDs in response
- Hon should use actual panel IDs when available
- Fallback to semantic IDs only when necessary
- Store actual panel ID → semantic ID mapping

**Pros:** More reliable, no ambiguity
**Cons:** Requires Hon to understand and use actual IDs

### Solution 3: Fix Selection State Handling

**Approach:**
- Create helper: `getSelectedPanelId()` that checks both `selectedPanelIds[0]` and `selectedPanelId`
- Use this helper consistently across all tool handlers
- Ensure board mode always sets `selectedPanelId` when `selectedPanelIds` changes

**Pros:** Quick fix, addresses immediate issue
**Cons:** Doesn't solve semantic ID resolution problem

### Solution 4: Board Mode Global Semantic IDs

**Approach:**
- In board mode, generate global semantic IDs: `page-0-panel-1`, `page-1-panel-2`
- Update `getCanvasState` to use global IDs in board mode
- Update `findPanelBySemanticId` to parse and resolve global IDs
- Update Hon's tool descriptions to use global IDs

**Pros:** Solves root cause, clear and unambiguous
**Cons:** Requires Hon tool schema updates, more complex

### Solution 5: Hybrid Approach (Recommended)

**Approach:**
1. **Fix Selection State:** Always sync `selectedPanelId` with `selectedPanelIds[0]`
2. **Enhance Panel Resolution:** Make `findPanelBySemanticId` board-mode aware
3. **Improve Target Binding:** Store both semantic ID and actual panel ID
4. **Add Page Index Tracking:** Include page index in panel resolution results

**Implementation Steps:**
1. Update `setSelectedPanelIds` to also set `selectedPanelId = panelIds[0]`
2. Create `findPanelBySemanticIdAcrossPages(semanticId, comic)` helper
3. Update all tool handlers to use new helper in board mode
4. Store page index with target binding for video generation
5. Update panel update calls to use correct page index

## Testing Scenarios to Verify Fixes

1. **Board Mode Image Edit:**
   - Select panel on page 0 in board mode
   - Ask Hon: "Edit this image to add a sunset"
   - Verify: Panel on page 0 is updated, not new panel created

2. **Board Mode Video Generation:**
   - Select image panel on page 1 in board mode
   - Ask Hon: "Turn this into a video"
   - Verify: Same panel becomes video, no new panel created

3. **Multi-Page Semantic ID:**
   - Have panels on multiple pages
   - In board mode, ask Hon: "Edit panel-1"
   - Verify: Correct panel (considering page context) is edited

4. **Selection Fallback:**
   - Select panel in board mode (using lasso/multi-select)
   - Ask Hon to edit without specifying panel
   - Verify: Selected panel is edited, not new panel created

## Current Code Flow Diagrams

### Image Editing Flow (Current - Broken in Board Mode)
```
User: "Edit selected image"
  ↓
Hon calls canvas_editor_tool(action="edit_image")
  ↓
If target_element_id provided:
  → Loop through all pages
    → Call findPanelBySemanticId(target_element_id, currentPagePanels)
      → ❌ Only searches current page, not all pages
  → If found: resolvedTargetPanel, resolvedPageIndex
  → Else: Fallback to selectedPanelId (singular)
    → ❌ May be null in board mode
  → Else: Create new panel
    → ❌ Wrong behavior
```

### Video Generation Flow (Current - Creates New Panel)
```
User: "Turn this image into video"
  ↓
Hon calls luma_video_generation(target_element_id="panel-1")
  ↓
Resolve target:
  → Try findPanelBySemanticId("panel-1", currentPagePanels)
    → ❌ Only searches current page
  → Fallback to selectedPanelId
    → ❌ May be null
  → Bind targetPanelId (may be wrong)
  ↓
Start video generation
  ↓
On completion:
  → Search all pages for boundTargetId
    → ✅ This part works
  → If not found: Fallback to selectedPanelIds[0]
    → ✅ This part works
  → If not found: Create new panel
    → ❌ Wrong behavior if selection exists
```

## Conclusion

The core issues stem from:
1. **Semantic ID system being page-scoped** while board mode shows all pages
2. **Selection state mismatch** between `selectedPanelId` (singular) and `selectedPanelIds` (array)
3. **Panel resolution function limitations** that don't account for multi-page context
4. **Inconsistent fallback logic** that creates new panels instead of updating selected ones

The recommended hybrid solution addresses all these issues while maintaining backward compatibility and requiring minimal changes to Hon's tool schemas.

