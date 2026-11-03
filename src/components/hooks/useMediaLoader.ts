import { useState, useEffect, useRef, useCallback } from 'react';

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
  const retryCount = useRef(0);
  const previousUrlRef = useRef(url);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (objectUrl.startsWith('blob:')) {
        URL.revokeObjectURL(objectUrl);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [objectUrl]);

  const loadMedia = useCallback(async () => {
    if (!url || !mountedRef.current) return;

    // Cleanup previous fetch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (objectUrl.startsWith('blob:')) {
      URL.revokeObjectURL(objectUrl);
    }

    setIsLoading(true);
    setError(null);
    setObjectUrl('');

    try {
      // For Cloudinary URLs, use them directly
      if (url.includes('cloudinary.com')) {
        setObjectUrl(url);
        setIsLoading(false);
        onLoad?.();
        return;
      }

      // For blob URLs, use them directly
      if (url.startsWith('blob:')) {
        setObjectUrl(url);
        setIsLoading(false);
        onLoad?.();
        return;
      }

      abortControllerRef.current = new AbortController();

      const response = await fetch(url, {
        signal: abortControllerRef.current.signal,
        cache: 'force-cache',
        credentials: 'omit',
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      
      const blob = await response.blob();
      
      if (!mountedRef.current) return;

      const newObjectUrl = URL.createObjectURL(blob);
      setObjectUrl(newObjectUrl);
      setIsLoading(false);
      onLoad?.();

    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof Error && err.name === 'AbortError') return;
      
      console.error('Error loading media:', err);
      setError('Failed to load media');
      setIsLoading(false);
      onError?.();
    } finally {
      if (mountedRef.current) {
        abortControllerRef.current = null;
      }
    }
  }, [url, onLoad, onError]);

  useEffect(() => {
    if (previousUrlRef.current !== url) {
      previousUrlRef.current = url;
      loadMedia();
    }
  }, [url, loadMedia]);

  const retry = useCallback(() => {
    if (retryCount.current >= 3) {
      setError('Maximum retry attempts reached');
      return;
    }
    retryCount.current += 1;
    loadMedia();
  }, [loadMedia]);

  return {
    isLoading,
    error,
    objectUrl: objectUrl || url, // Fallback to original URL if no object URL
    retry,
  };
}