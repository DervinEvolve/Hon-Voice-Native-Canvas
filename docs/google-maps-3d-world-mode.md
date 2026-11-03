## Google 3D Maps Integration Plan for World Mode

### 1. Objectives
- Render photorealistic Google 3D maps inside world mode so the dotted canvas becomes an immersive, camera-controlled globe view.
- Keep existing floating UI (Hon indicator, page manager, zoom menu, file dropdown) above the 3D layer by mounting the map under the same absolute container that currently hosts `WorldCanvas`.
- Allow Hon (voice + text) and the user (side menu) to choose between:
  - **Immersive Scene** (PlayCanvas / Gaussian splat).
  - **Real World Map** (Google 3D Maps JS API).
- Support typed search + “Queue this location” from `WorldScenesPanel` and fallback to voice intent if no manual query exists.
- Prepare hooks for spawning Meshy-generated glTF models inside Google’s scene.

### 2. Dependencies and Environment
| Item | Notes |
| --- | --- |
| `@googlemaps/js-api-loader@^2` | Already added in `package.json`. Use it to dynamically load only the `maps3d`, `places`, `marker`, or `geometry` libraries when needed instead of a blocking `<script>` tag. |
| Browser key | Store inside `.env` as `VITE_GOOGLE_MAPS_API_KEY`. Add to `ImportMetaEnv` and to Vercel project settings. Restrict by HTTP referrer + enable Maps JavaScript API. |
| Server key | Add `GOOGLE_MAPS_SERVER_KEY` (no `VITE_` prefix). Restrict by IP (Vercel + localhost) and enable **Geocoding API**. Used exclusively by `/api/world/geocode` so the client never touches the privileged key. |
| Billing | 3D Maps requires a Maps JS API project with billing enabled. Confirm quotas before deploy. |
| Referrer restrictions | Follow Google’s recommendation to set HTTP referrer limits and optionally pass `authReferrerPolicy: 'origin'` when calling `setOptions`, which is supported from v3.46+. |

```ts
// src/vite-env.d.ts
interface ImportMetaEnv {
  readonly VITE_GOOGLE_MAPS_API_KEY: string;
  // ...
}
```

Server-side env (Next API routes / Vercel Project Settings → Environment Variables):

```
GOOGLE_MAPS_SERVER_KEY=your_server_key_here
```

### 3. Loading Strategy
1. **Bootstrap loader once** near app start (e.g., inside `src/lib/googleMaps3d.ts`).
2. Call `setOptions({ apiKey, version: 'beta', authReferrerPolicy: 'origin' })` so we get 3D coverage APIs.
3. Provide helpers for on-demand imports (lazy):
   ```ts
   import { setOptions, importLibrary } from '@googlemaps/js-api-loader';

   let maps3DReady: Promise<google.maps.Maps3DLibrary> | null = null;

   export function ensureGoogleMaps3D() {
     if (!maps3DReady) {
       setOptions({
         apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
         version: 'beta',
         authReferrerPolicy: 'origin',
       });
       maps3DReady = google.maps
         .importLibrary('maps3d') as Promise<google.maps.Maps3DLibrary>;
     }
     return maps3DReady;
   }
   ```
4. The world-mode renderer waits for `ensureGoogleMaps3D()` before mounting the `<gmp-map-3d>` element so PlayCanvas and Google Maps can never initialize simultaneously.

> Reference: Google’s dynamic loader guidance prefers `importLibrary` to defer network work until the feature is actually used ([Load Maps JS API](https://developers.google.com/maps/documentation/javascript/load-maps-js-api)).

### 4. State & Data Flow
- `useComicStore.worldSettings` already tracks:
  - `mapQuery` (raw string from user).
  - `mapTarget` (resolved query + coordinates + camera config).
  - `worldModePreference`.
- Extend store actions to include:
  - `setWorldMapTarget({ query, lat, lng, heading, tilt, range })`.
  - `setMapLoadingState('idle' | 'geocoding' | 'rendering' | 'error')`.
- Flow:
  1. User selects “Real World Map”.
  2. Side menu dispatches `world-map-search-submitted` with the query.
  3. Handler (either in `WorldScenesPanel` or a controller module) calls our backend endpoint `/api/google/geocode` **or** directly calls Places Text Search via server-side proxy to avoid exposing the API key in the browser.
  4. On success we populate `mapTarget` and flip `worldModePreference` to `'map'`.
  5. Hon voice intent “take me to Times Square” reuses the same action: parse entity, call geocode if needed, then `setWorldMode(true)` so Creator renders the map overlay.

### 5. Component Architecture
| Component / Module | Responsibility |
| --- | --- |
| `WorldScenesPanel` | Already collects `mapQuery` and dispatches events. Will also show last resolved target / status indicator (Ready, Resolving, Error). |
| `WorldCanvas` | Rename or split into `WorldImmersiveCanvas` (PlayCanvas) and `WorldMapCanvas`. Rendering parent decides which one to mount based on `worldModePreference`. |
| `WorldMapCanvas` (new) | Hosts `<gmp-map-3d>` or a div that `new google.maps.Map3DElement()` attaches to. Handles camera updates, overlay layering, and instructive HUD similar to `WorldCanvas`. |
| `useGoogleWorld` hook | Orchestrates loader, geocode state, overlay registration, and global event listeners (`world-map-search-submitted`). |
| `/api/google/geocode.ts` | Server route that receives `query`, calls Places Text Search / Geocoding API with server-side key, and returns canonical lat/lng + viewport. |

Rendering tree (simplified):
```
Creator.tsx
  └─ {isWorldMode ? <WorldModeViewport /> : <BoardCanvas />}
        └─ {preference === 'map' ? <WorldMapCanvas /> : <WorldImmersiveCanvas />}
```

### 6. Map Rendering Flow
1. `WorldMapCanvas` receives `worldSettings.mapTarget`.
2. On mount:
   - Wait for `ensureGoogleMaps3D()`.
   - Create the element:
     ```ts
     const mapEl = document.createElement('gmp-map-3d');
     mapEl.setAttribute('map-id', MAP_ID);
     mapEl.camera = {
       center: { lat, lng },
       heading,
       tilt,
       range,
     };
     containerRef.current?.appendChild(mapEl);
     ```
   - Use `mapEl.addEventListener('gmp-ready', ...)` to mark `isLoaded`.
3. Keep `mapEl.camera` in sync with state updates so Hon voice commands like “tilt the camera down” just dispatch `setWorldSettings({ mapTarget: { ...existing, tilt: tilt - 10 } })`.
4. Destroy map + overlays on unmount to avoid memory leaks and double billing.

### 7. Overlay & Mesh Support
Google 3D maps calls everything “overlays.” We’ll support them incrementally:

1. **Popovers / HUDs**  
   - Show text balloons or buttons pinned to `latLng`.
   - Use `google.maps.marker.AdvancedMarkerElement` with HTML templates or the dedicated popover API.  
   - Useful for Hon’s narration or “Spawn Meshy asset here” prompts.  
   - Reference: [3D Popovers](https://developers.google.com/maps/documentation/javascript/3d/popovers).

2. **Shape + Path emphasis**  
   - Draw polylines/polygons via `google.maps.Polyline` + `google.maps.Polygon` even in 3D mode (the API handles altitude).  
   - Example: highlight a walking tour path when Hon says “guide me through Shibuya.”  
   - Reference: [3D Shapes & Lines](https://developers.google.com/maps/documentation/javascript/3d/shapes-lines).

3. **glTF Model placement**  
   - When Meshy returns a `.glb`, upload to Cloud Storage and supply absolute URL.  
   - Use the 3D models API to add:
     ```ts
     const model = new google.maps.Model({
       uri: mesh.url,
       position: { lat, lng, altitude },
       scale: 1,
       heading,
     });
     model.setMap(map);
     ```
   - Tie models to `worldSettings.objects[]` so Hon can delete / animate them later.  
   - Reference: [3D Models](https://developers.google.com/maps/documentation/javascript/3d/models).

4. **Event-driven updates**  
   - Listen for `world-map-object-add` / `world-map-object-remove` events emitted by Hon’s agent to add/remove overlays without reinitializing the map.

### 8. Search & Geocoding UX
- Debounce manual typing; only geocode when user hits “Queue this location” or Hon confirms via voice.
- Provide optimistic feedback in the panel:
  - `Resolving…`
  - `Ready: Times Square, NYC`
- Cache last 5 resolved queries in store to enable quick toggling.
- For ambiguous queries, surface alternatives via Places Autocomplete or show an inline list to avoid Hon guessing.

### 9. Error Handling & Resilience
- Wrap loader usage in try/catch and surface actionable copy (“Google Maps is unavailable. Check API key/billing.”).
- Use Google’s new error classes (`MapsNetworkError`, `MapsRequestError`, `MapsServerError`) to distinguish between client misconfiguration vs. quota vs. transient network ([Error Handling](https://developers.google.com/maps/documentation/javascript/error-handling)).
- If loader or map init fails:
  - Set `setWorldMode(false)` to drop back to standard canvas.
  - Show toast + persistent banner near Hon indicator letting the user retry.
- Log events to our telemetry (if available) so we can trace failures by API endpoint.

### 10. Voice Flow Hook Points
1. Hon hears “Show me Times Square.”
2. Hume tool handler:
   - `setWorldModePreference('map')`
   - `setWorldSettings({ mapQuery: 'Times Square' })`
   - Call server geocode → `setWorldSettings({ mapTarget: {...coords} })`
   - `setWorldMode(true)`
3. While in world mode:
   - Commands like “fly closer” map to camera adjustments.
   - “Spawn a hologram billboard” triggers Meshy text-to-3D + glTF overlay creation.
4. When user exits world mode (escape / voice), set `isWorldMode` false, remove map canvas, and restore board view.

### 11. Security & Performance Notes
- Never expose the server API key to the browser beyond what’s necessary. If we must use client key, restrict referrers and consider App Check.
- Only one renderer (PlayCanvas or Google Maps) runs per session to conserve GPU.
- Use `requestIdleCallback` to preload the loader after the user opens creator mode so the first world-mode entry feels instant.
- Clean up `gmp-map-3d` DOM node and any overlays to avoid leak warnings in console.

### 12. Next Steps Checklist
- [ ] Add `VITE_GOOGLE_MAPS_API_KEY` to env types + runtime validation.
- [ ] Create `src/lib/googleMaps3d.ts` loader helper.
- [ ] Build `/api/google/geocode` + secret management.
- [ ] Scaffold `WorldMapCanvas` and route `Creator.tsx` to render it when `worldModePreference === 'map'`.
- [ ] Wire `WorldScenesPanel` events to call new actions + show status.
- [ ] Add first overlay type (popover) to prove integration.
- [ ] QA voice commands + manual search, ensure floating UI overlays remain clickable.

