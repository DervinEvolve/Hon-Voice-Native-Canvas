import { Panel } from '../types';
import html2canvas from 'html2canvas';
import { saveAs } from 'file-saver';

// Define the proxy URL for handling CORS issues

// Export quality options
export interface ExportOptions {
  format: 'png' | 'jpeg' | 'webp';
  quality: number;  // 0-1 for jpeg/webp
  scale: 1 | 2 | 3;  // Output resolution multiplier
  includeBackground: boolean;
  backgroundColor: string;
  includeCaptions: boolean;
}

const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format: 'png',
  quality: 0.95,
  scale: 2,
  includeBackground: true,
  backgroundColor: '#ffffff',
  includeCaptions: true,
};

export const exportService = {
  /**
   * Exports a single panel as an image
   */
  async exportPanel(panel: Panel, quality: number = 0.95): Promise<string> {
    try {
      // For video panels, we need to capture a frame
      if (panel.type === 'video' && panel.videoUrl) {
        return await this.captureVideoFrame(panel.videoUrl, quality);
      }

      // For image panels, process the image
      if (panel.imageUrl) {
        return await this.processImage(panel.imageUrl, quality);
      }

      // Return a placeholder if no image or video URL
      return this.createPlaceholderImage();
    } catch (error) {
      console.error('Error exporting panel:', error);
      return this.createPlaceholderImage();
    }
  },

  /**
   * Checks if the container has any video panels
   */
  hasVideoPanel(container: HTMLElement): boolean {
    const videos = container.querySelectorAll('video');
    return videos.length > 0;
  },

  /**
   * Cleans the export container by removing UI elements and resetting transforms
   * This is the core fix for distortion and UI element issues
   */
  cleanExportContainer(documentClone: Document, containerId: string, options?: Partial<ExportOptions>): void {
    const container = documentClone.getElementById(containerId);
    if (!container) return;

    // 0. REMOVE CONTAINER PADDING/MARGIN/BORDER TO ELIMINATE WHITE BORDER
    container.style.padding = '0';
    container.style.margin = '0';
    container.style.borderRadius = '0';
    container.style.border = 'none';
    container.style.boxShadow = 'none';
    container.style.minHeight = 'auto';
    container.style.overflow = 'hidden';

    // Set background based on options (transparent if includeBackground is false)
    if (options?.includeBackground === false) {
      container.style.backgroundColor = 'transparent';
    } else {
      container.style.backgroundColor = options?.backgroundColor || '#ffffff';
    }

    // Remove gap from grid to eliminate spacing between panels
    const computedStyle = window.getComputedStyle(container);
    if (computedStyle.display === 'grid' || computedStyle.display === 'inline-grid') {
      container.style.gap = '0';
      container.style.gridGap = '0';
    }

    // Remove empty drop zones (panels with "Drop here" text)
    container.querySelectorAll('[class*="border-dashed"], [class*="drop-zone"]').forEach(el => {
      if (el instanceof HTMLElement) {
        const text = el.textContent?.toLowerCase() || '';
        if (text.includes('drop') || el.className.includes('border-dashed')) {
          el.style.display = 'none';
        }
      }
    });

    // Remove rounded corners from all panels
    container.querySelectorAll('[class*="rounded"]').forEach(el => {
      if (el instanceof HTMLElement) {
        el.style.borderRadius = '0';
      }
    });

    // 1. REMOVE ALL INTERACTIVE UI ELEMENTS
    const buttonsToRemove = container.querySelectorAll(
      'button, [role="button"], .btn, [class*="button"]'
    );
    buttonsToRemove.forEach(btn => btn.remove());

    // Remove panel control overlays
    const controlsToRemove = container.querySelectorAll(
      '[class*="opacity-0"], [class*="group-hover"], ' +
      '[class*="controls"], [class*="toolbar"], ' +
      '[class*="action-menu"], [class*="quick-action"]'
    );
    controlsToRemove.forEach(el => {
      if (el instanceof HTMLElement) {
        if (el.className.includes('opacity-0') ||
            el.className.includes('group-hover') ||
            el.className.includes('controls')) {
          el.remove();
        }
      }
    });

    // Remove collaboration indicators
    container.querySelectorAll('[class*="collaborat"], [class*="indicator"], [class*="presence"]')
      .forEach(el => el.remove());

    // Remove progress overlays
    container.querySelectorAll('[class*="progress"], [class*="generating"], [class*="loading"], [class*="spinner"], [class*="animate-spin"], [class*="animate-pulse"]')
      .forEach(el => el.remove());

    // Remove vision/mask overlays
    container.querySelectorAll('[class*="vision"], [class*="overlay"], [class*="mask"], [data-vision-overlay], [data-sam3-overlay], svg.absolute')
      .forEach(el => {
        if (el instanceof HTMLElement &&
            (el.classList.contains('pointer-events-none') || el.tagName === 'SVG' || el.className.includes('overlay'))) {
          el.remove();
        }
      });

    // Remove tooltips
    container.querySelectorAll('[class*="tooltip"], [role="tooltip"], [class*="popover"]')
      .forEach(el => el.remove());

    // 2. RESET IMAGE TRANSFORMS TO FIX DISTORTION
    const images = container.querySelectorAll('img');
    images.forEach(img => {
      const computedStyle = window.getComputedStyle(img);
      const originalObjectFit = computedStyle.objectFit;

      img.style.transform = 'none';
      img.style.transformOrigin = 'center';
      img.style.objectFit = originalObjectFit === 'cover' ? 'cover' : (originalObjectFit || 'cover');
      img.style.objectPosition = 'center';
      img.style.display = 'block';
      img.style.opacity = '1';
      img.style.visibility = 'visible';

      const parentPanel = img.closest('[class*="panel"], [data-panel-id]');
      if (parentPanel && parentPanel instanceof HTMLElement) {
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.maxWidth = '100%';
        img.style.maxHeight = '100%';
      }
    });

    // 3. HANDLE CAPTIONS
    container.querySelectorAll('.caption, .panel-caption, [class*="caption"]').forEach(caption => {
      if (caption instanceof HTMLElement) {
        caption.style.visibility = 'visible';
        caption.style.display = 'block';
        caption.style.opacity = '1';
        caption.style.zIndex = '10';
      }
    });

    // 4. FIX DARK MODE STYLING - use options background color
    const bgColor = options?.backgroundColor || '#ffffff';
    container.querySelectorAll('[class*="dark:"]').forEach(el => {
      if (el instanceof HTMLElement) {
        const computedStyle = window.getComputedStyle(el);
        if (computedStyle.backgroundColor.includes('rgb(17') ||
            computedStyle.backgroundColor.includes('rgb(31') ||
            computedStyle.backgroundColor.includes('rgb(55')) {
          el.style.backgroundColor = bgColor;
        }
      }
    });

    // 5. CLEAN UP BORDERS AND OUTLINES
    container.querySelectorAll('[class*="ring-"], [class*="outline-"], [class*="border-blue"]').forEach(el => {
      if (el instanceof HTMLElement) {
        el.style.boxShadow = 'none';
        el.style.outline = 'none';
      }
    });
  },

  /**
   * Replaces video elements with captured frames
   */
  async replaceVideosWithFrames(documentClone: Document, originalContainer: HTMLElement): Promise<void> {
    const originalVideos = originalContainer.querySelectorAll('video');
    const clonedVideos = documentClone.querySelectorAll('video');

    const replacementPromises = Array.from(originalVideos).map(async (originalVideo, index) => {
      const clonedVideo = clonedVideos[index];
      if (!clonedVideo || !clonedVideo.parentNode) return;

      try {
        const videoUrl = originalVideo.src || originalVideo.querySelector('source')?.src || '';
        const placeholder = document.createElement('img');
        placeholder.style.width = '100%';
        placeholder.style.height = '100%';
        placeholder.style.objectFit = 'cover';
        placeholder.style.objectPosition = 'center';

        if (videoUrl) {
          try {
            placeholder.src = await this.captureVideoFrame(videoUrl, 0.95);
          } catch {
            placeholder.src = originalVideo.poster || this.createVideoPlaceholder(originalVideo.videoWidth || 640, originalVideo.videoHeight || 360);
          }
        } else {
          placeholder.src = originalVideo.poster || this.createVideoPlaceholder(640, 360);
        }

        clonedVideo.parentNode.replaceChild(placeholder, clonedVideo);
      } catch {
        if (clonedVideo instanceof HTMLElement) clonedVideo.style.display = 'none';
      }
    });

    await Promise.all(replacementPromises);
  },

  /**
   * Creates a styled placeholder for video panels
   */
  createVideoPlaceholder(width: number = 640, height: number = 360): string {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (ctx) {
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, '#374151');
        gradient.addColorStop(1, '#1f2937');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.beginPath();
        const centerX = width / 2, centerY = height / 2;
        const size = Math.min(width, height) * 0.15;
        ctx.moveTo(centerX - size / 2, centerY - size);
        ctx.lineTo(centerX - size / 2, centerY + size);
        ctx.lineTo(centerX + size, centerY);
        ctx.closePath();
        ctx.fill();

        ctx.font = `bold ${Math.max(14, width * 0.03)}px Arial`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Video', centerX, centerY + size * 2);

        return canvas.toDataURL('image/png');
      }
    } catch {}
    return this.createPlaceholderImage(width, height);
  },

  /**
   * Exports a page - IMPROVED VERSION
   */
  async exportPage(
    containerId: string,
    fileName: string = 'comic-page',
    options: Partial<ExportOptions> = {}
  ): Promise<string | void> {
    const exportOptions = { ...DEFAULT_EXPORT_OPTIONS, ...options };

    try {
      const container = document.getElementById(containerId);
      if (!container) throw new Error('Container not found');

      await this.preloadImages(container);
      const hasVideos = this.hasVideoPanel(container);

      const canvas = await html2canvas(container, {
        scale: exportOptions.scale,
        useCORS: true,
        allowTaint: false,
        backgroundColor: exportOptions.includeBackground ? exportOptions.backgroundColor : null,
        imageTimeout: 30000,
        logging: false,
        removeContainer: true,
        onclone: async (documentClone) => {
          this.cleanExportContainer(documentClone, containerId, exportOptions);
          if (hasVideos) await this.replaceVideosWithFrames(documentClone, container);
        }
      });

      const mimeType = exportOptions.format === 'jpeg' ? 'image/jpeg' : exportOptions.format === 'webp' ? 'image/webp' : 'image/png';

      return new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob) {
              saveAs(blob, `${this.sanitizeFileName(fileName)}.${exportOptions.format}`);
              resolve();
            } else reject(new Error('Failed to create image blob'));
          },
          mimeType,
          exportOptions.quality
        );
      });
    } catch (error) {
      console.error('Error exporting page:', error);
      throw error;
    }
  },

  /**
   * Exports page as data URL
   */
  async exportPageAsDataUrl(containerId: string, options: Partial<ExportOptions> = {}): Promise<string> {
    const exportOptions = { ...DEFAULT_EXPORT_OPTIONS, ...options };

    const container = document.getElementById(containerId);
    if (!container) throw new Error('Container not found');

    await this.preloadImages(container);
    const hasVideos = this.hasVideoPanel(container);

    const canvas = await html2canvas(container, {
      scale: exportOptions.scale,
      useCORS: true,
      allowTaint: false,
      backgroundColor: exportOptions.includeBackground ? exportOptions.backgroundColor : null,
      imageTimeout: 30000,
      logging: false,
      removeContainer: true,
      onclone: async (documentClone) => {
        this.cleanExportContainer(documentClone, containerId, exportOptions);
        if (hasVideos) await this.replaceVideosWithFrames(documentClone, container);
      }
    });

    const mimeType = exportOptions.format === 'jpeg' ? 'image/jpeg' : exportOptions.format === 'webp' ? 'image/webp' : 'image/png';
    return canvas.toDataURL(mimeType, exportOptions.quality);
  },

  sanitizeFileName(fileName: string): string {
    return fileName.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase().substring(0, 200);
  },

  async preloadImages(container: HTMLElement): Promise<void> {
    const images = container.querySelectorAll('img');
    const imagePromises = Array.from(images).map(async (img) => {
      if (img.src.startsWith('data:') || (img.complete && img.naturalWidth > 0)) return;

      return new Promise<void>((resolve) => {
        const originalSrc = img.src;
        const onLoad = () => { img.removeEventListener('load', onLoad); img.removeEventListener('error', onError); resolve(); };
        // No image proxy is included: an image that cannot be read is left as is
        // and exported as the labelled "Image unavailable" placeholder.
        const onError = () => {
          img.removeEventListener('load', onLoad);
          img.removeEventListener('error', onError);
          resolve();
        };
        img.addEventListener('load', onLoad);
        img.addEventListener('error', onError);
        if (!img.complete) img.src = originalSrc;
      });
    });

    await Promise.race([Promise.all(imagePromises), new Promise(resolve => setTimeout(resolve, 15000))]);
  },

  async imageToDataURL(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timeoutId = setTimeout(() => reject(new Error('Image loading timed out')), 10000);

      img.onload = () => {
        clearTimeout(timeoutId);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d');
          if (ctx) { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL('image/png')); }
          else reject(new Error('Failed to get canvas context'));
        } catch (err) { reject(err); }
      };

      img.onerror = () => { clearTimeout(timeoutId); reject(new Error('Failed to load image')); };
      img.src = url;
    });
  },

  async processImage(imageUrl: string, quality: number = 0.95): Promise<string> {
    if (imageUrl.startsWith('data:')) return imageUrl;
    try {
      return await this.imageToDataURL(imageUrl);
    } catch {
      console.warn('[export] Image could not be read (no image proxy in this build); using the "Image unavailable" placeholder:', imageUrl);
      return this.createPlaceholderImage();
    }
  },

  async captureVideoFrame(videoUrl: string, quality: number = 0.95): Promise<string> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.playsInline = true;

      video.onloadeddata = () => { video.currentTime = Math.min(1, video.duration / 2); };
      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 360;
          const ctx = canvas.getContext('2d');
          if (ctx) { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL('image/png', quality)); }
          else reject(new Error('Failed to get canvas context'));
        } catch (error) { reject(error); }
        finally { video.pause(); video.src = ''; video.load(); }
      };
      video.onerror = () => reject(new Error('Failed to load video'));
      video.src = videoUrl;
      video.load();
      setTimeout(() => { if (!video.duration) reject(new Error('Video loading timed out')); }, 10000);
    }).catch(() => this.createVideoPlaceholder()) as Promise<string>;
  },

  createPlaceholderImage(width: number = 640, height: number = 360): string {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (ctx) {
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, '#f3f4f6');
        gradient.addColorStop(1, '#e5e7eb');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = '#d1d5db';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, width - 2, height - 2);

        ctx.font = `bold ${Math.max(16, width * 0.04)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.fillStyle = '#9ca3af';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Image unavailable', width / 2, height / 2);

        return canvas.toDataURL('image/png');
      }
    } catch {}
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  },

  async shareToSocial(dataUrl: string, platform: 'x' | 'facebook' | 'instagram' | 'pinterest' | 'linkedin' | 'reddit', title: string = 'My Comic'): Promise<void> {
    const encodedTitle = encodeURIComponent(title);
    const encodedUrl = encodeURIComponent(window.location.href);
    let shareUrl = '';

    switch (platform) {
      case 'x': shareUrl = `https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encodedUrl}`; break;
      case 'facebook': shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedTitle}`; break;
      case 'instagram': alert('To share on Instagram:\n1. Open Instagram\n2. Create a new post\n3. Select the downloaded image\n4. Add the caption and share'); return;
      case 'pinterest': shareUrl = `https://pinterest.com/pin/create/button/?url=${encodedUrl}&media=${encodedUrl}&description=${encodedTitle}`; break;
      case 'linkedin': shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`; break;
      case 'reddit': shareUrl = `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedTitle}`; break;
    }

    if (shareUrl) window.open(shareUrl, '_blank', 'width=600,height=400');
  }
};
