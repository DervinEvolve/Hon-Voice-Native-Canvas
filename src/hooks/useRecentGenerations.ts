import { useState, useEffect } from 'react';
import { recentGenerationsService, RecentGenerationRecord } from '../services/recentGenerationsService';

export const useRecentGenerations = () => {
  const [recentGenerations, setRecentGenerations] = useState<Array<{ url: string; prompt: string; timestamp: Date; model: string; type: string; metadata?: Record<string, any> }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecentGenerations = async () => {
    try {
      setLoading(true);
      const data = await recentGenerationsService.listForCurrentUser(100);
      setRecentGenerations(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch recent generations');
      setRecentGenerations([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecentGenerations();
  }, []);

  return {
    recentGenerations,
    loading,
    error,
    refetch: fetchRecentGenerations
  };
};
