import { useState, useEffect, useRef, useCallback } from 'react';
import { mediaService } from '../../utils/mediaService';

interface UseMediaLoaderProps {
  url: string;
  onLoad?: () => void;
  onError?: () => void;
}

export function useMediaLoader({ url, onLoad, onError }: UseMediaLoaderProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string>('');
  const mountedRef = useRef(true);
  const previousUrlRef = useRef(url);
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadMedia = useCallback(async () => {
    if (!url || !mountedRef.current) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    setIsLoading(true);
    setError(null);

    try {
      const newUrl = await mediaService.load(url);
      
      if (mountedRef.current) {
        if (previousUrlRef.current !== url) {
          mediaService.revoke(previousUrlRef.current);
        }
        previousUrlRef.current = url;
        setObjectUrl(newUrl);
        setIsLoading(false);
        onLoad?.();
      }
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof Error && err.name === 'AbortError') return;

      console.error('Failed to load media:', err);
      setError('Failed to load media');
      setIsLoading(false);
      onError?.();
    }
  }, [url, onLoad, onError]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      mediaService.revoke(previousUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (previousUrlRef.current !== url) {
      loadMedia();
    }
  }, [url, loadMedia]);

  const retry = useCallback(async () => {
    if (!url) return;
    await loadMedia();
  }, [url, loadMedia]);

  return { isLoading, error, objectUrl, retry };
}