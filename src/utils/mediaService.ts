import { env } from './env';

class MediaService {
  private objectUrls: Map<string, string> = new Map();
  private blobCache: Map<string, Blob> = new Map();

  async load(input: string | File): Promise<string> {
    if (typeof input === 'string') {
      // If it's already a Cloudinary URL, return it
      if (input.includes('cloudinary')) {
        return input;
      }

      // If it's a blob URL, try to use cached blob or fetch new one
      if (input.startsWith('blob:')) {
        try {
          // Try to get from cache first
          const cachedBlob = this.blobCache.get(input);
          if (cachedBlob) {
            const file = new File([cachedBlob], 'media', { type: cachedBlob.type });
            return this.upload(file);
          }

          const response = await fetch(input);
          if (!response.ok) {
            console.error('Failed to fetch blob:', response.statusText);
            return input;
          }

          const blob = await response.blob();
          // Cache the blob
          this.blobCache.set(input, blob);
          const file = new File([blob], 'media', { type: blob.type });
          return this.upload(file);
        } catch (error) {
          console.error('Failed to handle blob URL:', error);
          return input;
        }
      }

      return input;
    }

    return this.upload(input);
  }

  async upload(input: string | File): Promise<string> {
    try {
      console.log('MediaService upload called with:', input instanceof File ? `File (${input.name}, ${input.type}, ${input.size} bytes)` : input);
      
      // If input is a string (URL), return it as-is (already uploaded)
      if (typeof input === 'string') {
        if (input.includes('cloudinary')) {
          return input;
        }
        // Handle blob URLs by converting to File first
        if (input.startsWith('blob:')) {
          try {
            const cachedBlob = this.blobCache.get(input);
            if (cachedBlob) {
              const file = new File([cachedBlob], 'media', { type: cachedBlob.type });
              return this.upload(file);
            }
            const response = await fetch(input);
            if (!response.ok) {
              console.error('Failed to fetch blob:', response.statusText);
              return input;
            }
            const blob = await response.blob();
            this.blobCache.set(input, blob);
            const file = new File([blob], 'media', { type: blob.type });
            return this.upload(file);
          } catch (error) {
            console.error('Failed to handle blob URL:', error);
            return input;
          }
        }
        return input;
      }

      // File upload - try direct unsigned Cloudinary first, then proxy presets
      const cloudName = env.VITE_CLOUDINARY_CLOUD_NAME;
      const unsignedPreset = env.VITE_CLOUDINARY_UPLOAD_PRESET;

      // 1) Direct unsigned upload (best for Vercel 413 avoidance)
      try {
        const fileObj = input as File;
        // Use auto to let Cloudinary decide the correct resource type
        const endpoint = 'auto/upload';
        const form = new FormData();
        form.append('file', fileObj);
        form.append('upload_preset', unsignedPreset);
        const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${endpoint}`, {
          method: 'POST',
          body: form
        });
        if (res.ok) {
          const data = await res.json();
          return data.secure_url as string;
        }
        try {
          const err = await res.json();
          console.warn('Direct unsigned Cloudinary upload non-OK:', res.status, err);
        } catch (_) {
          console.warn('Direct unsigned Cloudinary upload non-OK:', res.status);
        }
      } catch (e) {
        console.warn('Direct unsigned Cloudinary upload failed, will try proxy.', e);
      }

      console.log('Attempting secure upload via proxy with Cloudinary config:', { cloudName });
      // 2) Proxy presets fallback
      const presets = ['hon_comics', 'hon_upload', 'ml_default', 'ml_upload', 'unsigned_upload'];
      
      for (const preset of presets) {
        try {
          console.log(`Trying secure upload with preset: ${preset}`);
          
          // Convert file to base64
          const fileReader = new FileReader();
          const fileBase64 = await new Promise((resolve, reject) => {
            fileReader.onload = () => resolve(fileReader.result);
            fileReader.onerror = reject;
            fileReader.readAsDataURL(input);
          });
          
          const response = await fetch('/api/cloudinary-upload', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            // The server picks the Cloudinary account and preset.
            body: JSON.stringify({
              file: fileBase64,
              preset: preset
            })
          });

          if (response.ok) {
            const data = await response.json();
            console.log(`Secure upload successful with preset ${preset}:`, data.url);
            return data.url;
          } else {
            try {
              const errorData = await response.json();
              console.warn(`Secure upload failed with preset ${preset}, status ${response.status}:`, errorData.error);
            } catch (e) {
              console.warn(`Secure upload failed with preset ${preset}, status ${response.status}`);
            }
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
            console.warn(`Network error with preset ${preset}: Failed to reach proxy endpoint`);
          } else {
            console.warn(`Error with preset ${preset}:`, error);
          }
          // Continue to next preset
        }
      }
      
      // If we get here, all uploads failed - try a direct unsigned fetch again in case of transient CORS
      try {
        const fileObj = input as File;
        const endpointRetry = 'auto/upload';
        const f2 = new FormData();
        f2.append('file', fileObj);
        f2.append('upload_preset', unsignedPreset);
        const r2 = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${endpointRetry}`, { method: 'POST', body: f2 });
        if (r2.ok) {
          const j = await r2.json();
          return j.secure_url as string;
        }
      } catch (e) {
        // ignore and continue to poster extraction
      }

      // If we still fail, try to extract a poster image from videos as a fallback
      try {
        const fileObj = input as File;
        if (fileObj.type.includes('video')) {
          console.log('Attempting to extract video poster and upload as image cover...');
          const objectUrl = URL.createObjectURL(fileObj);
          const videoEl = document.createElement('video');
          videoEl.src = objectUrl;
          videoEl.muted = true;
          videoEl.playsInline = true;
          await new Promise(resolve => {
            videoEl.onloadeddata = () => resolve(true);
            videoEl.onerror = () => resolve(true);
          });
          const canvas = document.createElement('canvas');
          const width = videoEl.videoWidth || 1280;
          const height = videoEl.videoHeight || 720;
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(videoEl, 0, 0, width, height);
            const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
            if (blob) {
              const frameFile = new File([blob], 'cover-frame.jpg', { type: 'image/jpeg' });
              const form2 = new FormData();
              form2.append('file', frameFile);
              form2.append('upload_preset', unsignedPreset);
              const res2 = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: 'POST', body: form2 });
              if (res2.ok) {
                const data2 = await res2.json();
                console.log('Uploaded video poster as image cover:', data2.secure_url);
                return data2.secure_url as string;
              }
            }
          }
        }
      } catch (thumbErr) {
        console.warn('Failed to extract/upload video poster thumbnail:', thumbErr);
      }

      // If we get here, all uploads failed - fall back to local blob storage
      console.log('All upload methods failed, falling back to local storage');
      
      // Fallback to local blob URL storage
      if (input instanceof File) {
        console.log('Using local blob storage for file');
        const blobUrl = URL.createObjectURL(input);
        this.objectUrls.set(blobUrl, blobUrl);
        this.blobCache.set(blobUrl, input);
        return blobUrl;
      }
      
      throw new Error('Invalid input type');
    } catch (error) {
      console.error('Upload process failed completely:', error);
      if (typeof input === 'string') {
        return input; // Return original URL as fallback
      }
      throw error;
    }
  }

  createObjectURL(blob: Blob): string {
    try {
      const url = URL.createObjectURL(blob);
      this.objectUrls.set(url, url);
      this.blobCache.set(url, blob);
      
      // Expose the blob directly for use in img/video elements without fetch
      console.log('Created blob URL:', url);
      return url;
    } catch (error) {
      console.error('Failed to create object URL:', error);
      return ''; // Return empty string as fallback
    }
  }

  // Special method to handle panel image loading without fetch
  getPanelBlobUrl(blobUrl: string): { objectUrl: string, blob?: Blob } {
    // Check if we have this blob in cache
    const cachedBlob = this.blobCache.get(blobUrl);
    if (cachedBlob) {
      return { objectUrl: blobUrl, blob: cachedBlob };
    }
    return { objectUrl: blobUrl };
  }

  revoke(url: string): void {
    if (this.objectUrls.has(url)) {
      URL.revokeObjectURL(url);
      this.objectUrls.delete(url);
      this.blobCache.delete(url);
    }
  }

  async clear(): Promise<void> {
    this.objectUrls.forEach(url => {
      URL.revokeObjectURL(url);
    });
    this.objectUrls.clear();
    this.blobCache.clear();
  }

  async testCloudinaryConfig(): Promise<boolean> {
    try {
      console.log('Testing Cloudinary configuration...');
      const cloudName = env.VITE_CLOUDINARY_CLOUD_NAME;
      const apiKey = env.VITE_CLOUDINARY_API_KEY;
      
      if (!cloudName || !apiKey) {
        console.error('Cloudinary configuration missing: cloudName or apiKey not set');
        return false;
      }
      
      console.log('Cloudinary config present:', { 
        cloudName, 
        apiKey: apiKey.slice(0, 5) + '...',
      });
      
      // Instead of trying to ping, which will fail due to CORS,
      // we'll do a basic sanity check on the config
      return !!cloudName && !!apiKey;
    } catch (error) {
      console.error('Cloudinary config test failed:', error);
      return false;
    }
  }
}

export const mediaService = new MediaService();
