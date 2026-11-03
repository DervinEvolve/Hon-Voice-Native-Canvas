/**
 * Page Indexing Utilities
 * 
 * Standardizes page number conversion between:
 * - Internal: 0-indexed (JavaScript arrays: pages[0], pages[1])
 * - User-facing: 1-indexed (Natural language: "page 1", "page 2")
 * 
 * This ensures consistent user experience when communicating with Hon
 * while maintaining standard JavaScript array indexing internally.
 */

/**
 * Convert internal 0-indexed page index to user-facing 1-indexed page number
 * @param internalIndex 0-indexed page index (from arrays)
 * @returns 1-indexed page number (for users/Hon)
 * 
 * @example
 * toUserPageNumber(0) // Returns 1 (first page)
 * toUserPageNumber(2) // Returns 3 (third page)
 */
export function toUserPageNumber(internalIndex: number): number {
  if (internalIndex < 0) {
    throw new Error(`Invalid internal page index: ${internalIndex}. Must be >= 0.`);
  }
  return internalIndex + 1;
}

/**
 * Convert user-facing 1-indexed page number to internal 0-indexed index
 * @param userPageNumber 1-indexed page number (from users/Hon)
 * @returns 0-indexed page index (for arrays)
 * 
 * @example
 * toInternalPageIndex(1) // Returns 0 (first page)
 * toInternalPageIndex(3) // Returns 2 (third page)
 */
export function toInternalPageIndex(userPageNumber: number): number {
  if (userPageNumber < 1) {
    throw new Error(`Invalid page number: ${userPageNumber}. Pages start from 1.`);
  }
  return userPageNumber - 1;
}

/**
 * Format page reference for user/Hon communication
 * Always uses 1-indexed format ("page 1", "page 2")
 * 
 * @param internalIndex 0-indexed page index
 * @returns Formatted string like "page 1", "page 2"
 * 
 * @example
 * formatPageReference(0) // Returns "page 1"
 * formatPageReference(2) // Returns "page 3"
 */
export function formatPageReference(internalIndex: number): string {
  return `page ${toUserPageNumber(internalIndex)}`;
}

/**
 * Parse page reference from user/Hon input
 * Handles various formats: "page 1", "page1", "1", "first page", etc.
 * 
 * @param input User input string
 * @returns 0-indexed page index, or null if invalid
 * 
 * @example
 * parsePageReference("page 1") // Returns 0
 * parsePageReference("first page") // Returns 0
 * parsePageReference("page 3") // Returns 2
 * parsePageReference("invalid") // Returns null
 */
export function parsePageReference(input: string): number | null {
  if (!input || typeof input !== 'string') {
    return null;
  }
  
  // Handle "page 1", "page1", "1"
  const numericMatch = input.match(/(?:page\s*)?(\d+)/i);
  if (numericMatch) {
    const pageNum = parseInt(numericMatch[1], 10);
    try {
      return toInternalPageIndex(pageNum);
    } catch {
      return null;
    }
  }
  
  // Handle "first page", "second page", etc.
  const ordinalMap: Record<string, number> = {
    'first': 1,
    'second': 2,
    'third': 3,
    'fourth': 4,
    'fifth': 5,
    'sixth': 6,
    'seventh': 7,
    'eighth': 8,
    'ninth': 9,
    'tenth': 10,
  };
  
  const lowerInput = input.toLowerCase();
  for (const [ordinal, pageNum] of Object.entries(ordinalMap)) {
    if (lowerInput.includes(ordinal)) {
      try {
        return toInternalPageIndex(pageNum);
      } catch {
        return null;
      }
    }
  }
  
  return null;
}

/**
 * Format page range for user/Hon communication
 * 
 * @param startIndex 0-indexed start page index
 * @param endIndex 0-indexed end page index (inclusive)
 * @returns Formatted string like "pages 1-3"
 * 
 * @example
 * formatPageRange(0, 2) // Returns "pages 1-3"
 */
export function formatPageRange(startIndex: number, endIndex: number): string {
  const start = toUserPageNumber(startIndex);
  const end = toUserPageNumber(endIndex);
  
  if (start === end) {
    return formatPageReference(startIndex);
  }
  
  return `pages ${start}-${end}`;
}

