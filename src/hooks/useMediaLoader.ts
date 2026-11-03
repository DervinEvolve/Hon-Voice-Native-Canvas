import { useState, useEffect, useCallback } from 'react';

interface UseMediaLoaderProps {
  url: string;
  onLoad?: () => void;
  onError?: () => void;
}

export function useMediaLoader({ url, onLoad, onError }: UseMediaLoaderProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string>('');

  // Optimize Cloudinary URLs
  const optimizeCloudinaryUrl = useCallback((sourceUrl: string): string => {
    if (!sourceUrl.includes('cloudinary.com')) return sourceUrl;
    
    try {
      const isVideo = sourceUrl.includes('/video/upload/');
      
      // If it's a video, use lower quality and progressive loading for initial load
      if (isVideo) {
        // Insert quality and format parameters for videos
        // q_auto:low reduces quality for faster loading
        // f_auto selects the best format based on browser support
        // vs_25 reduces the video size 
        // dl_300 limits initial download to 300kb for streaming
        if (!sourceUrl.includes('q_auto')) {
          // Insert between upload/ and file id
          const parts = sourceUrl.split('/upload/');
          if (parts.length === 2) {
            return `${parts[0]}/upload/q_auto:low,f_auto,vs_25,dl_300/${parts[1]}`;
          }
        }
      }
      
      // For images, use auto quality and format
      if (!isVideo && !sourceUrl.includes('q_auto')) {
        const parts = sourceUrl.split('/upload/');
        if (parts.length === 2) {
          return `${parts[0]}/upload/q_auto,f_auto/${parts[1]}`;
        }
      }
    } catch (err) {
      console.warn('Failed to optimize Cloudinary URL:', err);
    }
    
    return sourceUrl;
  }, []);

  const loadMedia = useCallback(async () => {
    if (!url) {
      setIsLoading(false);
      setError('No URL provided');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // For Cloudinary URLs, optimize and use them directly
      if (url.includes('cloudinary.com')) {
        const optimizedUrl = optimizeCloudinaryUrl(url);
        setObjectUrl(optimizedUrl);
        setIsLoading(false);
        onLoad?.();
        return;
      }
      
      // For direct URLs or data URLs, use them directly
      if (url.startsWith('http') || url.startsWith('data:')) {
        setObjectUrl(url);
        setIsLoading(false);
        onLoad?.();
        return;
      }

      // For blob URLs, validate them first
      if (url.startsWith('blob:')) {
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error('Invalid blob URL');
          
          setObjectUrl(url);
          setIsLoading(false);
          onLoad?.();
          return;
        } catch (err) {
          console.warn('Invalid blob URL, attempting to fetch as regular URL:', err);
          throw err; // Let it be caught by the outer try-catch
        }
      }

      // For all other URLs, try to fetch them
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to load media: ${response.statusText}`);
      
      const blob = await response.blob();
      const newObjectUrl = URL.createObjectURL(blob);
      
      setObjectUrl(newObjectUrl);
      setIsLoading(false);
      onLoad?.();
      
    } catch (err) {
      console.error('Error loading media:', err);
      setError(err instanceof Error ? err.message : 'Failed to load media');
      setIsLoading(false);
      onError?.();
    }
  }, [url, onLoad, onError, optimizeCloudinaryUrl]);

  useEffect(() => {
    // Skip if URL is empty or unchanged and objectUrl is already set
    if (!url || (objectUrl && url === objectUrl)) {
      setIsLoading(false);
      return;
    }
    
    loadMedia();
    
    // Cleanup function
    return () => {
      // Only revoke if it's a blob URL we created (not one passed in)
      if (objectUrl && objectUrl !== url && objectUrl.startsWith('blob:')) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [url, loadMedia, objectUrl]);

  const retry = useCallback(() => {
    loadMedia();
  }, [loadMedia]);

  return {
    isLoading,
    error,
    objectUrl: objectUrl || url,
    retry,
  };
} 