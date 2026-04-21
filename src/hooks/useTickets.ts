import { useState, useEffect } from 'react';
import { Ticket } from '../types';
import { listTickets } from '../lib/api';

export function useTickets(filter: string = 'all', currentUserId?: string, currentUserEmail?: string) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    listTickets(filter, currentUserId, currentUserEmail)
      .then((ticketData) => {
        if (!cancelled) setTickets(ticketData);
      })
      .catch((error) => {
        console.error('Failed to load tickets', error);
        if (!cancelled) setTickets([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const interval = window.setInterval(() => {
      listTickets(filter, currentUserId, currentUserEmail)
        .then((ticketData) => !cancelled && setTickets(ticketData))
        .catch((error) => console.error('Failed to refresh tickets', error));
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [filter, currentUserId, currentUserEmail]);

  return { tickets, loading };
}
