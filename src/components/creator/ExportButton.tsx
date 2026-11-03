import { beginOAuthPopup } from '../../services/apiAccess';
import { isOAuthPopupMessage } from '../../utils/apiRequest';
import React, { useState, useRef, useEffect } from 'react';
import { Share2, Settings, ChevronRight, Check } from 'lucide-react';
import { exportService, ExportOptions } from '../../services/exportService';
import { useComicStore } from '../../store/useComicStore';
import { toast } from 'react-toastify';
import html2canvas from 'html2canvas';
import { saveAs } from 'file-saver';

// Custom icons for better branding
const ImageDownloadIcon = ({ className }: { className?: string }) => (
  <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <polyline points="21 15 16 10 5 21"/>
    <path d="M12 17v4m-2-2l2 2 2-2" strokeWidth="2.5"/>
  </svg>
);

const ZipIcon = ({ className }: { className?: string }) => (
  <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    <path d="M12 11v6"/>
    <path d="M9 14h6"/>
  </svg>
);

// Plain text badges stand in for provider and social network logos, which are
// trademarks and are not bundled.
const TextBadge = ({ label, title, className }: { label: string; title: string; className?: string }) => (
  <span
    className={`inline-flex items-center justify-center rounded-sm border border-current text-[9px] font-bold leading-none ${className || ''}`}
    style={{ minWidth: 16, height: 16 }}
    aria-label={title}
    title={title}
  >
    {label}
  </span>
);

const GoogleDriveIcon = ({ className }: { className?: string }) => (
  <TextBadge label="GD" title="Google Drive" className={className} />
);

// Social networks
const XIcon = ({ className }: { className?: string }) => (
  <TextBadge label="X" title="X" className={className} />
);

const FacebookIcon = ({ className }: { className?: string }) => (
  <TextBadge label="f" title="Facebook" className={className} />
);

const InstagramIcon = ({ className }: { className?: string }) => (
  <TextBadge label="IG" title="Instagram" className={className} />
);

// Video info dialog component (non-blocking, informational) - always dark mode
const VideoInfoDialog: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}> = ({ isOpen, onClose, onConfirm }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <div className="rounded-xl p-6 max-w-md mx-auto shadow-2xl" style={{ backgroundColor: '#111827', border: '1px solid rgba(75, 85, 99, 0.5)' }}>
        <h3 className="text-lg font-bold mb-2" style={{ color: '#fff' }}>
          Video Panels Detected
        </h3>
        <p className="mb-4" style={{ color: '#9ca3af' }}>
          Your comic contains video panels. The export will capture the current video frame as a static image.
        </p>
        <div className="flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-lg transition-colors hover:opacity-80"
            style={{ backgroundColor: '#1f2937', color: '#d1d5db' }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium rounded-lg transition-colors hover:opacity-90"
            style={{ backgroundColor: '#2563eb', color: '#fff' }}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
};

// Export quality presets
const QUALITY_PRESETS = {
  draft: { label: 'Draft', scale: 1 as const, quality: 0.7, description: 'Fast, smaller file' },
  standard: { label: 'Standard', scale: 2 as const, quality: 0.9, description: 'Good quality' },
  high: { label: 'High Quality', scale: 3 as const, quality: 0.95, description: 'Best quality, larger file' },
};

// Export settings menu component
const ExportSettingsMenu: React.FC<{
  settings: Partial<ExportOptions>;
  onSettingsChange: (settings: Partial<ExportOptions>) => void;
  isOpen: boolean;
  onClose: () => void;
}> = ({ settings, onSettingsChange, isOpen, onClose }) => {
  if (!isOpen) return null;

  const currentPreset = Object.entries(QUALITY_PRESETS).find(
    ([, preset]) => preset.scale === settings.scale && preset.quality === settings.quality
  )?.[0] || 'custom';

  const handlePresetChange = (presetKey: string) => {
    const preset = QUALITY_PRESETS[presetKey as keyof typeof QUALITY_PRESETS];
    if (preset) {
      onSettingsChange({
        ...settings,
        scale: preset.scale,
        quality: preset.quality,
      });
    }
  };

  return (
    <div className="absolute bottom-full mb-2 right-0 bg-gray-800/95 backdrop-blur-sm rounded-lg shadow-xl p-4 min-w-64 z-50 border border-gray-700/60">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-white">Export Settings</h4>
        <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded">
          <X className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      {/* Quality Preset */}
      <div className="mb-4">
        <label className="block text-xs text-gray-400 mb-2">Quality Preset</label>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(QUALITY_PRESETS).map(([key, preset]) => (
            <button
              key={key}
              onClick={() => handlePresetChange(key)}
              className={`px-3 py-2 rounded text-xs transition-colors ${
                currentPreset === key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-gray-500 mt-1">
          {QUALITY_PRESETS[currentPreset as keyof typeof QUALITY_PRESETS]?.description || 'Custom settings'}
        </p>
      </div>

      {/* Format Selection */}
      <div className="mb-4">
        <label className="block text-xs text-gray-400 mb-2">Format</label>
        <div className="flex gap-2">
          {(['png', 'jpeg', 'webp'] as const).map((fmt) => (
            <button
              key={fmt}
              onClick={() => onSettingsChange({ ...settings, format: fmt })}
              className={`px-3 py-1.5 rounded text-xs uppercase transition-colors ${
                settings.format === fmt
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {fmt}
            </button>
          ))}
        </div>
      </div>

      {/* Background Options */}
      <div className="mb-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.includeBackground !== false}
            onChange={(e) => onSettingsChange({ ...settings, includeBackground: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-xs text-gray-300">Include background</span>
        </label>
        {settings.includeBackground !== false && (
          <div className="flex items-center gap-2 mt-2 ml-5">
            <input
              type="color"
              value={settings.backgroundColor || '#ffffff'}
              onChange={(e) => onSettingsChange({ ...settings, backgroundColor: e.target.value })}
              className="w-6 h-6 rounded cursor-pointer border-0"
            />
            <span className="text-xs text-gray-400">Background color</span>
          </div>
        )}
      </div>

      {/* Caption Options */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.includeCaptions !== false}
            onChange={(e) => onSettingsChange({ ...settings, includeCaptions: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-xs text-gray-300">Include captions</span>
        </label>
      </div>
    </div>
  );
};

interface ExportButtonProps {
  containerId: string;
}

export const ExportButton: React.FC<ExportButtonProps> = ({ containerId }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [driveMode, setDriveMode] = useState<'files'|'zip'|'both'>(() => {
    const saved = localStorage.getItem('hon-drive-mode');
    return (saved === 'zip' || saved === 'both' || saved === 'files') ? (saved as any) : 'files';
  });
  const [rememberChoice, setRememberChoice] = useState<boolean>(() => localStorage.getItem('hon-drive-remember') === '1');
  const [showVideoInfo, setShowVideoInfo] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [exportSettings, setExportSettings] = useState<Partial<ExportOptions>>({
    format: 'png',
    scale: 2,
    quality: 0.9,
    backgroundColor: '#ffffff',
    includeBackground: true,
    includeCaptions: true,
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const { currentComic } = useComicStore();
  
  // Store the export parameters when video warning is shown
  const exportParamsRef = useRef<{
    fileName: string;
    action: 'export' | 'share';
    platform?: 'x' | 'facebook' | 'instagram';
  } | null>(null);

  const checkForVideos = (): boolean => {
    const container = document.getElementById(containerId);
    if (!container) return false;
    
    const videos = container.querySelectorAll('video');
    return videos.length > 0;
  };

  const startGoogleOAuth = () => new Promise<void>((resolve, reject) => {
    const w = 520, h = 640;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const popup = window.open('about:blank', 'gd-oauth', `width=${w},height=${h},left=${left},top=${top}`);
    if (!popup) return reject(new Error('Popup blocked'));
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearInterval(checkClose); clearTimeout(expiry);
      window.removeEventListener('message', onMsg);
      if (error) reject(error); else resolve();
    };
    const onMsg = (e: MessageEvent) => {
      if (!isOAuthPopupMessage(e, popup, window.location.origin)) return;
      if (e.data?.kind === 'google-connected') finish();
      if (e.data?.kind === 'google-error') finish(new Error('Google authorization failed'));
    };
    window.addEventListener('message', onMsg);
    const checkClose = setInterval(() => { if (popup.closed) finish(new Error('Google connection closed')); }, 500);
    const expiry = setTimeout(() => { popup.close(); finish(new Error('Google connection expired')); }, 600000);
    void beginOAuthPopup(popup, '/api/google/auth').catch(error => finish(error));
  });

  const handleSaveToDrive = async () => {
    try {
      setIsExporting(true);
      toast.info('Connecting to Google Drive…', { autoClose: false, toastId: 'gd-progress' });
      const session = await fetch('/api/google/session');
      if (!session.ok) await startGoogleOAuth();
      toast.update('gd-progress', { render: 'Uploading to Google Drive…', autoClose: false });

      // Collect assets (images/videos/3D models)
      const assets: Array<{ url: string; name?: string }> = [];
      const { currentComic } = useComicStore.getState();
      const pages = currentComic?.pages || [];
      pages.forEach((page, pi) => {
        page.forEach((p, idx) => {
          if (!p) return;
          const baseName = `page-${pi + 1}_panel-${idx + 1}`;
          if (typeof p.url === 'string' && p.url.startsWith('http')) {
            assets.push({ url: p.url, name: baseName });
          }
          // Include 3D model variants if present in metadata (added by text_to_3d tool)
          const meta: any = (p as any).metadata;
          const modelUrls = meta?.model_urls || {};
          const texUrls = Array.isArray(meta?.texture_urls) ? meta.texture_urls : [];
          ['glb','fbx','obj','usdz'].forEach(fmt => {
            const f = modelUrls?.[fmt]?.url;
            if (typeof f === 'string' && f.startsWith('http')) {
              assets.push({ url: f, name: `${baseName}/model.${fmt}` });
            }
          });
          texUrls.forEach((t: any, ti: number) => {
            const base = t?.base_color?.url; if (typeof base === 'string') assets.push({ url: base, name: `${baseName}/textures/texture_${ti}_base_color.png` });
            const m = t?.metallic?.url; if (typeof m === 'string') assets.push({ url: m, name: `${baseName}/textures/texture_${ti}_metallic.png` });
            const n = t?.normal?.url; if (typeof n === 'string') assets.push({ url: n, name: `${baseName}/textures/texture_${ti}_normal.png` });
            const r = t?.roughness?.url; if (typeof r === 'string') assets.push({ url: r, name: `${baseName}/textures/texture_${ti}_roughness.png` });
          });
        });
      });

      const yyyyMmDd = new Date().toISOString().slice(0,10);
      const defaultFolder = `Hon Assets ${yyyyMmDd}`;
      const folderName = currentComic?.title && currentComic.title.trim()
        ? `${currentComic.title.trim()} Assets ${yyyyMmDd}`
        : defaultFolder;

      const resp = await fetch('/api/google/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy: driveMode, items: assets, folderName, zipName: (currentComic?.title || 'hon-export') })
      });
      const js = await resp.json();
      toast.dismiss('gd-progress');
      if (!resp.ok) throw new Error(js?.error || 'Upload failed');
      toast.success('Saved to Google Drive.');
      if (js?.folderLink) window.open(js.folderLink, '_blank');
      if (rememberChoice) {
        try { localStorage.setItem('hon-drive-mode', driveMode); localStorage.setItem('hon-drive-remember', '1'); } catch {}
      }
      setIsMenuOpen(false);
    } catch (e:any) {
      toast.dismiss('gd-progress');
      toast.error(e?.message || 'Google Drive upload failed');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExport = async () => {
    try {
      // Check for video panels first - show info dialog but don't block
      if (checkForVideos()) {
        // Store export parameters and show info dialog
        exportParamsRef.current = {
          fileName: currentComic?.title
            ? `${currentComic.title.replace(/\s+/g, '-').toLowerCase()}`
            : 'hon-comic-page',
          action: 'export'
        };
        setShowVideoInfo(true);
        return;
      }

      // Proceed with export
      await performExport();
    } catch (error) {
      handleExportError(error);
    }
  };

  const performExport = async () => {
    try {
      setIsExporting(true);

      // Show a toast with longer duration
      toast.info('Preparing your comic for download... This may take a moment.', {
        autoClose: 15000, // Longer timeout for image processing
        toastId: 'export-progress'
      });

      const fileName = exportParamsRef.current?.fileName ||
        (currentComic?.title
          ? `${currentComic.title.replace(/\s+/g, '-').toLowerCase()}`
          : 'hon-comic-page');

      // Ensure all images are loaded before export
      const container = document.getElementById(containerId);
      if (container) {
        // Pre-process the container to ensure all images are loaded
        await preloadContainerImages(container);
      }

      // Build complete export options
      const options: ExportOptions = {
        format: exportSettings.format || 'png',
        quality: exportSettings.quality || 0.9,
        scale: (exportSettings.scale || 2) as 1 | 2 | 3,
        includeBackground: exportSettings.includeBackground !== false,
        backgroundColor: exportSettings.backgroundColor || '#ffffff',
        includeCaptions: exportSettings.includeCaptions !== false,
      };

      // Export the comic page with options
      await exportService.exportPage(containerId, fileName, options);

      // Close the progress toast and show success
      toast.dismiss('export-progress');
      toast.success('Comic page downloaded successfully!');
    } catch (error) {
      handleExportError(error);
    } finally {
      setIsExporting(false);
      setIsMenuOpen(false);
      exportParamsRef.current = null;
    }
  };

  // Helper function to preload all images in the container
  const preloadContainerImages = async (container: HTMLElement): Promise<void> => {
    const images = container.querySelectorAll('img');
    
    // Create an array of promises for each image
    const imagePromises = Array.from(images).map(img => {
      // Skip if already loaded
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      
      // Create a promise that resolves when the image loads
      return new Promise<void>((resolve) => {
        const onLoad = () => {
          img.removeEventListener('load', onLoad);
          img.removeEventListener('error', onError);
          resolve();
        };
        
        const onError = () => {
          img.removeEventListener('load', onLoad);
          img.removeEventListener('error', onError);
          console.warn('Failed to load image:', img.src);
          resolve(); // Resolve anyway to continue
        };
        
        img.addEventListener('load', onLoad);
        img.addEventListener('error', onError);
        
        // Force reload if needed
        if (!img.complete) {
          const currentSrc = img.src;
          img.src = currentSrc;
        }
      });
    });
    
    // Wait for all images to load
    await Promise.all(imagePromises);
  };

  const handleExportError = (error: any) => {
    console.error('Export error:', error);
    
    // Close the progress toast
    toast.dismiss('export-progress');
    
    // Provide more specific error messages based on the error type
    if (error instanceof Error) {
      if (error.message === 'video_panels_detected') {
        // This should be handled by the warning dialog, not here
        return;
      } else if (error.message.includes('Tainted canvases')) {
        toast.error('Unable to export due to image restrictions. Try refreshing the page and exporting again.');
      } else if (error.message.includes('timeout')) {
        toast.error('Export timed out. Some images may be taking too long to load.');
      } else {
        toast.error(`Export failed: ${error.message}`);
      }
    } else {
      toast.error('Failed to export comic page. Please try again.');
    }
  };

  const handleShare = async (platform: 'x' | 'facebook' | 'instagram') => {
    try {
      // Check for video panels first for Instagram (which requires image export)
      if (platform === 'instagram' && checkForVideos()) {
        // Store share parameters and show info dialog
        exportParamsRef.current = {
          fileName: currentComic?.title
            ? `${currentComic.title.replace(/\s+/g, '-').toLowerCase()}`
            : 'hon-comic-page',
          action: 'share',
          platform
        };
        setShowVideoInfo(true);
        return;
      }

      // Proceed with share
      await performShare(platform);
    } catch (error) {
      handleShareError(error, platform);
    }
  };

  const performShare = async (platform: 'x' | 'facebook' | 'instagram') => {
    try {
      setIsExporting(true);
      const platformName = platform === 'x' ? 'X' : platform.charAt(0).toUpperCase() + platform.slice(1);
      
      toast.info(`Preparing to share to ${platformName}...`, {
        autoClose: false,
        toastId: 'share-progress'
      });
      
      // For Instagram, we need to export the image first
      if (platform === 'instagram') {
        // Get the container
        const container = document.getElementById(containerId);
        if (!container) {
          throw new Error('Container not found');
        }
        
        // Preload all images in the container
        await preloadContainerImages(container);
        
        // Get the comic title or use a default
        const title = currentComic?.title || 'My Hon Comic';
        
        // Capture the comic page directly
        const canvas = await html2canvas(container, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          imageTimeout: 30000, // Longer timeout for images
          onclone: (documentClone) => {
            // Hide videos in the cloned document
            const videos = documentClone.querySelectorAll('video');
            videos.forEach(video => {
              video.style.display = 'none';
            });
            
            // Make captions visible
            const captions = documentClone.querySelectorAll('.caption, .panel-caption');
            captions.forEach(caption => {
              if (caption instanceof HTMLElement) {
                caption.style.visibility = 'visible';
                caption.style.display = 'block';
                caption.style.zIndex = '10';
              }
            });
            
            // Make sure all images maintain aspect ratio
            const images = documentClone.querySelectorAll('img');
            images.forEach(img => {
              img.style.display = 'block';
              img.style.opacity = '1';
              img.style.objectFit = 'contain';
              
              // Make sure the image fills its container appropriately
              const parentPanel = img.closest('.panel');
              if (parentPanel) {
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.position = 'absolute';
                img.style.top = '0';
                img.style.left = '0';
              }
            });
          }
        });
        
        // Convert to data URL and download
        const dataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `${title.replace(/\s+/g, '-').toLowerCase()}.png`;
        link.click();
        
        // Close the progress toast and show success
        toast.dismiss('share-progress');
        toast.success('Image downloaded for Instagram sharing!');
        setTimeout(() => {
          alert('To share on Instagram:\n1. Open Instagram\n2. Create a new post\n3. Select the downloaded image\n4. Add the caption and share');
        }, 500);
      } else {
        // Get the comic title or use a default
        const title = currentComic?.title || 'My Hon Comic';
        
        // For other platforms, just share the URL with the title
        await exportService.shareToSocial('', platform, title);
        
        // Close the progress toast and show success
        toast.dismiss('share-progress');
        toast.success(`Shared to ${platformName}!`);
      }
    } catch (error) {
      handleShareError(error, platform);
    } finally {
      setIsExporting(false);
      setIsMenuOpen(false);
      exportParamsRef.current = null;
    }
  };

  const handleShareError = (error: any, platform: 'x' | 'facebook' | 'instagram') => {
    console.error('Share error:', error);
    
    // Close the progress toast
    toast.dismiss('share-progress');
    
    const platformName = platform === 'x' ? 'X' : platform.charAt(0).toUpperCase() + platform.slice(1);
    
    if (error instanceof Error) {
      toast.error(`Failed to share to ${platformName}: ${error.message}`);
    } else {
      toast.error(`Failed to share to ${platformName}. Please try again.`);
    }
  };

  const handleVideoInfoConfirm = () => {
    setShowVideoInfo(false);

    if (!exportParamsRef.current) return;

    if (exportParamsRef.current.action === 'export') {
      performExport();
    } else if (exportParamsRef.current.action === 'share' && exportParamsRef.current.platform) {
      performShare(exportParamsRef.current.platform);
    }
  };

  const handleVideoInfoClose = () => {
    setShowVideoInfo(false);
    exportParamsRef.current = null;
    setIsExporting(false);
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="p-1.5 rounded-full hover:bg-gray-700 transition-colors"
          title="Export or share"
          disabled={isExporting}
        >
          {isExporting ? (
            <div className="w-4 h-4 animate-spin rounded-full border-2 border-gray-300 border-t-indigo-600" />
          ) : (
            <Share2 className="w-4 h-4 text-gray-300" />
          )}
        </button>

        {isMenuOpen && (
          <div
            className="absolute bottom-full mb-3 right-0 rounded-xl shadow-2xl min-w-64 z-50 overflow-hidden"
            style={{ backgroundColor: 'rgba(31, 41, 55, 0.95)', color: '#e5e7eb', border: '1px solid rgba(75, 85, 99, 0.6)' }}
          >
            {/* Download Section */}
            <div className="p-1.5">
              {/* Download Image with Settings */}
              <div className="flex items-center group">
                <button
                  onClick={handleExport}
                  className="flex-1 flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/10 transition-all duration-150"
                  disabled={isExporting}
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(75, 85, 99, 0.5)' }}>
                    <ImageDownloadIcon className="text-gray-300" />
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-medium text-white">Download Image</div>
                    <div className="text-[10px]" style={{ color: '#9ca3af' }}>PNG, JPEG, WebP</div>
                  </div>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSettingsMenu(!showSettingsMenu);
                  }}
                  className="p-2 mr-1 rounded-lg transition-all duration-150 hover:bg-white/10"
                  style={{ color: showSettingsMenu ? '#fff' : '#9ca3af' }}
                  title="Export settings"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>

              {/* Export Settings (collapsible) */}
              {showSettingsMenu && (
                <div className="mx-2 mb-2 p-3 rounded-lg" style={{ backgroundColor: 'rgba(55, 65, 81, 0.5)', border: '1px solid rgba(75, 85, 99, 0.5)' }}>
                  <div className="mb-3">
                    <label className="block text-[10px] mb-2 uppercase tracking-wider font-medium" style={{ color: '#9ca3af' }}>Quality</label>
                    <div className="flex gap-1">
                      {Object.entries(QUALITY_PRESETS).map(([key, preset]) => (
                        <button
                          key={key}
                          onClick={() => setExportSettings({
                            ...exportSettings,
                            scale: preset.scale,
                            quality: preset.quality,
                          })}
                          className="flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all duration-150"
                          style={{
                            backgroundColor: exportSettings.scale === preset.scale && exportSettings.quality === preset.quality ? '#4b5563' : 'rgba(55, 65, 81, 0.5)',
                            color: exportSettings.scale === preset.scale && exportSettings.quality === preset.quality ? '#fff' : '#9ca3af'
                          }}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="block text-[10px] mb-2 uppercase tracking-wider font-medium" style={{ color: '#9ca3af' }}>Format</label>
                    <div className="flex gap-1">
                      {(['png', 'jpeg', 'webp'] as const).map((fmt) => (
                        <button
                          key={fmt}
                          onClick={() => setExportSettings({ ...exportSettings, format: fmt })}
                          className="flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium uppercase transition-all duration-150"
                          style={{
                            backgroundColor: exportSettings.format === fmt ? '#4b5563' : 'rgba(55, 65, 81, 0.5)',
                            color: exportSettings.format === fmt ? '#fff' : '#9ca3af'
                          }}
                        >
                          {fmt}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <div
                        className="w-4 h-4 rounded flex items-center justify-center transition-all"
                        style={{
                          backgroundColor: exportSettings.includeBackground !== false ? '#4b5563' : 'transparent',
                          border: exportSettings.includeBackground !== false ? '2px solid #4b5563' : '2px solid #6b7280'
                        }}
                      >
                        {exportSettings.includeBackground !== false && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <input
                        type="checkbox"
                        checked={exportSettings.includeBackground !== false}
                        onChange={(e) => setExportSettings({ ...exportSettings, includeBackground: e.target.checked })}
                        className="sr-only"
                      />
                      <span className="text-[11px]" style={{ color: '#d1d5db' }}>Background</span>
                    </label>
                    {exportSettings.includeBackground !== false && (
                      <input
                        type="color"
                        value={exportSettings.backgroundColor || '#ffffff'}
                        onChange={(e) => setExportSettings({ ...exportSettings, backgroundColor: e.target.value })}
                        className="w-6 h-6 rounded-md cursor-pointer"
                        style={{ border: '2px solid rgba(75, 85, 99, 0.6)' }}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Download ZIP */}
              <button
                onClick={async () => {
                  try {
                    setIsExporting(true);
                    toast.info('Preparing ZIP of your assets...', { autoClose: false, toastId: 'zip-progress' });
                    const assets: Array<{ url: string; name?: string }> = [];
                    const { currentComic } = useComicStore.getState();
                    const pages = currentComic?.pages || [];
                    pages.forEach((page, pi) => {
                      page.forEach((p, idx) => {
                        if (p && typeof p.url === 'string' && p.url.startsWith('http')) {
                          assets.push({ url: p.url, name: `page-${pi + 1}_panel-${idx + 1}` });
                        }
                      });
                    });
                    if (assets.length === 0) {
                      toast.dismiss('zip-progress');
                      toast.info('No downloadable assets on canvas yet.');
                      setIsExporting(false);
                      return;
                    }
                    const resp = await fetch('/api/export/zip', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ items: assets, zipName: (currentComic?.title || 'hon-export') })
                    });
                    if (!resp.ok) throw new Error(`Export failed: ${resp.status}`);
                    const blob = await resp.blob();
                    saveAs(blob, `${(currentComic?.title || 'hon-export').replace(/\s+/g, '-').toLowerCase()}.zip`);
                    toast.dismiss('zip-progress');
                    toast.success('ZIP downloaded.');
                  } catch (e:any) {
                    toast.dismiss('zip-progress');
                    toast.error(e?.message || 'ZIP export failed');
                  } finally {
                    setIsExporting(false);
                    setIsMenuOpen(false);
                  }
                }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/10 transition-all duration-150"
                disabled={isExporting}
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(75, 85, 99, 0.5)' }}>
                  <ZipIcon className="text-gray-300" />
                </div>
                <div className="text-left">
                  <div className="text-sm font-medium text-white">Download ZIP</div>
                  <div className="text-[10px]" style={{ color: '#9ca3af' }}>All assets bundled</div>
                </div>
              </button>
            </div>

            {/* Divider */}
            <div className="h-px mx-3" style={{ backgroundColor: 'rgba(75, 85, 99, 0.6)' }} />

            {/* Cloud Section */}
            <div className="p-1.5">
              <button
                onClick={handleSaveToDrive}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/10 transition-all duration-150"
                disabled={isExporting}
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(75, 85, 99, 0.5)' }}>
                  <GoogleDriveIcon />
                </div>
                <div className="text-left flex-1">
                  <div className="text-sm font-medium text-white">Google Drive</div>
                  <div className="text-[10px]" style={{ color: '#9ca3af' }}>
                    {driveMode === 'files' ? 'As folder' : driveMode === 'zip' ? 'As ZIP' : 'Folder + ZIP'}
                  </div>
                </div>
              </button>

              {/* Drive options (compact) */}
              <div className="flex items-center gap-1 px-3 py-1.5">
                {(['files', 'zip', 'both'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setDriveMode(mode)}
                    className="px-2.5 py-1 rounded-md text-[10px] transition-all"
                    style={{
                      backgroundColor: driveMode === mode ? 'rgba(75, 85, 99, 0.6)' : 'transparent',
                      color: driveMode === mode ? '#fff' : '#6b7280'
                    }}
                  >
                    {mode === 'files' ? 'Folder' : mode === 'zip' ? 'ZIP' : 'Both'}
                  </button>
                ))}
              </div>
            </div>

            {/* Divider */}
            <div className="h-px mx-3" style={{ backgroundColor: 'rgba(75, 85, 99, 0.6)' }} />

            {/* Share Section */}
            <div className="p-1.5">
              <div className="px-3 py-1">
                <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>Share</span>
              </div>
              <div className="flex gap-1 px-2">
                <button
                  onClick={() => handleShare('x')}
                  className="flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-lg hover:bg-white/10 transition-all duration-150"
                  disabled={isExporting}
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: '#000', border: '1px solid #374151' }}>
                    <XIcon className="text-white" />
                  </div>
                  <span className="text-[10px]" style={{ color: '#9ca3af' }}>X</span>
                </button>
                <button
                  onClick={() => handleShare('facebook')}
                  className="flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-lg hover:bg-white/10 transition-all duration-150"
                  disabled={isExporting}
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: '#1877F2' }}>
                    <FacebookIcon className="text-white" />
                  </div>
                  <span className="text-[10px]" style={{ color: '#9ca3af' }}>Facebook</span>
                </button>
                <button
                  onClick={() => handleShare('instagram')}
                  className="flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-lg hover:bg-white/10 transition-all duration-150"
                  disabled={isExporting}
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #833AB4, #E1306C, #F77737)' }}>
                    <InstagramIcon className="text-white" />
                  </div>
                  <span className="text-[10px]" style={{ color: '#9ca3af' }}>Instagram</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Video info dialog */}
      <VideoInfoDialog
        isOpen={showVideoInfo}
        onClose={handleVideoInfoClose}
        onConfirm={handleVideoInfoConfirm}
      />
    </>
  );
};
