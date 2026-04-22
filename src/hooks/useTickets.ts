import { useState, useEffect } from 'react';
import { Ticket } from '../types';
import { listTickets, TICKETS_CHANGED_EVENT } from '../lib/api';

export function useTickets(filter: string = 'all', currentUserId?: string, currentUserEmail?: string, searchQuery?: string) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const loadTickets = async (showLoadingState = false) => {
      if (showLoadingState) setLoading(true);
      try {
        const ticketData = await listTickets(filter, currentUserId, currentUserEmail, searchQuery);
        if (!cancelled) setTickets(ticketData);
      } catch (error) {
        console.error('Failed to load tickets', error);
        if (!cancelled) setTickets([]);
      } finally {
        if (!cancelled && showLoadingState) setLoading(false);
      }
    };

    void loadTickets(true);

    const interval = window.setInterval(() => {
      void loadTickets(false);
    }, 5000);

    const handleTicketsChanged = () => {
      void loadTickets(false);
    };

    window.addEventListener(TICKETS_CHANGED_EVENT, handleTicketsChanged);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener(TICKETS_CHANGED_EVENT, handleTicketsChanged);
    };
  }, [filter, currentUserId, currentUserEmail, searchQuery]);

  return { tickets, loading };
}
