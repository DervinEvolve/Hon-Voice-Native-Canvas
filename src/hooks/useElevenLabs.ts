import { useState, useEffect } from 'react';
import { Voice } from '../types';
import { elevenLabsService } from '../services/elevenLabsService';

export const useElevenLabs = () => {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadVoices = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const fetchedVoices = await elevenLabsService.getVoices();
        if (mounted) {
          setVoices(fetchedVoices);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load voices');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    loadVoices();

    return () => {
      mounted = false;
    };
  }, []);

  const generateSpeech = async (text: string, voiceId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      return await elevenLabsService.generateSpeech(text, voiceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate speech');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const previewVoice = async (text: string, voiceId: string) => {
    try {
      const url = await elevenLabsService.generateSpeech(text, voiceId);
      const audio = elevenLabsService.createAudioElement(url, 0);
      return audio;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to preview voice');
      throw err;
    }
  };

  return {
    voices,
    isLoading,
    error,
    generateSpeech,
    previewVoice
  };
}; 