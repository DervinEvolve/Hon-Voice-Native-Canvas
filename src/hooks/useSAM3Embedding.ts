/**
 * Hook for SAM3 embedding generation on panels
 * Automatically generates embeddings when panels are displayed/updated
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { generateEmbedding } from '../services/sam3EmbeddingService';
import { Panel } from '../types';
import { useComicStore } from '../store/useComicStore';

interface UseSAM3EmbeddingOptions {
  autoGenerate?: boolean; // Auto-generate when panel URL changes
  debounceMs?: number; // Debounce embedding generation
  saveToPanel?: boolean; // Save embedding to panel metadata
}

export function useSAM3Embedding(
  panel: Panel | null,
  options: UseSAM3EmbeddingOptions = {}
) {
  const { autoGenerate = true, debounceMs = 1000, saveToPanel = true } = options;
  const [embedding, setEmbedding] = useState<string | null>(panel?.embedding || null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updatePanel = useComicStore(state => state.updatePanel);
  const currentComic = useComicStore(state => state.currentComic);
  const currentPageIndex = useComicStore(state => state.currentPageIndex);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Manual embedding generation function
  const generate = useCallback(async () => {
    if (!panel || !panel.url || panel.type !== 'image') {
      return;
    }

    // Skip if embedding already exists
    if (panel.embedding) {
      setEmbedding(panel.embedding);
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const newEmbedding = await generateEmbedding(panel.url);
      
      if (newEmbedding) {
        setEmbedding(newEmbedding);
        
        // Save embedding to panel metadata
        if (saveToPanel && currentComic) {
          // Find which page this panel is on
          let panelPageIndex = currentPageIndex;
          for (let pi = 0; pi < currentComic.pages.length; pi++) {
            if (currentComic.pages[pi].some(p => p.id === panel.id)) {
              panelPageIndex = pi;
              break;
            }
          }
          
          // Update panel with embedding
          const updatedPanel: Panel = {
            ...panel,
            embedding: newEmbedding
          };
          await updatePanel(updatedPanel, panelPageIndex);
        }
        
        return newEmbedding;
      } else {
        throw new Error('Failed to generate embedding');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Embedding generation failed';
      setError(errorMessage);
      console.error('[SAM3] Embedding generation error:', err);
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, [panel, saveToPanel, updatePanel, currentComic, currentPageIndex]);

  // Auto-generate when panel changes
  useEffect(() => {
    if (!autoGenerate || !panel || !panel.url || panel.type !== 'image') {
      return;
    }

    // If embedding already exists, use it
    if (panel.embedding) {
      setEmbedding(panel.embedding);
      return;
    }

    // Clear previous debounce timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Debounce embedding generation (expensive operation)
    debounceTimeoutRef.current = setTimeout(() => {
      generate();
    }, debounceMs);

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [panel?.id, panel?.url, autoGenerate, debounceMs, generate]);

  // Update when panel's embedding changes externally
  useEffect(() => {
    if (panel?.embedding) {
      setEmbedding(panel.embedding);
    }
  }, [panel?.embedding]);

  return {
    embedding,
    isGenerating,
    error,
    generate, // Manual trigger
  };
}

