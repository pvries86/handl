import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { useTickets } from './hooks/useTickets';
import { Ticket, TicketStatus, TicketPriority } from './types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { 
  Search, 
  Filter, 
  LogOut, 
  Moon,
  Sun,
  Ticket as TicketIcon, 
  PanelLeftClose,
  PanelLeftOpen,
  Loader2,
  MailPlus,
  User as UserIcon,
  Users as UsersIcon,
  History,
  Trash2,
  X
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { CreateTicketDialog } from './components/CreateTicket';
import { TicketDetailsDialog } from './components/TicketDetails';
import { Toaster } from '@/components/ui/sonner';
import { UserManagement } from './components/UserManagement';
import { createTicket, deleteTicket, importEmailPreview, updateTicket } from './lib/api';

type DeadlineFilter = 'all' | 'overdue' | 'today' | 'this_week' | 'none';
type TicketSort = 'changed_desc' | 'created_desc' | 'priority_desc' | 'deadline_asc';
const STATUS_FILTER_OPTIONS: Array<{ value: TicketStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'new', label: 'New' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];
const PRIORITY_FILTER_OPTIONS: Array<{ value: TicketPriority | 'all'; label: string }> = [
  { value: 'all', label: 'All priorities' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];
const DEADLINE_FILTER_OPTIONS: Array<{ value: DeadlineFilter; label: string }> = [
  { value: 'all', label: 'Any due date' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'this_week', label: 'Due this week' },
  { value: 'none', label: 'No due date' },
];
const SIDEBAR_PINNED_KEY = 'handl_sidebar_pinned';
const LEGACY_SIDEBAR_PINNED_KEY = 'taskflow_sidebar_pinned';
const THEME_KEY = 'handl_theme';
const LEGACY_THEME_KEY = 'taskflow_theme';

function getStatusClass(status: TicketStatus) {
  switch (status) {
    case 'new':
      return 'status-new';
    case 'open':
      return 'status-open';
    case 'in_progress':
      return 'status-progress';
    case 'waiting':
      return 'status-waiting';
    case 'resolved':
      return 'status-resolved';
    case 'closed':
      return 'status-closed';
    default:
      return 'status-open';
  }
}

function getStatusLabel(status: TicketStatus) {
  switch (status) {
    case 'new':
      return 'New';
    case 'open':
      return 'Open';
    case 'in_progress':
      return 'In Progress';
    case 'waiting':
      return 'Waiting';
    case 'resolved':
      return 'Resolved';
    case 'closed':
      return 'Closed';
    default:
      return status;
  }
}

function getPriorityClass(priority: TicketPriority) {
  switch (priority) {
    case 'low':
      return 'priority-low';
    case 'medium':
      return 'priority-medium';
    case 'high':
      return 'priority-high';
    case 'critical':
      return 'priority-critical';
    default:
      return 'priority-medium';
  }
}

function getPriorityLabel(priority: TicketPriority) {
  switch (priority) {
    case 'low':
      return 'Low';
    case 'medium':
      return 'Medium';
    case 'high':
      return 'High';
    case 'critical':
      return 'Critical';
    default:
      return priority;
  }
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function endOfToday() {
  const today = startOfToday();
  today.setDate(today.getDate() + 1);
  return today;
}

function endOfThisWeek() {
  const today = startOfToday();
  const day = today.getDay();
  const daysUntilSunday = (7 - day) % 7;
  const end = new Date(today);
  end.setDate(today.getDate() + daysUntilSunday + 1);
  return end;
}

function getDeadlineState(ticket: Ticket) {
  const deadline = ticket.deadline?.toDate ? ticket.deadline.toDate() : null;
  if (!deadline) return { kind: 'none' as const, label: 'No due date', classes: 'border-slate-200 bg-slate-50 text-slate-500' };

  const now = new Date();
  const todayStart = startOfToday();
  const todayEnd = endOfToday();
  const weekEnd = endOfThisWeek();

  if (deadline < now) {
    return { kind: 'overdue' as const, label: `Overdue ${format(deadline, 'MMM d')}`, classes: 'border-red-200 bg-red-50 text-red-700' };
  }
  if (deadline >= todayStart && deadline < todayEnd) {
    return { kind: 'today' as const, label: 'Due today', classes: 'border-amber-200 bg-amber-50 text-amber-700' };
  }
  if (deadline >= todayStart && deadline < weekEnd) {
    return { kind: 'week' as const, label: `This week ${format(deadline, 'EEE')}`, classes: 'border-sky-200 bg-sky-50 text-sky-700' };
  }

  return { kind: 'scheduled' as const, label: format(deadline, 'MMM d'), classes: 'border-slate-200 bg-slate-50 text-slate-600' };
}

export default function App() {
  const { user, profile, loading: authLoading, signIn, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showListFilters, setShowListFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<TicketPriority | 'all'>('all');
  const [deadlineFilter, setDeadlineFilter] = useState<DeadlineFilter>('all');
  const [ticketSort, setTicketSort] = useState<TicketSort>('changed_desc');
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [creatingFromMail, setCreatingFromMail] = useState(false);
  const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<TicketStatus>('open');
  const [bulkUpdatingStatus, setBulkUpdatingStatus] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginName, setLoginName] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [showSidebarSearch, setShowSidebarSearch] = useState(false);
  const sidebarSearchRef = useRef<HTMLDivElement | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    const stored = window.localStorage.getItem(THEME_KEY) ?? window.localStorage.getItem(LEGACY_THEME_KEY);
    return stored === 'dark' ? 'dark' : 'light';
  });
  const [sidebarPinned, setSidebarPinned] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored =
      window.localStorage.getItem(SIDEBAR_PINNED_KEY) ?? window.localStorage.getItem(LEGACY_SIDEBAR_PINNED_KEY);
    return stored === null ? true : stored === 'true';
  });
  const { tickets, loading: ticketsLoading } = useTickets(activeTab, user?.uid, user?.email || undefined, searchQuery);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const sidebarExpanded = sidebarPinned;
  const selectedStatusFilterLabel = STATUS_FILTER_OPTIONS.find((option) => option.value === statusFilter)?.label || 'All statuses';
  const selectedPriorityFilterLabel = PRIORITY_FILTER_OPTIONS.find((option) => option.value === priorityFilter)?.label || 'All priorities';
  const selectedDeadlineFilterLabel = DEADLINE_FILTER_OPTIONS.find((option) => option.value === deadlineFilter)?.label || 'Any due date';

  useEffect(() => {
    if (!profile) return;
    if (activeTab === 'users' && profile.role !== 'admin') {
      setActiveTab('all');
    }
    if (activeTab === 'assigned' && profile.role === 'user') {
      setActiveTab('all');
    }
  }, [activeTab, profile]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SIDEBAR_PINNED_KEY, String(sidebarPinned));
    window.localStorage.removeItem(LEGACY_SIDEBAR_PINNED_KEY);
  }, [sidebarPinned]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const root = window.document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    window.localStorage.setItem(THEME_KEY, theme);
    window.localStorage.removeItem(LEGACY_THEME_KEY);
  }, [theme]);

  useEffect(() => {
    if (sidebarExpanded) {
      setShowSidebarSearch(false);
    }
  }, [sidebarExpanded]);

  useEffect(() => {
    if (!showSidebarSearch) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!sidebarSearchRef.current) return;
      if (sidebarSearchRef.current.contains(event.target as Node)) return;
      setShowSidebarSearch(false);
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [showSidebarSearch]);

  const hasActiveListFilters =
    statusFilter !== 'all' || priorityFilter !== 'all' || deadlineFilter !== 'all' || unassignedOnly;

  const filteredTickets = useMemo(() => {
    const todayStart = startOfToday();
    const todayEnd = endOfToday();
    const weekEnd = endOfThisWeek();
    const priorityWeight: Record<TicketPriority, number> = {
      low: 0,
      medium: 1,
      high: 2,
      critical: 3,
    };

    const filtered = tickets.filter((ticket) => {
      if (statusFilter !== 'all' && ticket.status !== statusFilter) return false;
      if (priorityFilter !== 'all' && ticket.priority !== priorityFilter) return false;
      if (unassignedOnly && ticket.assigneeId) return false;

      const deadline = ticket.deadline?.toDate ? ticket.deadline.toDate() : null;
      if (deadlineFilter === 'none' && deadline) return false;
      if (deadlineFilter === 'overdue' && (!deadline || deadline >= new Date())) return false;
      if (deadlineFilter === 'today' && (!deadline || deadline < todayStart || deadline >= todayEnd)) return false;
      if (deadlineFilter === 'this_week' && (!deadline || deadline < todayStart || deadline >= weekEnd)) return false;
      if (deadlineFilter !== 'none' && deadlineFilter !== 'all' && !deadline) return false;

      return true;
    });

    filtered.sort((a, b) => {
      if (ticketSort === 'created_desc') {
        const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
        return bTime - aTime;
      }
      if (ticketSort === 'priority_desc') {
        const byPriority = priorityWeight[b.priority] - priorityWeight[a.priority];
        if (byPriority !== 0) return byPriority;
        const aTime = a.updatedAt?.toDate ? a.updatedAt.toDate().getTime() : 0;
        const bTime = b.updatedAt?.toDate ? b.updatedAt.toDate().getTime() : 0;
        return bTime - aTime;
      }
      if (ticketSort === 'deadline_asc') {
        const aTime = a.deadline?.toDate ? a.deadline.toDate().getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.deadline?.toDate ? b.deadline.toDate().getTime() : Number.MAX_SAFE_INTEGER;
        if (aTime !== bTime) return aTime - bTime;
        const aUpdated = a.updatedAt?.toDate ? a.updatedAt.toDate().getTime() : 0;
        const bUpdated = b.updatedAt?.toDate ? b.updatedAt.toDate().getTime() : 0;
        return bUpdated - aUpdated;
      }

      const aTime = a.updatedAt?.toDate ? a.updatedAt.toDate().getTime() : 0;
      const bTime = b.updatedAt?.toDate ? b.updatedAt.toDate().getTime() : 0;
      return bTime - aTime;
    });

    return filtered;
  }, [deadlineFilter, priorityFilter, statusFilter, ticketSort, tickets, unassignedOnly]);

  const bulkMode = selectionMode;

  useEffect(() => {
    if (selectionMode && selectedTicketIds.length === 0) {
      setSelectionMode(false);
    }
  }, [selectionMode, selectedTicketIds.length]);

  if (authLoading) {
    return (
      <>
        <Toaster position="top-right" />
        <div className="flex items-center justify-center min-h-screen bg-bg-main">
          <div className="animate-pulse flex flex-col items-center gap-4">
            <div className="w-12 h-12 bg-primary/20 rounded-full" />
            <p className="text-sm text-text-light font-mono">INITIALIZING HANDL...</p>
          </div>
        </div>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <Toaster position="top-right" />
        <div className="flex items-center justify-center min-h-screen bg-bg-main p-4">
          <Card className="w-full max-w-md border-none shadow-2xl bg-white dark:bg-slate-900">
            <CardHeader className="text-center space-y-1">
              <img src="/handl-mark.svg" alt="Handl" className="mx-auto mb-4 h-14 w-14 rounded-2xl shadow-lg" />
              <CardTitle className="text-2xl font-bold tracking-tight">Handl</CardTitle>
              <CardDescription>Handle support without the overhead</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-center text-sm text-text-light">
                Sign in to keep work moving, capture updates, and stay on top of your queue.
              </p>
              <form
                className="space-y-3"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setLoginLoading(true);
                  try {
                    await signIn(loginEmail, loginName);
                  } catch (error: any) {
                    toast.error(error?.message || 'Sign in failed');
                  } finally {
                    setLoginLoading(false);
                  }
                }}
              >
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={loginEmail}
                  onChange={(event) => setLoginEmail(event.target.value)}
                  required
                />
                <Input
                  placeholder="Your name"
                  value={loginName}
                  onChange={(event) => setLoginName(event.target.value)}
                />
                <Button type="submit" className="w-full py-6 text-lg font-medium" size="lg" disabled={loginLoading}>
                  {loginLoading ? 'Signing in...' : 'Sign in'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  const handleInboxImport = async (files: File[]) => {
    const mailFile = files.find((file) => file.name.toLowerCase().endsWith('.msg'));
    if (!mailFile) return;

    setCreatingFromMail(true);
    try {
      const result = await importEmailPreview(mailFile, { persistUpload: false });
      const ticket = await createTicket({
        title: result.draft.title || '(Imported email)',
        description: result.draft.description || 'Imported from Outlook email.',
        priority: 'medium',
        requesterName: result.draft.requesterName || 'Unknown requester',
        requesterEmail: '',
        createdById: profile?.uid,
        createdByName: profile?.displayName,
        tags: [],
        attachments: [],
      });
      setSelectedTicket(ticket);
      if (result.parseError) {
        toast.warning(`Created ticket from ${mailFile.name}, but parsing was limited`);
      } else {
        toast.success(`Created ticket from ${mailFile.name}`);
      }
    } catch (error: any) {
      console.error('Failed to create ticket from email', error);
      toast.error(error?.message || 'Failed to create ticket from email');
    } finally {
      setCreatingFromMail(false);
    }
  };

  const toggleTicketSelection = (ticketId: string) => {
    setSelectedTicketIds((current) =>
      current.includes(ticketId) ? current.filter((id) => id !== ticketId) : [...current, ticketId],
    );
  };

  const toggleSelectAllVisible = () => {
    setSelectedTicketIds((current) => {
      const visibleIds = filteredTickets.map((ticket) => ticket.id);
      const visibleSelected = visibleIds.length > 0 && visibleIds.every((id) => current.includes(id));
      if (visibleSelected) {
        return current.filter((id) => !visibleIds.includes(id));
      }
      return Array.from(new Set([...current, ...visibleIds]));
    });
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedTicketIds([]);
  };

  const handleTicketDeleted = (ticketId: string) => {
    setSelectedTicketIds((current) => current.filter((id) => id !== ticketId));
    if (selectedTicket?.id === ticketId) {
      setSelectedTicket(null);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedTicketIds.length === 0) return;
    const confirmed = window.confirm(`Delete ${selectedTicketIds.length} selected ticket${selectedTicketIds.length === 1 ? '' : 's'}?`);
    if (!confirmed) return;

    setBulkDeleting(true);
    try {
      for (const ticketId of selectedTicketIds) {
        await deleteTicket(ticketId);
      }
      toast.success(`Deleted ${selectedTicketIds.length} ticket${selectedTicketIds.length === 1 ? '' : 's'}`);
      if (selectedTicket && selectedTicketIds.includes(selectedTicket.id)) {
        setSelectedTicket(null);
      }
      setSelectedTicketIds([]);
    } catch (error: any) {
      console.error('Failed to delete selected tickets', error);
      toast.error(error?.message || 'Failed to delete selected tickets');
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleBulkStatusUpdate = async (nextStatus = bulkStatus) => {
    if (selectedTicketIds.length === 0) return;

    setBulkUpdatingStatus(true);
    try {
      for (const ticketId of selectedTicketIds) {
        await updateTicket(ticketId, { status: nextStatus });
      }
      toast.success(`Updated ${selectedTicketIds.length} ticket${selectedTicketIds.length === 1 ? '' : 's'} to ${nextStatus.replace('_', ' ')}`);
      setSelectedTicketIds([]);
    } catch (error: any) {
      console.error('Failed to bulk update status', error);
      toast.error(error?.message || 'Failed to bulk update status');
    } finally {
      setBulkUpdatingStatus(false);
    }
  };

  const handleBulkStatusChange = async (nextStatus: TicketStatus) => {
    setBulkStatus(nextStatus);
    if (selectedTicketIds.length === 0) return;
    await handleBulkStatusUpdate(nextStatus);
  };

  return (
    <div className="h-screen flex overflow-hidden bg-bg-main">
      <Toaster position="top-right" />
      
      {/* Sidebar */}
      <aside
        className={`bg-sidebar text-white flex flex-col py-6 shrink-0 transition-[width] duration-200 ${
          sidebarExpanded ? 'w-[220px]' : 'w-[72px]'
        }`}
      >
        <div className={`mb-8 ${sidebarExpanded ? 'px-6' : 'px-4'}`}>
          <div className={sidebarExpanded ? 'space-y-2' : ''}>
            <div
              className={`flex items-center text-[#38bdf8] font-extrabold tracking-tight ${
                sidebarExpanded ? 'gap-2 text-xl' : 'justify-center text-xl'
              }`}
            >
              <img src="/handl-mark.svg" alt="Handl" className="h-7 w-7 rounded-lg" />
              {sidebarExpanded && <span>Handl</span>}
            </div>
            {sidebarExpanded && (
              <p className="max-w-[160px] text-[11px] leading-4 text-white/55">Handle support without the overhead</p>
            )}
          </div>
        </div>

        <div className={`mb-5 ${sidebarExpanded ? 'px-6' : 'px-4'}`}>
          {sidebarExpanded ? (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/35" />
              <Input
                placeholder="Search tickets..."
                className="h-9 border-white/10 bg-white/5 pl-9 text-sm text-white placeholder:text-white/35 focus-visible:border-white/20 focus-visible:ring-white/10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          ) : (
            <div ref={sidebarSearchRef} className="relative flex justify-center">
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-md bg-white/5 text-white/55 transition-colors hover:bg-white/10 hover:text-white"
                onClick={() => setShowSidebarSearch((current) => !current)}
                title="Search tickets"
              >
                <Search className="h-4 w-4" />
              </button>
              {showSidebarSearch && (
                <div className="absolute left-full top-1/2 z-30 ml-3 w-72 -translate-y-1/2 rounded-xl border border-white/10 bg-sidebar/95 p-3 shadow-2xl backdrop-blur">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                    <Input
                      autoFocus
                      placeholder="Search tickets..."
                      className="h-9 border-white/10 bg-white/5 pl-9 pr-9 text-sm text-white placeholder:text-white/35 focus-visible:border-white/20 focus-visible:ring-white/10"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-white/45 transition-colors hover:bg-white/5 hover:text-white"
                      onClick={() => setShowSidebarSearch(false)}
                      title="Close search"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-1">
          {[
            {
              id: 'all',
              label: profile?.role === 'user' ? 'My Open Tickets' : 'All Open Tickets',
              icon: TicketIcon,
            },
            ...(profile?.role === 'admin' || profile?.role === 'agent'
              ? [{ id: 'assigned', label: 'Assigned to Me', icon: UserIcon }]
              : []),
            { id: 'archived', label: 'Archived Tasks', icon: History },
            ...(profile?.role === 'admin' ? [{ id: 'users', label: 'Users', icon: UsersIcon }] : []),
          ].map((item) => (
            <div 
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`${sidebarExpanded ? 'px-6' : 'px-4 justify-center'} py-3 flex items-center gap-3 text-sm cursor-pointer border-l-4 transition-all ${
                activeTab === item.id 
                  ? 'bg-white/5 border-primary opacity-100' 
                  : 'border-transparent opacity-60 hover:opacity-100 hover:bg-white/5'
              }`}
              title={!sidebarExpanded ? item.label : undefined}
            >
              <item.icon className="w-4 h-4" />
              {sidebarExpanded && <span>{item.label}</span>}
            </div>
          ))}
        </nav>

        <div className={`mt-auto pt-4 border-t border-white/10 space-y-4 ${sidebarExpanded ? 'px-6' : 'px-4'}`}>
          <div className={`${sidebarExpanded ? 'w-full px-0' : 'w-full'} flex items-center ${sidebarExpanded ? 'justify-start gap-3' : 'justify-center'}`}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 overflow-hidden border border-white/20">
              {profile?.photoURL ? (
                <img src={profile.photoURL} alt="Avatar" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
              ) : (
                <UserIcon className="h-4 w-4 text-white/40" />
              )}
            </div>
            {sidebarExpanded && (
              <div className="min-w-0">
                <p className="text-xs font-bold truncate">{profile?.displayName}</p>
                <p className="text-[10px] text-white/40 uppercase tracking-tighter">{profile?.role}</p>
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSidebarPinned((current) => !current)}
            className={`${sidebarExpanded ? 'w-full justify-start px-0' : 'w-full justify-center px-0'} text-white/60 hover:text-white hover:bg-white/5`}
            title={!sidebarExpanded ? (sidebarPinned ? 'Collapse sidebar' : 'Expand sidebar') : undefined}
          >
            {sidebarPinned ? (
              <PanelLeftClose className={`w-4 h-4 ${sidebarExpanded ? 'mr-2' : ''}`} />
            ) : (
              <PanelLeftOpen className={`w-4 h-4 ${sidebarExpanded ? 'mr-2' : ''}`} />
            )}
            {sidebarExpanded && (sidebarPinned ? 'Collapse Sidebar' : 'Expand Sidebar')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            className={`${sidebarExpanded ? 'w-full justify-start px-0' : 'w-full justify-center px-0'} text-white/60 hover:text-white hover:bg-white/5`}
            title={!sidebarExpanded ? (theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode') : undefined}
          >
            {theme === 'dark' ? (
              <Sun className={`w-4 h-4 ${sidebarExpanded ? 'mr-2' : ''}`} />
            ) : (
              <Moon className={`w-4 h-4 ${sidebarExpanded ? 'mr-2' : ''}`} />
            )}
            {sidebarExpanded && (theme === 'dark' ? 'Light Mode' : 'Dark Mode')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            className={`${sidebarExpanded ? 'w-full justify-start px-0' : 'w-full justify-center px-0'} text-white/60 hover:text-white hover:bg-white/5`}
            title={!sidebarExpanded ? 'Logout' : undefined}
          >
            <LogOut className={`w-4 h-4 ${sidebarExpanded ? 'mr-2' : ''}`} />
            {sidebarExpanded && 'Logout'}
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeTab === 'users' ? (
          <UserManagement />
        ) : (
          <>
        <div className="flex-1 flex overflow-hidden">
          {/* Ticket List */}
          <aside className="flex w-[360px] min-h-0 shrink-0 flex-col bg-white dark:bg-slate-950">
            <div
              className={`pt-4 pb-3 transition-colors ${
                creatingFromMail ? 'bg-slate-50/70 dark:bg-slate-900/70' : 'bg-white dark:bg-slate-950'
              }`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const files = Array.from(e.dataTransfer.files) as File[];
                if (files.length > 0) handleInboxImport(files);
              }}
            >
              <div className="mx-4 rounded-xl bg-[#f8fafc] px-4 py-4 shadow-[inset_0_0_0_1px_rgba(226,232,240,0.7)] dark:bg-slate-900 dark:shadow-[inset_0_0_0_1px_rgba(30,41,59,0.9)]">
                <div>
                  <CreateTicketDialog triggerClassName="h-9 w-full justify-center shadow-none" triggerLabel="New Ticket" />
                </div>
                <div className="my-3" />
                <button
                  type="button"
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors ${
                    creatingFromMail
                      ? 'bg-white/80 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700'
                      : 'bg-white/70 hover:bg-white dark:bg-slate-800/90 dark:hover:bg-slate-800'
                  }`}
                  onClick={() => {
                    if (creatingFromMail) return;
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.msg';
                    input.onchange = (e) => {
                      const files = Array.from((e.target as HTMLInputElement).files || []);
                      if (files.length > 0) handleInboxImport(files);
                    };
                    input.click();
                  }}
                >
                  {creatingFromMail ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                  ) : (
                    <MailPlus className="h-4 w-4 shrink-0 text-primary" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-text-dark">Create From Email</div>
                    <div className="text-[11px] text-text-light">Drop an Outlook mail here to create a ticket from the message.</div>
                  </div>
                </button>
              </div>
            </div>
            <div className="mx-4 mb-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-[#f8fafc] shadow-[inset_0_0_0_1px_rgba(226,232,240,0.7)] dark:bg-slate-900 dark:shadow-[inset_0_0_0_1px_rgba(30,41,59,0.9)]">
              <div className="flex items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="shrink-0 font-bold text-sm">Tickets ({filteredTickets.length})</span>
                  {bulkMode && (
                    <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">
                      {selectedTicketIds.length} selected
                    </span>
                  )}
                </div>
                {bulkMode ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-text-light hover:text-text-dark"
                    onClick={exitSelectionMode}
                    title="Exit selection"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <select
                      value={ticketSort}
                      onChange={(e) => setTicketSort(e.target.value as TicketSort)}
                    className="h-8 min-w-[88px] rounded-md border border-border-theme bg-white px-2 text-[11px] text-text-dark dark:bg-slate-950 dark:text-slate-100"
                    >
                      <option value="changed_desc">Changed</option>
                      <option value="created_desc">Created</option>
                      <option value="priority_desc">Priority</option>
                      <option value="deadline_asc">Due date</option>
                    </select>
                    <Button
                      variant="outline"
                      size="icon"
                    className={`h-8 w-8 border-border-theme bg-white dark:bg-slate-950 ${showListFilters || hasActiveListFilters ? 'bg-slate-100 text-text-dark dark:bg-slate-800 dark:text-slate-100' : 'text-text-light'}`}
                      onClick={() => setShowListFilters((current) => !current)}
                    >
                      <Filter className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
              {showListFilters && (
                <div className="bg-slate-50/75 px-4 py-3 shadow-[inset_0_1px_0_rgba(226,232,240,0.8)] dark:bg-slate-950/80 dark:shadow-[inset_0_1px_0_rgba(30,41,59,0.9)]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-text-light">Filters</span>
                    {hasActiveListFilters && (
                      <button
                        type="button"
                        onClick={() => {
                          setStatusFilter('all');
                          setPriorityFilter('all');
                          setDeadlineFilter('all');
                          setUnassignedOnly(false);
                        }}
                        className="text-[10px] font-semibold text-text-light hover:text-text-dark"
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                  <div className="mt-3 grid gap-3">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-text-light">Status</div>
                      <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as TicketStatus | 'all')}>
                        <SelectTrigger className="mt-2 h-8 w-full bg-white text-xs dark:bg-slate-950 dark:text-slate-100">
                          {statusFilter === 'all' ? (
                            <span>{selectedStatusFilterLabel}</span>
                          ) : (
                            <span className={`status-pill inline-flex rounded-full px-2 py-0.5 text-[10px] ${getStatusClass(statusFilter)}`}>
                              {selectedStatusFilterLabel}
                            </span>
                          )}
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_FILTER_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.value === 'all' ? (
                                option.label
                              ) : (
                                <span className={`status-pill inline-flex rounded-full px-2 py-0.5 text-[10px] ${getStatusClass(option.value)}`}>
                                  {option.label}
                                </span>
                              )}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-text-light">Priority</div>
                      <Select value={priorityFilter} onValueChange={(value) => setPriorityFilter(value as TicketPriority | 'all')}>
                        <SelectTrigger className="mt-2 h-8 w-full bg-white text-xs dark:bg-slate-950 dark:text-slate-100">
                          {priorityFilter === 'all' ? (
                            <span>{selectedPriorityFilterLabel}</span>
                          ) : (
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${getPriorityClass(priorityFilter)}`}>
                              {selectedPriorityFilterLabel}
                            </span>
                          )}
                        </SelectTrigger>
                        <SelectContent>
                          {PRIORITY_FILTER_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.value === 'all' ? (
                                option.label
                              ) : (
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${getPriorityClass(option.value)}`}>
                                  {option.label}
                                </span>
                              )}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-text-light">Due Date</div>
                      <Select value={deadlineFilter} onValueChange={(value) => setDeadlineFilter(value as DeadlineFilter)}>
                        <SelectTrigger className="mt-2 h-8 w-full bg-white text-xs dark:bg-slate-950 dark:text-slate-100">
                          {selectedDeadlineFilterLabel}
                        </SelectTrigger>
                        <SelectContent>
                          {DEADLINE_FILTER_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-text-light">Queue</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {([
                        ['unassigned', 'Unassigned only', unassignedOnly, setUnassignedOnly],
                      ] as const).map(([key, label, active, setter]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setter(!active)}
                          className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                            active
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border-theme bg-white text-text-light hover:text-text-dark'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <ScrollArea className="flex-1 min-h-0">
              {ticketsLoading ? (
                <div className="p-8 text-center text-text-light animate-pulse font-mono text-xs">
                  LOADING...
                </div>
              ) : filteredTickets.length === 0 ? (
                <div className="p-12 text-center">
                  <p className="text-sm text-text-light">No tickets found</p>
                </div>
              ) : (
                <div className="space-y-2 bg-[#f8fafc] px-2 py-2 dark:bg-slate-900">
                  {filteredTickets.map((ticket) => {
                    const deadlineState = getDeadlineState(ticket);
                    const selected = selectedTicketIds.includes(ticket.id);
                    return (
                    <div 
                      key={ticket.id} 
                      className={`group cursor-pointer rounded-xl p-4 shadow-sm transition-all ${
                        selected
                          ? 'bg-[linear-gradient(135deg,#f7fbff_0%,#eef5ff_100%)] ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700 dark:bg-none'
                          : selectedTicket?.id === ticket.id 
                          ? 'bg-[linear-gradient(135deg,#eff6ff_0%,#f8fbff_100%)] ring-1 ring-primary/25 dark:bg-slate-900 dark:ring-primary/35 dark:bg-none' 
                          : 'bg-white/92 hover:bg-slate-50 hover:ring-1 hover:ring-slate-200/80 dark:bg-slate-950 dark:hover:bg-slate-800 dark:hover:ring-primary/20'
                      }`}
                      onClick={() => {
                        if (selectionMode) {
                          toggleTicketSelection(ticket.id);
                          return;
                        }
                        setSelectedTicket(ticket);
                      }}
                    >
                      <div className="flex justify-between text-[10px] text-text-light font-medium mb-1">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            aria-label={selected ? 'Deselect ticket' : 'Select ticket'}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectionMode(true);
                              toggleTicketSelection(ticket.id);
                            }}
                            className={`flex h-4 w-4 items-center justify-center rounded border transition-all ${
                              selected
                                ? 'border-primary bg-primary text-white opacity-100'
                                : selectionMode
                                  ? 'border-slate-300 bg-white text-transparent opacity-100 dark:border-slate-600 dark:bg-slate-950'
                                  : 'border-slate-300 bg-white text-transparent opacity-0 group-hover:opacity-100 dark:border-slate-600 dark:bg-slate-950'
                            }`}
                          >
                            <span className="text-[10px] leading-none">✓</span>
                          </button>
                          <span>#{ticket.id.slice(0, 8).toUpperCase()}</span>
                        </div>
                        <span>{ticket.updatedAt?.toDate ? format(ticket.updatedAt.toDate(), 'HH:mm') : 'Now'}</span>
                      </div>
                      <h3 className="font-semibold text-sm mb-2 line-clamp-1">
                        {ticket.title}
                      </h3>
                      <div className="mb-2 flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${getPriorityClass(ticket.priority)}`}>
                          <span>{getPriorityLabel(ticket.priority)}</span>
                        </span>
                        {deadlineState.kind !== 'none' && (
                          <Badge variant="outline" className={`text-[10px] ${deadlineState.classes}`}>
                            {deadlineState.label}
                          </Badge>
                        )}
                        {ticket.attachments && ticket.attachments.length > 0 && (
                          <span className="text-[10px] text-text-light">{ticket.attachments.length} attachment{ticket.attachments.length === 1 ? '' : 's'}</span>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className={`status-pill ${getStatusClass(ticket.status)}`}>
                          {getStatusLabel(ticket.status)}
                        </Badge>
                        <span className="text-[10px] text-text-light">
                          {ticket.updatedAt?.toDate ? `Changed ${format(ticket.updatedAt.toDate(), 'MMM d')}` : ticket.requesterName}
                        </span>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
              </ScrollArea>
              {selectionMode && (
                <div className="bg-[linear-gradient(180deg,rgba(248,250,252,0.96)_0%,rgba(239,246,255,0.92)_100%)] px-4 py-3 shadow-[inset_0_1px_0_rgba(226,232,240,0.8)] dark:bg-slate-900 dark:bg-none dark:shadow-[inset_0_1px_0_rgba(30,41,59,0.9)]">
                <div className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="font-medium text-text-dark dark:text-slate-100">{selectedTicketIds.length} selected</span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="font-medium text-text-light hover:text-text-dark dark:text-slate-400 dark:hover:text-slate-100"
                      onClick={toggleSelectAllVisible}
                    >
                      Select visible
                    </button>
                    <button
                      type="button"
                      className="font-medium text-text-light hover:text-text-dark disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-100"
                      onClick={() => setSelectedTicketIds([])}
                      disabled={selectedTicketIds.length === 0}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <select
                    value={bulkStatus}
                    onChange={(e) => handleBulkStatusChange(e.target.value as TicketStatus)}
                    className="h-8 min-w-0 flex-1 rounded-md border border-border-theme bg-white px-2 text-[11px] dark:bg-slate-950 dark:text-slate-100"
                    disabled={selectedTicketIds.length === 0 || bulkUpdatingStatus}
                  >
                    <option value="new">New</option>
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="waiting">Waiting</option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 shrink-0 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 disabled:border-border-theme disabled:text-text-light"
                    disabled={selectedTicketIds.length === 0 || bulkDeleting}
                    onClick={handleDeleteSelected}
                    title="Delete selected tickets"
                  >
                    {bulkDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 px-2 text-[11px] text-text-light hover:text-text-dark dark:text-slate-400 dark:hover:text-slate-100"
                    onClick={exitSelectionMode}
                  >
                    Done
                  </Button>
                </div>
                </div>
              )}
            </div>
          </aside>

          {/* Detail Pane */}
          <main className="flex-1 bg-white overflow-hidden flex flex-col dark:bg-slate-950">
            {selectedTicket ? (
              <div key={selectedTicket.id} className="flex-1 flex flex-col overflow-hidden">
                <TicketDetailsDialog 
                  ticket={tickets.find(t => t.id === selectedTicket.id) || selectedTicket} 
                  onClose={() => setSelectedTicket(null)}
                  onTicketDeleted={handleTicketDeleted}
                />
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-text-light p-12 text-center">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                  <TicketIcon className="w-8 h-8 opacity-20" />
                </div>
                <h2 className="text-lg font-bold text-text-dark">Select a ticket to view details</h2>
                <p className="text-sm max-w-xs mt-2">
                  Choose a ticket from the list on the left to see its full history, updates, and management options.
                </p>
              </div>
            )}
          </main>
        </div>
          </>
        )}
      </div>
    </div>
  );
}
