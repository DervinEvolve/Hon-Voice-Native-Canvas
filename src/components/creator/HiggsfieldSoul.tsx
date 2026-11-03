import React, { useCallback, useEffect, useState } from 'react';
import { higgsfieldService } from '../../services/higgsfieldService';
import { userCharactersService } from '../../services/userCharactersService';

export const HiggsfieldSoul: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [refs, setRefs] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [characters, setCharacters] = useState<Array<{ id: string; image_url?: string | null; name?: string | null; soul_id?: string | null }>>([]);

  useEffect(() => {
    (async () => {
      try {
        const rows = await userCharactersService.listForCurrentUser(50);
        setCharacters(rows);
      } catch {}
    })();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    const uploaded: string[] = [];

    const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

    for (const file of files) {
      try {
        const dataUrl = await readAsDataUrl(file);
        const resp = await fetch('/api/cloudinary-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: dataUrl })
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data?.url) uploaded.push(data.url);
        }
      } catch {}
    }
    if (uploaded.length) setRefs(prev => Array.from(new Set([...prev, ...uploaded])));
  }, []);

  const onGenerate = async () => {
    if (!prompt.trim()) {
      setError('Enter a character description');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    setResultUrl(null);
    try {
      const result = await higgsfieldService.createSoulId(prompt.trim(), refs);
      if (!result?.url) throw new Error('No result URL');
      setResultUrl(result.url);
      // Save/upsert with soul_id when available
      await userCharactersService.upsertForCurrentUser({ name: prompt.slice(0, 60), soul_id: result.soul_id || undefined, image_url: result.url, metadata: { refsCount: refs.length } });
      const rows = await userCharactersService.listForCurrentUser(50);
      setCharacters(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create character');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-300">Character Prompt</label>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe the character, outfit, style, pose..."
        className="w-full p-2 border rounded-md resize-none focus:ring-2 focus:ring-purple-500 text-white bg-gray-700 border-gray-600 placeholder-gray-400"
        rows={4}
      />

      <div
        className="w-full p-4 border-2 border-dashed rounded-md bg-gray-800 text-gray-300"
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={handleDrop}
      >
        Drag & drop reference images (optional)
      </div>
      {!!refs.length && (
        <div className="grid grid-cols-3 gap-2">
          {refs.map((u) => (
            <img key={u} src={u} className="w-full h-20 object-cover rounded" />
          ))}
        </div>
      )}

      <button
        onClick={onGenerate}
        disabled={isSubmitting || !prompt.trim()}
        className="w-full py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting ? 'Creating Soul...' : 'Create Character'}
      </button>

      {error && <div className="text-red-500 text-sm">{error}</div>}
      {resultUrl && (
        <div className="mt-3">
          <img src={resultUrl} className="w-full rounded" />
        </div>
      )}

      {/* Saved Characters */}
      {!!characters.length && (
        <div className="mt-4">
          <div className="text-sm text-gray-300 mb-2">Your Characters</div>
          <div className="grid grid-cols-3 gap-2">
            {characters.map(c => (
              <div key={c.id} className="bg-gray-800 rounded p-1">
                {c.image_url ? (
                  <img src={c.image_url} className="w-full h-24 object-cover rounded" />
                ) : (
                  <div className="w-full h-24 bg-gray-700 rounded" />
                )}
                <div className="text-[11px] text-gray-300 mt-1 truncate">{c.name || 'Character'}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};


