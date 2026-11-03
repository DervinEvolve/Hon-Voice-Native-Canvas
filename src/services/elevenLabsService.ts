import { accessHeaders } from './apiAccess';
import { Voice } from '../types';


// Define our standard voices with the correct IDs
const STANDARD_VOICES: Voice[] = [
  { 
    id: 'fCxG8OHm4STbIsWe4aT9', 
    name: 'Harrison Gale', 
    category: 'male',
    description: 'The Velvet Voice: deep, resonant'
  },
  { 
    id: 'XB0fDUnXU5powFXDhCwa', 
    name: 'Charlotte', 
    category: 'female',
    description: 'Clear and professional female voice'
  },
  { 
    id: 'Hbb2NXaf6CKJnlEHYM1D', 
    name: 'Deep Dave',
    category: 'male',
    description: 'A deep, resonant male voice'
  },
  { 
    id: 'alMSnmMfBQWEfTP8MRcX', 
    name: 'Simeon',
    category: 'male',
    description: 'A clear, professional male voice'
  },
  { 
    id: 'EiNlNiXeDU1pqqOPrYMO', 
    name: 'John Doe',
    category: 'male',
    description: 'A natural, conversational male voice'
  },
  { 
    id: 'LcfcDJNUP1GQjkzn1xUU', 
    name: 'Emily Meditate',
    category: 'female',
    description: 'A calm, soothing female voice'
  },
  { 
    id: 'uyfkySFC5J00qZ6iLAdh', 
    name: 'Nana',
    category: 'female',
    description: 'A warm, friendly female voice'
  }
];

export class ElevenLabsService {
  private audioElements: Map<string, HTMLAudioElement>;
  private blobUrls: Set<string>;

  constructor() {
    this.audioElements = new Map();
    this.blobUrls = new Set();
  }

  // Create a silent audio buffer as a fallback
  private createSilentAudioBuffer(): ArrayBuffer {
    // Create a 1-second silent audio buffer (44.1kHz, mono)
    const sampleRate = 44100;
    const duration = 1; // seconds
    const numSamples = sampleRate * duration;
    const buffer = new ArrayBuffer(44 + numSamples * 2); // 44 bytes header + 2 bytes per sample
    const view = new DataView(buffer);
    
    // RIFF header
    view.setUint32(0, 0x52494646, false); // 'RIFF'
    view.setUint32(4, 36 + numSamples * 2, true); // file size - 8
    view.setUint32(8, 0x57415645, false); // 'WAVE'
    
    // fmt chunk
    view.setUint32(12, 0x666D7420, false); // 'fmt '
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true); // sample rate
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    
    // data chunk
    view.setUint32(36, 0x64617461, false); // 'data'
    view.setUint32(40, numSamples * 2, true); // data size
    
    // Fill with silence (all zeros)
    for (let i = 0; i < numSamples; i++) {
      view.setInt16(44 + i * 2, 0, true);
    }
    
    return buffer;
  }

  async generateSpeech(text: string, voiceId: string): Promise<ArrayBuffer> {
    if (!text || !voiceId) {
      console.error('ElevenLabsService: Missing required parameters', { text: !!text, voiceId: !!voiceId });
      return this.createSilentAudioBuffer();
    }

    try {
      console.log(`ElevenLabsService: Generating speech for text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}" with voice ID: ${voiceId}`);
      
      const response = await fetch('/api/elevenlabs/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...await accessHeaders() },
        body: JSON.stringify({ text, voiceId }),
      });
      if (!response.ok) throw new Error('Speech request failed');
      return response.arrayBuffer();
    } catch (error) {
      console.error('ElevenLabsService: Failed to generate speech:', error);
      
      // Return a silent audio buffer instead of throwing an error
      return this.createSilentAudioBuffer();
    }
  }

  async createAudioElement(audioData: ArrayBuffer): Promise<{
    play: () => Promise<void>;
    pause: () => void;
    isPlaying: () => boolean;
    cleanup: () => void;
    onEnded: (callback: () => void) => void;
  }> {
    console.log('ElevenLabsService: Creating audio element');
    
    try {
      // Create blob and URL
      const blob = new Blob([audioData], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      console.log('ElevenLabsService: Created blob URL:', url);
      this.blobUrls.add(url);
      
      // Create audio element
      const audio = new Audio(url);
      let isPlaying = false;
      let endedCallback: (() => void) | null = null;
      
      // Set up event listeners
      const onCanPlay = () => {
        console.log('ElevenLabsService: Audio can play');
        audio.removeEventListener('canplay', onCanPlay);
      };
      
      const onError = () => {
        console.log('ElevenLabsService: Audio error event');
        // Instead of throwing an error, we'll create a silent audio element
        console.warn('ElevenLabsService: Failed to load audio, using silent fallback');
        
        // Clean up the failed audio element
        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('error', onError);
        audio.removeEventListener('ended', onEnded);
        
        // We won't throw an error here, just log it
        console.error('ElevenLabsService: Audio element encountered an error');
      };
      
      const onEnded = () => {
        console.log('ElevenLabsService: Audio ended');
        isPlaying = false;
        if (endedCallback) endedCallback();
      };
      
      audio.addEventListener('canplay', onCanPlay);
      audio.addEventListener('error', onError);
      audio.addEventListener('ended', onEnded);
      
      // Store for cleanup
      this.audioElements.set(url, audio);
      
      // Return controller
      return {
        play: async () => {
          try {
            await audio.play();
            isPlaying = true;
          } catch (error) {
            console.error('ElevenLabsService: Failed to play audio:', error);
            isPlaying = false;
            // Don't throw, just log the error
          }
        },
        pause: () => {
          audio.pause();
          isPlaying = false;
        },
        isPlaying: () => isPlaying,
        cleanup: () => {
          audio.pause();
          audio.removeEventListener('canplay', onCanPlay);
          audio.removeEventListener('error', onError);
          audio.removeEventListener('ended', onEnded);
          this.audioElements.delete(url);
          URL.revokeObjectURL(url);
          this.blobUrls.delete(url);
        },
        onEnded: (callback) => {
          endedCallback = callback;
        }
      };
    } catch (error) {
      console.error('ElevenLabsService: Failed to create audio element:', error);
      
      // Instead of throwing, return a dummy audio controller
      return {
        play: async () => { /* Do nothing */ },
        pause: () => { /* Do nothing */ },
        isPlaying: () => false,
        cleanup: () => { /* Do nothing */ },
        onEnded: () => { /* Do nothing */ }
      };
    }
  }

  previewVoice(text: string, voiceId: string): Promise<ArrayBuffer> {
    console.log('ElevenLabsService: Previewing voice:', voiceId);
    return this.generateSpeech(text, voiceId);
  }

  async getVoices(): Promise<Voice[]> {
    try {
      console.log('ElevenLabsService: Getting available voices');
      return STANDARD_VOICES;
    } catch (error) {
      console.error('ElevenLabsService: Failed to fetch voices:', error);
      throw error;
    }
  }
}

export const elevenLabsService = new ElevenLabsService(); 