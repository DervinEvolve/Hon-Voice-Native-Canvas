import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, Loader2, Trash2, Plus, Search, CheckCircle2 } from 'lucide-react';
import { nanoid } from 'nanoid';
import JSZip from 'jszip';
import { useComicStore } from '../../store/useComicStore';
import { geocodeQuery } from '../../lib/googleMaps3d';
import { DEFAULT_MAP_HEADING, DEFAULT_MAP_TILT, estimateMapRange, formatGeocodeError, pickMapAltitude } from '../../lib/worldMapUtils';

// Supported scene file extensions (inside zips or direct upload)
const SCENE_EXTENSIONS = ['.splat', '.ply', '.glb', '.gltf'];

const ACCEPTED_EXTENSIONS = [
  '.splat',
  '.ply',
  '.json',
  '.glb',
  '.gltf',
  '.zip'
];

type UploadStatus = 'idle' | 'uploading' | 'error';

export const WorldScenesPanel: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const worldModePreference = useComicStore(s => s.worldModePreference);
  const setWorldModePreference = useComicStore(s => s.setWorldModePreference);
  const worldScenes = useComicStore(s => s.worldScenes);
  const addWorldScene = useComicStore(s => s.addWorldScene);
  const updateWorldScene = useComicStore(s => s.updateWorldScene);
  const removeWorldScene = useComicStore(s => s.removeWorldScene);
  const worldSettings = useComicStore(s => s.worldSettings);
  const setWorldSettings = useComicStore(s => s.setWorldSettings);
  const mapStatus = worldSettings.mapStatus;
  const mapError = worldSettings.mapError;
  const mapTarget = worldSettings.mapTarget;
  const isResolving = mapStatus === 'resolving';
  const [mapQuery, setMapQuery] = useState(worldSettings.mapQuery || '');

  useEffect(() => {
    const incoming = worldSettings.mapQuery || '';
    setMapQuery((current) => (current === incoming ? current : incoming));
  }, [worldSettings.mapQuery]);

  const handleModeChange = (mode: 'immersive' | 'map') => {
    if (mode === worldModePreference) return;
    setWorldModePreference(mode);
  };

  // Extract scene file from a zip archive
  const extractSceneFromZip = async (zipFile: File): Promise<{ file: File; name: string } | null> => {
    console.log('[WorldScenesPanel] Extracting scene from zip:', zipFile.name);
    
    try {
      const zip = await JSZip.loadAsync(zipFile);
      const files = Object.keys(zip.files);
      
      console.log('[WorldScenesPanel] Zip contents:', files);
      
      // Find the first supported scene file (prefer .splat, then .ply, then .glb/.gltf)
      const priorityOrder = ['.splat', '.ply', '.glb', '.gltf'];
      
      for (const ext of priorityOrder) {
        const sceneFileName = files.find(f => 
          f.toLowerCase().endsWith(ext) && !f.startsWith('__MACOSX') && !zip.files[f].dir
        );
        
        if (sceneFileName) {
          console.log('[WorldScenesPanel] Found scene file in zip:', sceneFileName);
          const fileData = await zip.files[sceneFileName].async('blob');
          const extractedFile = new File([fileData], sceneFileName.split('/').pop() || sceneFileName, {
            type: ext === '.glb' ? 'model/gltf-binary' : 'application/octet-stream'
          });
          return { 
            file: extractedFile, 
            name: zipFile.name.replace(/\.zip$/i, '') // Use zip name as scene name
          };
        }
      }
      
      console.warn('[WorldScenesPanel] No supported scene file found in zip. Contents:', files);
      return null;
    } catch (err) {
      console.error('[WorldScenesPanel] Failed to extract zip:', err);
      return null;
    }
  };

  const handleUpload = useCallback(
    async (file: File) => {
      setUploadStatus('uploading');
      setUploadError(null);

      // Check file size first (500MB limit)
      const maxSize = 500 * 1024 * 1024;
      if (file.size > maxSize) {
        setUploadStatus('error');
        setUploadError(`File too large. Maximum size is 500MB. Your file is ${(file.size / (1024 * 1024)).toFixed(1)}MB.`);
        return;
      }

      // If it's a zip file, extract the scene file first
      let fileToUpload = file;
      let sceneName = file.name.replace(/\.[^/.]+$/, '');
      
      if (file.name.toLowerCase().endsWith('.zip')) {
        console.log('[WorldScenesPanel] Processing zip file...');
        const extracted = await extractSceneFromZip(file);
        
        if (!extracted) {
          setUploadStatus('error');
          setUploadError('No supported scene file (.splat, .ply, .glb, .gltf) found in zip.');
          return;
        }
        
        fileToUpload = extracted.file;
        sceneName = extracted.name;
        console.log('[WorldScenesPanel] Extracted:', fileToUpload.name, 'Size:', (fileToUpload.size / (1024 * 1024)).toFixed(2), 'MB');
      }

      const tempId = nanoid();
      const optimisticScene = {
        id: tempId,
        name: sceneName,
        source: 'upload' as const,
        status: 'uploading' as const,
        createdAt: new Date().toISOString(),
        metadata: { size: fileToUpload.size }
      };

      addWorldScene(optimisticScene);

      try {
        // Import Supabase client
        const { supabase } = await import('../../utils/supabaseClient');

        // Generate unique file path
        const ext = fileToUpload.name.substring(fileToUpload.name.lastIndexOf('.')).toLowerCase();
        const fileName = `world-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
        const filePath = `worlds/${fileName}`;

        console.log('[WorldScenesPanel] Uploading to Supabase Storage:', filePath, 'Size:', (fileToUpload.size / (1024 * 1024)).toFixed(2), 'MB');

        // Upload to Supabase Storage
        const { data, error } = await supabase.storage
          .from('hon-assets')
          .upload(filePath, fileToUpload, {
            cacheControl: '31536000', // 1 year cache
            upsert: false,
            contentType: fileToUpload.type || 'application/octet-stream',
          });

        if (error) {
          console.error('[WorldScenesPanel] Supabase upload error:', error);
          if (error.message?.includes('Bucket not found') || error.message?.includes('not found')) {
            throw new Error('Storage bucket "hon-assets" not found. Please create it in Supabase Dashboard → Storage.');
          }
          if (error.message?.includes('row-level security') || error.message?.includes('policy')) {
            throw new Error('Storage permissions not configured. Please enable public access for the hon-assets bucket.');
          }
          if (error.message?.includes('Payload too large') || error.message?.includes('413')) {
            throw new Error(`File too large for storage. Try increasing the file size limit in Supabase Dashboard → Storage → Settings.`);
          }
          throw new Error(error.message || 'Upload failed');
        }

        // Get public URL
        const { data: urlData } = supabase.storage
          .from('hon-assets')
          .getPublicUrl(filePath);

        const fileUrl = urlData?.publicUrl;

        if (!fileUrl) {
          throw new Error('Failed to get file URL after upload');
        }

        updateWorldScene(tempId, {
          id: tempId,
          status: 'ready',
          fileUrl: fileUrl,
          thumbnailUrl: null,
          metadata: {
            ...optimisticScene.metadata,
            storagePath: filePath,
            format: ext.replace('.', ''),
            bytes: fileToUpload.size,
          }
        });
        setUploadStatus('idle');
        console.log('[WorldScenesPanel] Upload successful:', fileUrl);
        
        // Trigger LOD processing in background for .ply/.splat files
        if (ext === '.ply' || ext === '.splat') {
          console.log('[WorldScenesPanel] Triggering LOD processing...');
          updateWorldScene(tempId, {
            metadata: {
              ...optimisticScene.metadata,
              storagePath: filePath,
              format: ext.replace('.', ''),
              bytes: fileToUpload.size,
              lodStatus: 'processing',
            }
          });
          
          // Fire and forget - LOD processing happens in background
          fetch('/api/splat/process-lod', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileUrl: fileUrl,
              fileName: fileToUpload.name,
              sceneId: tempId,
            }),
          })
            .then(async response => {
              if (!response.ok) {
                const text = await response.text();
                throw new Error(`HTTP ${response.status}: ${text}`);
              }
              return response.json();
            })
            .then(result => {
              if (result.success && result.lodUrl) {
                console.log('[WorldScenesPanel] LOD processing complete:', result.lodUrl);
                updateWorldScene(tempId, {
                  metadata: {
                    ...optimisticScene.metadata,
                    storagePath: filePath,
                    format: ext.replace('.', ''),
                    bytes: fileToUpload.size,
                    lodStatus: 'ready',
                    lodUrl: result.lodUrl,
                  }
                });
              } else {
                console.warn('[WorldScenesPanel] LOD processing failed:', result.error || result.details);
                updateWorldScene(tempId, {
                  metadata: {
                    ...optimisticScene.metadata,
                    storagePath: filePath,
                    format: ext.replace('.', ''),
                    bytes: fileToUpload.size,
                    lodStatus: 'failed',
                  }
                });
              }
            })
            .catch(err => {
              console.error('[WorldScenesPanel] LOD processing error:', err);
              updateWorldScene(tempId, {
                metadata: {
                  ...optimisticScene.metadata,
                  storagePath: filePath,
                  format: ext.replace('.', ''),
                  bytes: fileToUpload.size,
                  lodStatus: 'failed',
                }
              });
            });
        }
      } catch (error) {
        console.error('[WorldScenesPanel] Upload failed', error);
        setUploadStatus('error');
        const message =
          error instanceof Error ? error.message : 'Failed to upload scene';
        setUploadError(message);
        updateWorldScene(tempId, {
          status: 'error',
          errorMessage: message
        });
      }
    },
    [addWorldScene, updateWorldScene]
  );

  const handleFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    const supported = list.filter(file =>
      ACCEPTED_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext))
    );

    if (!supported.length) {
      setUploadError(
        `Supported formats: ${ACCEPTED_EXTENSIONS.join(', ')}`
      );
      return;
    }

    supported.forEach(file => {
      handleUpload(file);
    });
  };

  const handleQueueLocation = useCallback(async () => {
    const trimmed = (mapQuery || '').trim();
    if (!trimmed) {
      setWorldSettings({
        mapError: 'Enter a location before queuing it.',
        mapStatus: 'idle',
      });
      return;
    }

    setWorldModePreference('map');
    setWorldSettings({
      mapQuery: trimmed,
      mapStatus: 'resolving',
      mapError: null,
    });
    setMapQuery(trimmed);

    try {
      const match = await geocodeQuery(trimmed);
      if (!match) {
        throw new Error('ZERO_RESULTS');
      }

      const altitude = pickMapAltitude(match.types);
      const range = estimateMapRange(match.viewport);

      setWorldSettings({
        mapTarget: {
          query: trimmed,
          lat: match.location.lat,
          lng: match.location.lng,
          altitude,
          heading: mapTarget?.heading ?? DEFAULT_MAP_HEADING,
          tilt: mapTarget?.tilt ?? DEFAULT_MAP_TILT,
          range,
          resolvedName: match.formattedAddress,
          types: match.types,
        },
        mapStatus: 'ready',
        mapError: null,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNKNOWN';
      setWorldSettings({
        mapStatus: 'error',
        mapError: formatGeocodeError(code),
      });
    }
  }, [mapQuery, mapTarget, setWorldModePreference, setWorldSettings]);

  const handleDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const files = event.dataTransfer?.files;
    if (files?.length) {
      handleFiles(files);
    }
  };

  const ImmersiveSceneList = () => {
    if (!worldScenes.length) {
      return (
        <div className="rounded-2xl border border-white/10 bg-gray-800/70 p-4 text-sm text-gray-300">
          <p className="font-semibold text-white mb-2">No scenes yet</p>
          <p className="text-xs text-gray-400">
            Upload a splat, point cloud, or glTF bundle to see it here. Hon will
            keep the latest versions ready for world mode.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {worldScenes.map(scene => {
          const isSelected = scene.id === worldSettings.selectedSceneId;
          // Truncate long file names
          const displayName = scene.name.length > 20 
            ? scene.name.substring(0, 18) + '...' 
            : scene.name;
          return (
          <div
            key={scene.id}
            className={`rounded-2xl bg-gray-800/80 p-3 border overflow-hidden ${
              isSelected ? 'border-purple-400/70 shadow-inner shadow-purple-500/20' : 'border-white/10'
            }`}
          >
            {/* Header row with thumbnail, name, and status */}
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 flex-shrink-0 rounded-lg bg-gray-900/60 flex items-center justify-center overflow-hidden text-gray-500 text-[10px] font-semibold">
                {scene.thumbnailUrl ? (
                  <img
                    src={scene.thumbnailUrl}
                    alt={`${scene.name} preview`}
                    className="w-full h-full object-cover"
                  />
                ) : scene.status === 'uploading' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  scene.name
                    .split(' ')
                    .map(chunk => chunk[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate" title={scene.name}>
                  {displayName}
                </p>
                <p className="text-[10px] text-gray-400">
                  {new Date(scene.createdAt).toLocaleDateString()}
                </p>
              </div>
              <span
                className={`flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full border ${
                  scene.status === 'ready'
                    ? 'border-emerald-400/40 text-emerald-300 bg-emerald-400/10'
                    : scene.status === 'uploading'
                    ? 'border-blue-400/40 text-blue-200 bg-blue-400/10'
                    : 'border-red-400/40 text-red-200 bg-red-400/10'
                }`}
              >
                {scene.status === 'ready'
                  ? 'Ready'
                  : scene.status === 'uploading'
                  ? 'Uploading'
                  : 'Error'}
              </span>
            </div>
            
            {/* Error message */}
            {scene.errorMessage && (
              <p className="text-[10px] text-red-300 mb-2 truncate" title={scene.errorMessage}>
                {scene.errorMessage}
              </p>
            )}
            
            {/* LOD Processing Status */}
            {scene.status === 'ready' && (
              <div className="flex items-center gap-1.5 mb-2">
                {scene.metadata?.lodStatus === 'processing' && (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                    <p className="text-[10px] text-amber-300">
                      Optimizing for streaming...
                    </p>
                  </>
                )}
                {scene.metadata?.lodStatus === 'ready' && (
                  <>
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <p className="text-[10px] text-emerald-300">
                      LOD streaming ready
                    </p>
                  </>
                )}
                {scene.metadata?.lodStatus === 'failed' && (
                  <p className="text-[10px] text-gray-400">
                    Standard loading
                  </p>
                )}
              </div>
            )}
            
            {/* Selected indicator */}
            {isSelected && (
              <p className="text-[10px] text-purple-300 mb-2">
                Selected • Will load in world mode
              </p>
            )}
            
            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <button
                disabled={scene.status !== 'ready'}
                className={`flex-1 text-[10px] px-2 py-1.5 rounded-lg transition ${
                  scene.status === 'ready'
                    ? 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 border border-purple-500/30'
                    : 'bg-gray-700/50 text-gray-500 cursor-not-allowed border border-transparent'
                }`}
                onClick={() => {
                  setWorldModePreference('immersive');
                  setWorldSettings({
                    selectedSceneId: scene.id,
                    splatUrl: scene.fileUrl || worldSettings.splatUrl || null
                  });
                }}
              >
                Use in world
              </button>
              <button
                className="text-[10px] px-2 py-1.5 rounded-lg bg-transparent border border-white/10 text-gray-400 hover:text-red-300 hover:border-red-400/50 hover:bg-red-500/10 transition flex items-center justify-center gap-1"
                onClick={() => removeWorldScene(scene.id)}
                title="Remove"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        );
      })}
      </div>
    );
  };

  return (
    <div className="bg-gray-800 box-border flex flex-col items-start justify-start p-[24px] w-full border-t border-gray-700/40">
      <div className="flex items-center justify-between w-full mb-4">
        <h2 className="font-['Inter'] font-bold text-[20px] text-white not-italic">
          World Scenes
        </h2>
        <span className="text-[11px] text-gray-400 uppercase tracking-wide">
          Beta
        </span>
      </div>

      <div className="flex gap-2 mb-5">
        <button
          className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition border ${
            worldModePreference === 'immersive'
              ? 'bg-purple-600 text-white border-purple-400/70 shadow-inner shadow-purple-400/40'
              : 'bg-gray-900/60 text-gray-300 border-white/5 hover:border-white/20'
          }`}
          onClick={() => handleModeChange('immersive')}
        >
          Immersive Scene
        </button>
        <button
          className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition border ${
            worldModePreference === 'map'
              ? 'bg-blue-600 text-white border-blue-400/70 shadow-inner shadow-blue-400/40'
              : 'bg-gray-900/60 text-gray-300 border-white/5 hover:border-white/20'
          }`}
          onClick={() => handleModeChange('map')}
        >
          Real World Map
        </button>
      </div>

      {worldModePreference === 'immersive' ? (
        <>
          <label
            className="border-2 border-dashed border-white/20 rounded-2xl p-5 flex flex-col items-center justify-center text-center text-sm text-gray-300 cursor-pointer bg-gray-900/40 hover:border-white/40 transition mb-5"
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-6 h-6 text-white mb-2" />
            <span className="font-semibold text-white">
              Drag & Drop world files
            </span>
            <span className="text-xs text-gray-400 mt-1">
              .splat, .glb, .gltf (Gaussian splat .ply from Luma/Polycam)
            </span>
            <span className="text-xs text-purple-300 mt-2 flex items-center gap-1">
              <Plus className="w-3 h-3" />
              or click to browse
            </span>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept={ACCEPTED_EXTENSIONS.join(',')}
              onChange={(e) => {
                if (e.target.files?.length) {
                  handleFiles(e.target.files);
                  e.target.value = '';
                }
              }}
            />
          </label>
          {uploadStatus === 'error' && uploadError && (
            <p className="text-xs text-red-300 mb-3">{uploadError}</p>
          )}
          <ImmersiveSceneList />
        </>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-gray-800/70 p-4 text-sm text-gray-300 space-y-4 w-full">
          <div>
            <p className="font-semibold text-white mb-1">Real World Maps</p>
            <p className="text-xs text-gray-400">
              Type a destination to seed Hon’s Google 3D map. If you don’t say a place
              out loud, we’ll use whatever you enter here.
            </p>
          </div>
          <div className="relative">
            <input
              type="text"
              placeholder="Search cities or landmarks (e.g. Times Square)"
              value={mapQuery}
              onChange={(e) => {
                setMapQuery(e.target.value);
              }}
              className="w-full rounded-xl bg-gray-900/80 text-sm text-white border border-white/10 pl-10 pr-3 py-2 focus:outline-none focus:border-white/30 placeholder:text-gray-500"
            />
            <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          </div>
          <button
            className={`w-full rounded-xl bg-gradient-to-r from-blue-600 to-sky-500 text-white py-2.5 text-sm font-semibold flex items-center justify-center gap-2 transition ${
              isResolving ? 'opacity-60 cursor-not-allowed' : 'hover:opacity-90'
            }`}
            disabled={isResolving}
            onClick={handleQueueLocation}
          >
            {isResolving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Resolving…
              </>
            ) : (
              <>
                <Search className="w-4 h-4" />
                Queue this location
              </>
            )}
          </button>
          {mapStatus === 'ready' && mapTarget?.resolvedName && (
            <p className="text-xs text-emerald-300 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Ready: {mapTarget.resolvedName}
            </p>
          )}
          {mapStatus === 'error' && mapError && (
            <p className="text-xs text-red-300">{mapError}</p>
          )}
          <div className="text-xs text-gray-400 flex flex-col gap-1">
            <span className="text-gray-300 font-semibold">3D Map Superpowers:</span>
            <ul className="list-disc list-inside space-y-1">
              <li>Drop Meshy-generated glTF props onto the map.</li>
              <li>Ask Hon for scripted flythroughs (“Tour downtown Tokyo”).</li>
              <li>Restyle roads, landmarks, and markers to match your palette.</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

