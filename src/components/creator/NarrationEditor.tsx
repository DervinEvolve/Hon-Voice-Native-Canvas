import React, { useState, useEffect, useRef } from 'react';
import { Mic, Play, Pause, Save, Settings2 } from 'lucide-react';
import { useComicStore } from '../../store/useComicStore';
import { elevenLabsService } from '../../services/elevenLabsService';
import { Voice } from '../../types';

// Define types for Hume (adjust as needed)
interface HumeVoice {
  id: string;
  name: string;
  // Add other relevant fields if fetched later
}

// Updated list of Hume voices with correct names and IDs (UUIDs)
const PREDEFINED_HUME_VOICES: HumeVoice[] = [
  { id: '5bb7de05-c8fe-426a-8fcc-ba4fc4ce9f9c', name: 'Ava Song' },
  { id: 'ee96fb5f-ec1a-4f41-a9ba-6d119e64c8fd', name: 'Vince Douglas' },
  { id: '96ee3964-5f3f-4a5a-be09-393e833aaf0e', name: 'Imani Carter' },
  { id: '7f633ac4-8181-4e0d-99e1-11a4ef033691', name: 'Terrance Bentley' },
  { id: '176a55b1-4468-4736-8878-db82729667c1', name: 'Nature Documentary Narrator' },
  { id: '5bbc32c1-a1f6-44e8-bedb-9870f23619e2', name: 'Sitcom Girl' },
  { id: '2a7b176a-ca45-4ff8-8a65-56f873a5fdc7', name: 'Awe Inspired Guy' },
  { id: 'cb1a4fae-dad5-4729-bd73-a43f570b9117', name: 'Live Comedian' }, 
  { id: '99d2cb9c-9011-4ead-8734-641656d3df66', name: 'Comforting Male Conversationalist' },
  { id: 'f3f69312-095c-4ec3-8e50-6961c676e898', name: 'Cool Journalist' },
  { id: '15f594d3-0683-4585-b799-ce12e939a0e2', name: 'Brooding intellectual man' },
];

export const NarrationEditor: React.FC = () => {
  const { currentComic, currentPageIndex, updatePageNarration, getPageNarration } = useComicStore();
  const [text, setText] = useState('');
  const [selectedElevenVoice, setSelectedElevenVoice] = useState<Voice | null>(null);
  const [elevenVoices, setElevenVoices] = useState<Voice[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = useRef<{
    play: () => Promise<void>;
    pause: () => void;
    isPlaying: () => boolean;
    cleanup: () => void;
  } | null>(null);

  // --- New State for Engine Selection and Hume ---
  const [selectedEngine, setSelectedEngine] = useState<'eleven' | 'hume'>('eleven');
  const [selectedHumeLibraryVoiceId, setSelectedHumeLibraryVoiceId] = useState<string>(PREDEFINED_HUME_VOICES[0]?.id || ''); // Default to first predefined voice ID
  const [humeVoices, setHumeVoices] = useState<HumeVoice[]>(PREDEFINED_HUME_VOICES);
  const [humeVoicePrompt, setHumeVoicePrompt] = useState('');
  const [humeActingInstruction, setHumeActingInstruction] = useState('');
  const [showHumePromptInput, setShowHumePromptInput] = useState(false); // Added state for progressive disclosure

  // Load Eleven Labs voices and existing narration
  useEffect(() => {
    const loadElevenVoices = async () => {
      try {
        const availableVoices = await elevenLabsService.getVoices();
        setElevenVoices(availableVoices);
        // Don't default select here, wait for narration load
      } catch (error) {
        console.error('Failed to load Eleven Labs voices:', error);
      }
    };
    loadElevenVoices();

    // TODO: Fetch Hume voices if using library
    // const loadHumeVoices = async () => { ... setHumeVoices(...) ... };
    // loadHumeVoices();

  }, []);

  // Load existing narration for current page
  useEffect(() => {
    const currentNarration = getPageNarration(currentPageIndex);
    setShowHumePromptInput(false); // Reset prompt input visibility

    if (currentNarration) {
      setText(currentNarration.text);
      setSelectedEngine(currentNarration.engine || 'eleven');
      
      if (currentNarration.engine === 'hume') {
        // Restore Hume settings
        setHumeActingInstruction(currentNarration.humeActingInstruction || '');
        // Check if a prompt was used
        if (currentNarration.humeVoicePrompt) {
          setHumeVoicePrompt(currentNarration.humeVoicePrompt);
          setSelectedHumeLibraryVoiceId(PREDEFINED_HUME_VOICES[0]?.id || ''); // Reset library selection
          setShowHumePromptInput(true); // Show the prompt input
        } else {
          // Library voice was used
          setHumeVoicePrompt(''); // Clear prompt
          setSelectedHumeLibraryVoiceId(currentNarration.humeVoiceId || PREDEFINED_HUME_VOICES[0]?.id || '');
          setShowHumePromptInput(false); // Ensure prompt input is hidden
        }
      } else {
        // Restore Eleven Labs settings
        const voice = elevenVoices.find(v => v.id === currentNarration.voiceId);
        if (voice) setSelectedElevenVoice(voice);
        else if (elevenVoices.length > 0) setSelectedElevenVoice(elevenVoices[0]);
        // Reset Hume state when switching back to Eleven
        setHumeVoicePrompt('');
        setHumeActingInstruction('');
        setSelectedHumeLibraryVoiceId(PREDEFINED_HUME_VOICES[0]?.id || '');
      }
    } else {
       // Reset state for empty/new page
       setText('');
       setSelectedEngine('eleven');
       if (elevenVoices.length > 0) setSelectedElevenVoice(elevenVoices[0]);
       setSelectedHumeLibraryVoiceId(PREDEFINED_HUME_VOICES[0]?.id || '');
       setHumeVoicePrompt('');
       setHumeActingInstruction('');
    }
  }, [currentPageIndex, getPageNarration, elevenVoices]); // Removed humeVoices dependency as it's static for now

  // Cleanup audio on unmount or page change
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.cleanup();
        audioRef.current = null;
      }
    };
  }, [currentPageIndex]);

  const handlePreview = async () => {
    if (!text) return;
    if (selectedEngine === 'eleven' && !selectedElevenVoice) return;
    // Validation for Hume
    if (selectedEngine === 'hume') {
      if (showHumePromptInput && !humeVoicePrompt) {
         console.warn('Hume preview skipped: Voice prompt input is visible but empty.');
         alert('Please enter a voice design prompt or hide the prompt input.');
         return;
      }
      if (!showHumePromptInput && selectedHumeLibraryVoiceId === 'PLACEHOLDER_HUME_VOICE_ID') {
         console.warn('Hume preview skipped: Placeholder voice ID selected.');
         alert('Please select a valid Hume library voice first.');
         return;
      }
    }

    try {
      setIsLoading(true);
      // Stop any existing audio
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.cleanup();
        audioRef.current = null;
      }

      let audioData: ArrayBuffer | null = null;

      if (selectedEngine === 'eleven' && selectedElevenVoice) {
        console.log('Generating Eleven Labs speech...');
        audioData = await elevenLabsService.generateSpeech(text, selectedElevenVoice.id);
        console.log('Eleven Labs speech generated.');
      } else if (selectedEngine === 'hume') {
        console.log('Generating Hume AI speech...');
        // --- Prepare Hume API call --- 
        const usePrompt = showHumePromptInput && humeVoicePrompt;
        const payload: any = {
          text: text,
          actingInstruction: humeActingInstruction || undefined,
        };
        if (usePrompt) {
          payload.voicePrompt = humeVoicePrompt;
          payload.voiceSource = 'prompt'; // Inform backend (optional but good practice)
        } else {
          payload.voiceId = selectedHumeLibraryVoiceId;
          payload.voiceSource = 'library'; // Inform backend
        }

        console.log('Calling backend /api/tts/hume with payload:', payload);
        
        // --- Fetch Audio from Backend --- 
        const response = await fetch('/api/tts/hume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          let errorMsg = `Hume TTS generation failed: ${response.statusText}`;
          try {
             const errorData = await response.json(); // Try to parse error JSON
             errorMsg = `Hume TTS generation failed: ${errorData.error || response.statusText}`;
          } catch (_) {
            // Ignore if response is not JSON
          }
          throw new Error(errorMsg);
        }
        
        // Get audio data as ArrayBuffer
        console.log('Hume TTS backend call successful, processing audio...');
        audioData = await response.arrayBuffer(); 
      }

      if (!audioData) {
        throw new Error('Failed to generate audio data.');
      }

      // Create audio controller (using elevenLabsService helper for now, might need generalization)
      console.log('Creating audio element...');
      const audio = await elevenLabsService.createAudioElement(audioData);
      audioRef.current = audio;

      console.log('Starting playback...');
      await audio.play();
      setIsPlaying(true);

    } catch (error) {
      console.error('Preview failed:', error);
      setIsPlaying(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!text || !currentComic) return;
    // Validation based on engine
     if (selectedEngine === 'eleven' && !selectedElevenVoice) return;
     if (selectedEngine === 'hume') {
        if (showHumePromptInput && !humeVoicePrompt) return alert('Please enter a voice prompt before saving.');
        if (!showHumePromptInput && selectedHumeLibraryVoiceId === 'PLACEHOLDER_HUME_VOICE_ID') return alert('Please select a library voice before saving.');
     }
    
    try {
      setIsLoading(true);
      // Prepare payload for store update
      const usePrompt = selectedEngine === 'hume' && showHumePromptInput && humeVoicePrompt;
      const narrationPayload: any = {
        text,
        engine: selectedEngine,
      };

      if (selectedEngine === 'eleven' && selectedElevenVoice) {
        narrationPayload.voiceId = selectedElevenVoice.id; // Use standard voiceId for Eleven
      } else if (selectedEngine === 'hume') {
        narrationPayload.humeActingInstruction = humeActingInstruction;
        if (usePrompt) {
          narrationPayload.humeVoicePrompt = humeVoicePrompt;
          // Optionally clear library ID if saving a prompt-based voice
          // narrationPayload.humeVoiceId = null; 
        } else {
          narrationPayload.humeVoiceId = selectedHumeLibraryVoiceId;
           // Optionally clear prompt if saving a library-based voice
          // narrationPayload.humeVoicePrompt = null;
        }
      } else {
        throw new Error('Invalid engine state for saving.');
      }

      await updatePageNarration(currentPageIndex, narrationPayload);
      
      // Show success feedback
      const button = document.querySelector('#save-narration-button');
      if (button) {
        const originalText = button.textContent;
        button.textContent = 'Saved!';
        setTimeout(() => {
          button.textContent = originalText;
        }, 2000);
      }

    } catch (error) {
      console.error('Failed to save narration:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const togglePlay = async () => {
    if (!audioRef.current) {
      await handlePreview();
      return;
    }

    try {
      if (audioRef.current.isPlaying()) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        await audioRef.current.play();
        setIsPlaying(true);
      }
    } catch (error) {
      console.error('Toggle playback failed:', error);
      setIsPlaying(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Removed duplicate AI Narration title */}

      {/* --- Engine Selection UI --- */}
      <div className="flex justify-center space-x-2 mb-4 p-1 bg-gray-700 rounded-lg">
        <button
          onClick={() => setSelectedEngine('eleven')}
          className={`px-4 py-1 rounded-md text-sm font-medium transition-colors ${
            selectedEngine === 'eleven' 
              ? 'bg-purple-600 text-white shadow-md' 
              : 'text-gray-300 hover:bg-gray-600'
          }`}
        >
          Eleven Labs
        </button>
        <button
          onClick={() => setSelectedEngine('hume')}
          className={`px-4 py-1 rounded-md text-sm font-medium transition-colors ${
            selectedEngine === 'hume' 
              ? 'bg-purple-600 text-white shadow-md' 
              : 'text-gray-300 hover:bg-gray-600'
          }`}
        >
          Hume AI (Octave)
        </button>
      </div>

      <div className="space-y-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter narration text..."
          className="w-full h-32 p-3 border rounded-lg resize-none focus:ring-2 focus:ring-purple-500 text-white bg-gray-700 border-gray-600 placeholder-gray-400"
        />

        {/* --- Eleven Labs Options (Conditional) --- */}
        {selectedEngine === 'eleven' && (
          <div className="flex items-center space-x-4">
            <select
              value={selectedElevenVoice?.id || ''}
              onChange={(e) => setSelectedElevenVoice(elevenVoices.find(v => v.id === e.target.value) || null)}
              className="p-2 border rounded-lg flex-grow text-white bg-gray-700 border-gray-600"
            >
              {elevenVoices.map(voice => (
                <option 
                  key={voice.id} 
                  value={voice.id}
                  title={voice.description} // Assuming Voice type has description
                >
                  {voice.name} ({voice.category})
                </option>
              ))}
            </select>
             {/* Preview/Save buttons moved below engine-specific options */}
          </div>
        )}

        {/* --- Hume AI Options (Conditional) --- */}
        {selectedEngine === 'hume' && (
          <div className="space-y-4 p-3 border border-dashed border-purple-400 dark:border-purple-600 rounded-lg">
            <h3 className="text-lg font-medium text-purple-700 dark:text-purple-300 flex items-center mb-2">
              <Settings2 className="w-4 h-4 mr-2"/>
              Hume Configuration
            </h3>
            
            {/* Library Voice Selection */}
            <div>
              <label htmlFor="hume-voice-library" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Select Library Voice</label>
              <select
                 id="hume-voice-library"
                 value={selectedHumeLibraryVoiceId}
                 onChange={(e) => {
                   setSelectedHumeLibraryVoiceId(e.target.value);
                   setShowHumePromptInput(false); // Hide prompt if library voice is selected
                   setHumeVoicePrompt(''); // Clear prompt value
                 }}
                 className="w-full p-2 border rounded-lg text-white bg-gray-700 border-gray-600"
                 disabled={showHumePromptInput} // Disable if prompt input is showing
              >
                <option value="" disabled>-- Select Voice --</option> {/* Changed placeholder ID to empty string */}
                {humeVoices.map(voice => (
                  <option key={voice.id} value={voice.id}>{voice.name}</option>
                ))}
              </select>
            </div>

            {/* Conditionally Show Prompt Input Area */}
            {showHumePromptInput && (
               <div>
                 <label htmlFor="hume-voice-prompt" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Describe Voice (Prompt)</label>
                 <input
                   type="text"
                   id="hume-voice-prompt"
                   value={humeVoicePrompt}
                   onChange={(e) => setHumeVoicePrompt(e.target.value)}
                   placeholder="e.g., Calm counselor, gruff goblin..."
                   className="w-full p-2 border rounded-lg text-white bg-gray-700 border-gray-600"
                 />
              </div>
            )}

            {/* Button to toggle prompt input */}
            {!showHumePromptInput && (
               <button 
                 onClick={() => {
                   setShowHumePromptInput(true);
                   setSelectedHumeLibraryVoiceId('PLACEHOLDER_HUME_VOICE_ID'); // Deselect library voice when showing prompt
                 }}
                 className="mt-2 text-sm text-purple-600 dark:text-purple-400 hover:underline"
               >
                 ✨ Design Custom Voice with Prompt...
               </button>
            )}
             {showHumePromptInput && (
               <button 
                 onClick={() => setShowHumePromptInput(false)} 
                 className="mt-2 text-sm text-gray-500 hover:underline"
               >
                 Use Library Voice Instead
               </button>
             )}

            {/* Always show Acting Instructions Input */}
            <div>
              <label htmlFor="hume-acting-instruction" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 mt-3">Acting Instructions (Optional)</label>
              <input
                type="text"
                id="hume-acting-instruction"
                value={humeActingInstruction}
                onChange={(e) => setHumeActingInstruction(e.target.value)}
                placeholder="e.g., Whispering, angry, joyful..."
                className="w-full p-2 border rounded-lg text-white bg-gray-700 border-gray-600"
              />
            </div>
          </div>
        )}

         {/* --- Shared Preview/Save Buttons --- */}
         <div className="flex items-center space-x-4">
            {/* Adjust placeholder based on currently visible options */} 
            {(selectedEngine === 'hume' && !showHumePromptInput) && <div className="flex-grow"></div>} 
            {(selectedEngine === 'eleven') && <div className="flex-grow"></div>} 

            <button
              onClick={togglePlay}
              disabled={isLoading || !text || 
                 (selectedEngine === 'eleven' && !selectedElevenVoice) || 
                 (selectedEngine === 'hume' && ((showHumePromptInput && !humeVoicePrompt) || (!showHumePromptInput && !selectedHumeLibraryVoiceId))) // Updated disable check
              }
              className="p-2 rounded-lg bg-green-400 dark:bg-green-500 hover:bg-green-500 dark:hover:bg-green-400 disabled:bg-gray-200 dark:disabled:bg-gray-600 disabled:opacity-50 transition-all shadow-md hover:shadow-lg border-2 border-green-500 dark:border-green-400 relative"
              title={isPlaying ? "Pause narration" : "Play narration"}
              style={{ boxShadow: "0 0 8px rgba(34, 197, 94, 0.5)" }}
            >
              {isPlaying ? (
                <Pause className="w-6 h-6 text-white" />
              ) : (
                <Play className="w-6 h-6 text-white" />
              )}
              <span className="absolute -top-1 -right-1 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-300 dark:bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400 dark:bg-green-300"></span>
              </span>
            </button>

            <button
              onClick={handleSave}
              disabled={isLoading || !text || 
                 (selectedEngine === 'eleven' && !selectedElevenVoice) || 
                 (selectedEngine === 'hume' && ((showHumePromptInput && !humeVoicePrompt) || (!showHumePromptInput && !selectedHumeLibraryVoiceId))) // Updated disable check
              }
              id="save-narration-button"
              className="px-3 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 flex items-center space-x-1"
              title="Save narration"
            >
              <Save className="w-4 h-4" />
              <span>Save</span>
            </button>
         </div>

      </div>
    </div>
  );
};
