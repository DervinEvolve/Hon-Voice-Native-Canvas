/**
 * SAM3 Image Embedding Service
 * Generates and manages semantic embeddings for visual similarity search
 * Now integrates with Supabase for persistence
 */

import { getEmbedding as getSupabaseEmbedding, saveEmbedding as saveSupabaseEmbedding } from './panelEmbeddingService';

// Cache to prevent duplicate embedding generation calls
const embeddingCache = new Map<string, { embedding: string; timestamp: number }>();
const EMBEDDING_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const pendingEmbeddings = new Set<string>(); // Track in-flight requests

/**
 * Generate or retrieve embedding for an image
 * Checks Supabase first, then generates if needed
 * @param imageUrl - URL of the image
 * @param panelId - Optional panel ID for Supabase lookup
 * @param comicId - Optional comic ID for Supabase save
 * @returns Base64-encoded embedding vector
 */
export async function generateEmbedding(
  imageUrl: string,
  panelId?: string,
  comicId?: string
): Promise<string | null> {
  if (!imageUrl) return null;

  // Check cache first
  const cached = embeddingCache.get(imageUrl);
  if (cached && Date.now() - cached.timestamp < EMBEDDING_CACHE_TTL) {
    return cached.embedding;
  }

  // If panelId provided, check Supabase first (production persistence)
  if (panelId) {
    try {
      const supabaseEmbedding = await getSupabaseEmbedding(panelId, imageUrl);
      if (supabaseEmbedding) {
        // Cache in memory
        embeddingCache.set(imageUrl, { embedding: supabaseEmbedding, timestamp: Date.now() });
        console.log('[SAM3] Retrieved embedding from Supabase for panel:', panelId);
        return supabaseEmbedding;
      }
    } catch (error) {
      console.warn('[SAM3] Failed to check Supabase for embedding:', error);
      // Continue to generate new embedding
    }
  }

  // Prevent duplicate concurrent requests
  if (pendingEmbeddings.has(imageUrl)) {
    // Wait for existing request to complete
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const cached = embeddingCache.get(imageUrl);
        if (cached) {
          clearInterval(checkInterval);
          pendingEmbeddings.delete(imageUrl);
          resolve(cached.embedding);
        } else if (!pendingEmbeddings.has(imageUrl)) {
          // Request failed or was cancelled
          clearInterval(checkInterval);
          resolve(null);
        }
      }, 100);
      
      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        pendingEmbeddings.delete(imageUrl);
        resolve(null);
      }, 30000);
    });
  }

  pendingEmbeddings.add(imageUrl);

  try {
    const response = await fetch('/api/fal/sam3-embed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ imageUrl }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn('[SAM3] Embedding generation failed:', response.status, errorText);
      pendingEmbeddings.delete(imageUrl);
      return null;
    }

    const data = await response.json();
    const embedding = data.success ? data.embedding_b64 : null;
    
    if (embedding) {
      // Cache the result in memory
      embeddingCache.set(imageUrl, { embedding, timestamp: Date.now() });
      
      // Save to Supabase if panelId and comicId provided (production persistence)
      if (panelId && comicId) {
        saveSupabaseEmbedding(panelId, comicId, imageUrl, embedding)
          .then(() => {
            console.log('[SAM3] Saved embedding to Supabase for panel:', panelId);
          })
          .catch(err => {
            console.warn('[SAM3] Failed to save embedding to Supabase:', err);
            // Don't fail the whole operation if Supabase save fails
          });
      }
    }
    
    pendingEmbeddings.delete(imageUrl);
    return embedding;
  } catch (error) {
    console.error('[SAM3] Embedding generation error:', error);
    pendingEmbeddings.delete(imageUrl);
    return null;
  }
}

/**
 * Calculate cosine similarity between two embeddings
 * @param embedding1 - Base64-encoded embedding
 * @param embedding2 - Base64-encoded embedding
 * @returns Similarity score (0-1, higher = more similar)
 */
export function calculateSimilarity(embedding1: string, embedding2: string): number {
  try {
    // Decode base64 embeddings to Float32Array
    const decodeEmbedding = (b64: string): Float32Array => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new Float32Array(bytes.buffer);
    };

    const vec1 = decodeEmbedding(embedding1);
    const vec2 = decodeEmbedding(embedding2);

    if (vec1.length !== vec2.length) {
      console.warn('[SAM3] Embedding dimension mismatch');
      return 0;
    }

    // Calculate cosine similarity
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
    if (magnitude === 0) return 0;

    return dotProduct / magnitude;
  } catch (error) {
    console.error('[SAM3] Similarity calculation error:', error);
    return 0;
  }
}

/**
 * Find similar panels based on embedding similarity
 * Fetches embeddings from Supabase if not provided in panels
 * @param targetEmbedding - Base64-encoded embedding of target panel
 * @param panels - Array of panels (embeddings will be fetched from Supabase if missing)
 * @param threshold - Minimum similarity threshold (0-1)
 * @param limit - Maximum number of results
 * @returns Array of similar panels with similarity scores
 */
export async function findSimilarPanels(
  targetEmbedding: string,
  panels: Array<{ id: string; embedding?: string; url?: string; pageIndex?: number }>,
  threshold: number = 0.7,
  limit: number = 10
): Promise<Array<{ panelId: string; similarity: number; url?: string; pageIndex?: number }>> {
  const results: Array<{ panelId: string; similarity: number; url?: string; pageIndex?: number }> = [];

  // Fetch embeddings from Supabase for panels that don't have them
  const panelsWithEmbeddings = await Promise.all(
    panels.map(async (panel) => {
      // If embedding already provided, use it
      if (panel.embedding) {
        return panel;
      }

      // Try to fetch from Supabase if URL available
      if (panel.url) {
        try {
          const supabaseEmbedding = await getSupabaseEmbedding(panel.id, panel.url);
          if (supabaseEmbedding) {
            return { ...panel, embedding: supabaseEmbedding };
          }
        } catch (error) {
          console.warn(`[SAM3] Failed to fetch embedding for panel ${panel.id}:`, error);
        }
      }

      return panel; // Return panel without embedding if fetch failed
    })
  );

  // Calculate similarities
  for (const panel of panelsWithEmbeddings) {
    if (!panel.embedding || panel.embedding === targetEmbedding) {
      continue; // Skip panels without embeddings or the target itself
    }

    const similarity = calculateSimilarity(targetEmbedding, panel.embedding);
    
    if (similarity >= threshold) {
      results.push({
        panelId: panel.id,
        similarity,
        url: panel.url,
        pageIndex: panel.pageIndex
      });
    }
  }

  // Sort by similarity (highest first)
  results.sort((a, b) => b.similarity - a.similarity);

  // Return top N results
  return results.slice(0, limit);
}

