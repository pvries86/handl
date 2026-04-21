import { useState, useEffect } from 'react';
import { UserProfile } from '../types';
import { listAgents } from '../lib/api';

export function useAgents() {
  const [agents, setAgents] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    listAgents()
      .then((agentData) => {
        if (!cancelled) setAgents(agentData);
      })
      .catch((error) => {
        console.error('Failed to load agents', error);
        if (!cancelled) setAgents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { agents, loading };
}
