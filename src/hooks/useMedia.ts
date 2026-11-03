import { useState, useEffect, useCallback, useRef } from 'react';
import { mediaStorage } from '../utils/mediaStorage';

interface UseMediaReturn {
  isLoading: boolean;
  error: string | null;
  objectUrl: string | null;
  retryLoad: () => void;
}

export function useMedia(url: string | null): UseMediaReturn {
  const [state, setState] = useState({
    isLoading: true,
    error: null as string | null,
    objectUrl: null as string | null,
  });
  
  const mountedRef = useRef(true);
  const previousUrlRef = useRef(url);
  const abortControllerRef = useRef<AbortController | null>(null);
  const retryCount = useRef(0);

  const cleanupResources = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (state.objectUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(state.objectUrl);
    }
  }, [state.objectUrl]);

  const loadMedia = useCallback(async () => {
    if (!url || !mountedRef.current) {
      setState({ isLoading: false, error: null, objectUrl: null });
      return;
    }

    if (previousUrlRef.current === url && state.objectUrl) {
      return;
    }

    cleanupResources();
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // For Cloudinary URLs, use them directly
      if (url.includes('cloudinary.com')) {
        setState({ isLoading: false, error: null, objectUrl: url });
        return;
      }

      // For blob URLs, use them directly
      if (url.startsWith('blob:')) {
        setState({ isLoading: false, error: null, objectUrl: url });
        return;
      }

      // Try to load from storage first
      const storedUrl = await mediaStorage.load(url);
      if (storedUrl && mountedRef.current) {
        previousUrlRef.current = url;
        setState({ isLoading: false, error: null, objectUrl: storedUrl });
        return;
      }

      // For new URLs, fetch and store
      const objectUrl = await mediaStorage.fetchAndStore(url);
      
      if (mountedRef.current) {
        previousUrlRef.current = url;
        setState({ isLoading: false, error: null, objectUrl });
      }
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof Error && err.name === 'AbortError') return;
      
      console.error('Failed to load media:', err);
      setState({ isLoading: false, error: 'Failed to load media', objectUrl: null });
    }
  }, [url, state.objectUrl, cleanupResources]);

  const retryLoad = useCallback(async () => {
    if (!url || retryCount.current >= 3) {
      setState(prev => ({ ...prev, error: 'Maximum retry attempts reached' }));
      return;
    }
    retryCount.current += 1;
    await loadMedia();
  }, [url, loadMedia]);

  useEffect(() => {
    if (previousUrlRef.current !== url) {
      loadMedia();
    }
  }, [url, loadMedia]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanupResources();
    };
  }, [cleanupResources]);

  return {
    ...state,
    retryLoad
  };
}