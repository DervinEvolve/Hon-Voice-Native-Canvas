import { useEffect, useRef } from 'react';
import { useComicStore } from '../store/useComicStore';
import { comicService } from '../services/comicService';

/**
 * Auto-save hook for current comic drafts
 * Debounced auto-save to Supabase to prevent data loss
 */
const AUTO_SAVE_DELAY_MS = 3000; // 3 seconds of inactivity

export function useAutoSave() {
  const currentComic = useComicStore(state => state.currentComic);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Only auto-save drafts (not published comics)
    if (!currentComic || !currentComic.id.startsWith('draft-')) {
      return;
    }

    // Clear previous timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set new timeout for debounced save
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await comicService.saveComic(currentComic);
        console.log('[AutoSave] Draft saved to Supabase:', currentComic.id);
      } catch (error) {
        console.warn('[AutoSave] Failed to save draft:', error);
      }
    }, AUTO_SAVE_DELAY_MS);

    // Cleanup on unmount or when comic changes
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [currentComic?.pages, currentComic?.lastModified, currentComic?.id]);
}

