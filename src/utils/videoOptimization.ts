/**
 * Video optimization utilities for landing page performance
 */

export interface VideoOptimizationOptions {
  quality?: 'low' | 'good' | 'best' | 'auto';
  format?: 'auto' | 'mp4' | 'webm';
  bitrate?: string;
  isMobile?: boolean;
}

/**
 * Optimizes Cloudinary video URLs for better mobile performance
 */
export const optimizeVideoUrl = (
  videoUrl: string, 
  options: VideoOptimizationOptions = {}
): string => {
  if (!videoUrl.includes('cloudinary.com')) {
    return videoUrl;
  }

  const parts = videoUrl.split('/upload/');
  if (parts.length !== 2) {
    return videoUrl;
  }

  const {
    quality = 'auto',
    format = 'auto',
    bitrate,
    isMobile = window.innerWidth <= 768
  } = options;

  const transformations: string[] = [];

  // Maximum quality optimization for all devices
  if (quality === 'auto') {
    transformations.push('q_auto:best');
  } else if (quality === 'best' || quality === 'good') {
    transformations.push('q_auto:best'); // Force best quality for good/best requests
  } else {
    transformations.push(`q_auto:${quality}`);
  }

  // Format optimization
  transformations.push(`f_${format}`);

  // Maximum quality bitrate for all devices
  if (bitrate) {
    // If specific bitrate requested, use it but ensure minimum quality
    const bitrateNum = parseInt(bitrate.replace('k', ''));
    const minBitrate = Math.max(bitrateNum, 3000); // Minimum 3000k for high quality
    transformations.push(`br_${minBitrate}k`);
  } else {
    // Use maximum quality bitrate for all devices
    transformations.push('br_5000k'); // Highest quality maintained
  }

  // Add video streaming optimization for better playback
  transformations.push('vs_75'); // Increased buffer for even better quality

  return `${parts[0]}/upload/${transformations.join(',')}/${parts[1]}`;
};

/**
 * Generates poster image URL from video URL
 */
export const generatePosterUrl = (videoUrl: string): string | undefined => {
  if (!videoUrl.includes('cloudinary.com')) {
    return undefined;
  }

  const parts = videoUrl.split('/upload/');
  if (parts.length !== 2) {
    return undefined;
  }

  return `${parts[0]}/upload/f_jpg,q_auto:low,so_0/${parts[1]}`;
};

/**
 * Detects mobile device capabilities for video optimization
 */
export const getMobileVideoCapabilities = () => {
  const userAgent = navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(userAgent);
  const isAndroid = /android/.test(userAgent);
  const isLowEndDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2;
  
  return {
    isIOS,
    isAndroid,
    isMobile: isIOS || isAndroid,
    isLowEndDevice,
    supportsAutoplay: !isIOS, // iOS has stricter autoplay policies
    preferredBitrate: isLowEndDevice ? '1500k' : '2000k'
  };
};

/**
 * Video element optimization for mobile devices
 */
export const optimizeVideoElement = (video: HTMLVideoElement): void => {
  const capabilities = getMobileVideoCapabilities();
  
  // Optimize for mobile devices
  if (capabilities.isMobile) {
    video.preload = 'metadata';
    video.playsInline = true;
    video.muted = true;
    
    // iOS specific optimizations
    if (capabilities.isIOS) {
      // iOS requires user interaction for autoplay, but we can prepare the video
      video.load();
    }
    
    // Android specific optimizations
    if (capabilities.isAndroid) {
      // Android can be more aggressive with preloading
      video.preload = 'auto';
    }
  }
};

/**
 * Attempts to play video with fallback for mobile restrictions
 */
export const playVideoWithFallback = async (video: HTMLVideoElement): Promise<boolean> => {
  try {
    await video.play();
    return true;
  } catch (error) {
    console.warn('Video autoplay failed, likely due to browser policy:', error);
    
    // For mobile devices, we can try to play on user interaction
    const capabilities = getMobileVideoCapabilities();
    if (capabilities.isMobile) {
      // Add event listeners for user interaction
      const playOnInteraction = () => {
        video.play().catch(console.error);
        document.removeEventListener('touchstart', playOnInteraction);
        document.removeEventListener('click', playOnInteraction);
      };
      
      document.addEventListener('touchstart', playOnInteraction, { once: true });
      document.addEventListener('click', playOnInteraction, { once: true });
    }
    
    return false;
  }
};