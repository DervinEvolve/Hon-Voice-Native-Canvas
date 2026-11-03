import { supabase } from '../utils/supabaseClient';

/**
 * Service for managing SAM3 panel embeddings in Supabase
 * Provides persistence and caching for expensive embedding generation
 */

// In-memory cache with TTL
const embeddingCache = new Map<string, { embedding: string; timestamp: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Get cached embedding from memory
 */
function getCachedEmbedding(key: string): string | null {
  const cached = embeddingCache.get(key);
  if (!cached) return null;
  
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    embeddingCache.delete(key);
    return null;
  }
  
  return cached.embedding;
}

/**
 * Set cached embedding in memory
 */
function setCachedEmbedding(key: string, embedding: string): void {
  embeddingCache.set(key, {
    embedding,
    timestamp: Date.now()
  });
}

/**
 * Generate cache key from panel ID and image URL
 */
function getCacheKey(panelId: string, imageUrl: string): string {
  return `${panelId}:${imageUrl}`;
}

/**
 * Save embedding to Supabase
 * @param panelId - Panel ID
 * @param comicId - Comic ID
 * @param imageUrl - Image URL
 * @param embedding - Base64-encoded SAM3 embedding
 */
export async function saveEmbedding(
  panelId: string,
  comicId: string,
  imageUrl: string,
  embedding: string
): Promise<void> {
  try {
    const { error } = await supabase
      .from('panel_embeddings')
      .upsert({
        panel_id: panelId,
        comic_id: comicId,
        image_url: imageUrl,
        embedding,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'panel_id,image_url'
      });

    if (error) {
      console.warn('[PanelEmbedding] Failed to save embedding:', error);
      throw error;
    }

    // Cache in memory
    setCachedEmbedding(getCacheKey(panelId, imageUrl), embedding);
    console.log('[PanelEmbedding] Saved embedding for panel:', panelId);
  } catch (error) {
    console.error('[PanelEmbedding] Error saving embedding:', error);
    throw error;
  }
}

/**
 * Get embedding from Supabase (with memory cache)
 * @param panelId - Panel ID
 * @param imageUrl - Image URL
 * @returns Base64-encoded embedding or null if not found
 */
export async function getEmbedding(
  panelId: string,
  imageUrl: string
): Promise<string | null> {
  // 1. Check memory cache first
  const cacheKey = getCacheKey(panelId, imageUrl);
  const cached = getCachedEmbedding(cacheKey);
  if (cached) {
    console.log('[PanelEmbedding] Using cached embedding for panel:', panelId);
    return cached;
  }

  // 2. Check Supabase
  try {
    const { data, error } = await supabase
      .from('panel_embeddings')
      .select('embedding')
      .eq('panel_id', panelId)
      .eq('image_url', imageUrl)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned (not found)
        return null;
      }
      console.warn('[PanelEmbedding] Failed to get embedding:', error);
      return null;
    }

    if (data?.embedding) {
      // Cache in memory
      setCachedEmbedding(cacheKey, data.embedding);
      console.log('[PanelEmbedding] Loaded embedding from Supabase for panel:', panelId);
      return data.embedding;
    }

    return null;
  } catch (error) {
    console.error('[PanelEmbedding] Error getting embedding:', error);
    return null;
  }
}

/**
 * Get all embeddings for a comic (for similarity search)
 * @param comicId - Comic ID
 * @returns Map of panelId -> embedding
 */
export async function getComicEmbeddings(comicId: string): Promise<Map<string, string>> {
  try {
    const { data, error } = await supabase
      .from('panel_embeddings')
      .select('panel_id, image_url, embedding')
      .eq('comic_id', comicId);

    if (error) {
      console.warn('[PanelEmbedding] Failed to get comic embeddings:', error);
      return new Map();
    }

    const embeddings = new Map<string, string>();
    if (data) {
      data.forEach(({ panel_id, image_url, embedding }) => {
        if (embedding) {
          embeddings.set(panel_id, embedding);
          // Cache in memory
          setCachedEmbedding(getCacheKey(panel_id, image_url), embedding);
        }
      });
    }

    console.log(`[PanelEmbedding] Loaded ${embeddings.size} embeddings for comic:`, comicId);
    return embeddings;
  } catch (error) {
    console.error('[PanelEmbedding] Error getting comic embeddings:', error);
    return new Map();
  }
}

/**
 * Delete embeddings for a panel (when panel is deleted)
 * @param panelId - Panel ID
 */
export async function deleteEmbedding(panelId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('panel_embeddings')
      .delete()
      .eq('panel_id', panelId);

    if (error) {
      console.warn('[PanelEmbedding] Failed to delete embedding:', error);
      throw error;
    }

    // Clear from cache
    for (const [key] of embeddingCache.entries()) {
      if (key.startsWith(`${panelId}:`)) {
        embeddingCache.delete(key);
      }
    }

    console.log('[PanelEmbedding] Deleted embedding for panel:', panelId);
  } catch (error) {
    console.error('[PanelEmbedding] Error deleting embedding:', error);
    throw error;
  }
}

/**
 * Clear memory cache (useful for testing or memory management)
 */
export function clearCache(): void {
  embeddingCache.clear();
  console.log('[PanelEmbedding] Cache cleared');
}

