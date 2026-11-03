type MapLatLng = { lat: number; lng: number };

export interface GeocodeMatch {
  location: MapLatLng;
  formattedAddress: string;
  types: string[];
  viewport?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

// Direct script loading instead of @googlemaps/js-api-loader
// This ensures we can use v=alpha which is required for 3D Maps
let loadPromise: Promise<void> | null = null;
let Map3DElementClass: any = null;

function loadGoogleMapsScript(): Promise<void> {
  if (loadPromise) return loadPromise;
  
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const mapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID?.trim();
  
  console.log('[googleMaps3d] Loading Google Maps with direct script injection');
  console.log('[googleMaps3d] API Key present:', !!apiKey, 'length:', apiKey?.length);
  console.log('[googleMaps3d] Map ID:', mapId);
  console.log('[googleMaps3d] Current page URL:', window.location.href);
  console.log('[googleMaps3d] Current origin:', window.location.origin);
  
  if (!apiKey) {
    console.error('[googleMaps3d] CRITICAL: VITE_GOOGLE_MAPS_API_KEY is missing!');
    return Promise.reject(new Error('Missing VITE_GOOGLE_MAPS_API_KEY'));
  }
  
  loadPromise = new Promise((resolve, reject) => {
    // Check if already loaded
    if (window.google?.maps?.importLibrary) {
      console.log('[googleMaps3d] Google Maps already loaded');
      resolve();
      return;
    }
    
    // Set up global error handler to catch Google Maps auth errors
    const originalGm_authFailure = (window as any).gm_authFailure;
    (window as any).gm_authFailure = () => {
      console.error('[googleMaps3d] ❌ Google Maps AUTH FAILURE - Check API key restrictions!');
      console.error('[googleMaps3d] Your referrer:', document.referrer || window.location.href);
      console.error('[googleMaps3d] Add this to your API key allowed referrers:', window.location.origin + '/*');
      if (originalGm_authFailure) originalGm_authFailure();
    };
    
    // Create callback name
    const callbackName = '__googleMapsCallback_' + Date.now();
    
    // Set up callback
    (window as any)[callbackName] = () => {
      console.log('[googleMaps3d] Google Maps script loaded via callback');
      delete (window as any)[callbackName];
      resolve();
    };
    
    // Build script URL with v=alpha for 3D Maps support
    const params = new URLSearchParams({
      key: apiKey,
      v: 'alpha', // CRITICAL: Required for 3D Maps!
      libraries: 'maps,maps3d',
      callback: callbackName,
    });
    
    if (mapId) {
      params.set('map_ids', mapId);
    }
    
    const scriptUrl = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    console.log('[googleMaps3d] Loading script:', scriptUrl.replace(apiKey, 'API_KEY_HIDDEN'));
    
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.defer = true;
    script.onerror = (e) => {
      console.error('[googleMaps3d] Script load error:', e);
      delete (window as any)[callbackName];
      reject(new Error('Failed to load Google Maps script'));
    };
    
    document.head.appendChild(script);
  });
  
  return loadPromise;
}

export async function ensureMaps3D() {
  console.log('[googleMaps3d] ensureMaps3D called');
  
  await loadGoogleMapsScript();
  
  console.log('[googleMaps3d] Script loaded, importing maps3d library...');
  console.log('[googleMaps3d] Google Maps version:', (window as any).google?.maps?.version);
  
  // Use the new importLibrary API
  const maps3d = await (window as any).google.maps.importLibrary('maps3d');
  console.log('[googleMaps3d] maps3d library imported:', maps3d);
  
  // Store the class for later use
  Map3DElementClass = maps3d.Map3DElement;
  
  // Check if custom elements are registered
  const alreadyRegistered = customElements.get('gmp-map-3d');
  console.log('[googleMaps3d] gmp-map-3d already registered?', !!alreadyRegistered);
  
  if (!alreadyRegistered && Map3DElementClass) {
    console.log('[googleMaps3d] Registering gmp-map-3d custom element');
    customElements.define('gmp-map-3d', Map3DElementClass);
  }
  
  // Wait for custom element to be defined
  await customElements.whenDefined('gmp-map-3d');
  console.log('[googleMaps3d] gmp-map-3d is now defined');
  
  return maps3d;
}

export function getMap3DElementClass(): any {
  return Map3DElementClass;
}

export function createMap3DElement(options?: {
  center?: { lat: number; lng: number; altitude?: number };
  heading?: number;
  tilt?: number;
  range?: number;
  mapId?: string;
}): HTMLElement | null {
  if (!Map3DElementClass) {
    console.error('[googleMaps3d] Map3DElement class not loaded yet');
    return null;
  }
  
  console.log('[googleMaps3d] Creating Map3DElement with options:', options);
  try {
    const element = new Map3DElementClass(options);
    console.log('[googleMaps3d] Created element:', element);
    return element;
  } catch (error) {
    console.error('[googleMaps3d] Failed to create Map3DElement:', error);
    return null;
  }
}

export async function ensurePlaces() {
  await loadGoogleMapsScript();
  return (window as any).google.maps.importLibrary('places');
}

export async function geocodeQuery(query: string): Promise<GeocodeMatch | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  try {
    const response = await fetch(
      `/api/world/geocode?query=${encodeURIComponent(trimmed)}`
    );
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload?.status || payload?.error || 'GEOCODE_FAILED');
    }

    return payload as GeocodeMatch;
  } catch (error) {
    throw error instanceof Error ? error : new Error('GEOCODE_FAILED');
  }
}
