import React, { useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { useTickets } from './hooks/useTickets';
import { Ticket, TicketStatus, TicketPriority } from './types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Search, 
  Filter, 
  LogOut, 
  Ticket as TicketIcon, 
  Loader2,
  MailPlus,
  User as UserIcon,
  History
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
  if (!deadline) return { kind: 'none' as const, label: 'No deadline', classes: 'border-slate-200 bg-slate-50 text-slate-500' };

  const now = new Date();
  const todayStart = startOfToday();
  const todayEnd = endOfToday();
  const weekEnd = endOfThisWeek();

  if (deadline < now) {
    return { kind: 'overdue' as const, label: `Overdue ${format(deadline, 'MMM d, HH:mm')}`, classes: 'border-red-200 bg-red-50 text-red-700' };
  }
  if (deadline >= todayStart && deadline < todayEnd) {
    return { kind: 'today' as const, label: `Due today ${format(deadline, 'HH:mm')}`, classes: 'border-amber-200 bg-amber-50 text-amber-700' };
  }
  if (deadline >= todayStart && deadline < weekEnd) {
    return { kind: 'week' as const, label: `This week ${format(deadline, 'EEE HH:mm')}`, classes: 'border-sky-200 bg-sky-50 text-sky-700' };
  }

  return { kind: 'scheduled' as const, label: format(deadline, 'MMM d, HH:mm'), classes: 'border-slate-200 bg-slate-50 text-slate-600' };
}

export default function App() {
  const { user, profile, loading: authLoading, signIn, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showListFilters, setShowListFilters] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<TicketPriority | 'all'>('all');
  const [deadlineFilter, setDeadlineFilter] = useState<DeadlineFilter>('all');
  const [ticketSort, setTicketSort] = useState<TicketSort>('changed_desc');
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [waitingOnly, setWaitingOnly] = useState(false);
  const [creatingFromMail, setCreatingFromMail] = useState(false);
  const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<TicketStatus>('open');
  const [bulkUpdatingStatus, setBulkUpdatingStatus] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginName, setLoginName] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const { tickets, loading: ticketsLoading } = useTickets(activeTab, user?.uid, user?.email || undefined, searchQuery);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);

  const hasActiveListFilters =
    priorityFilter !== 'all' || deadlineFilter !== 'all' || unassignedOnly || waitingOnly;

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
      if (priorityFilter !== 'all' && ticket.priority !== priorityFilter) return false;
      if (unassignedOnly && ticket.assigneeId) return false;
      if (waitingOnly && ticket.status !== 'waiting') return false;

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
  }, [deadlineFilter, priorityFilter, ticketSort, tickets, unassignedOnly, waitingOnly]);

  const allVisibleSelected = filteredTickets.length > 0 && filteredTickets.every((ticket) => selectedTicketIds.includes(ticket.id));
  const bulkMode = selectedTicketIds.length > 0;

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg-main">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-primary/20 rounded-full" />
          <p className="text-sm text-text-light font-mono">INITIALIZING TASKFLOW...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg-main p-4">
        <Card className="w-full max-w-md border-none shadow-2xl bg-white">
          <CardHeader className="text-center space-y-1">
            <div className="mx-auto w-12 h-12 bg-primary rounded-xl flex items-center justify-center mb-4">
              <TicketIcon className="text-white w-6 h-6" />
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">TaskFlow</CardTitle>
            <CardDescription>Professional Ticketing System</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-center text-sm text-text-light">
              Sign in to manage tasks, track updates, and collaborate with your team.
            </p>
            <form
              className="space-y-3"
              onSubmit={async (event) => {
                event.preventDefault();
                setLoginLoading(true);
                try {
                  await signIn(loginEmail, loginName);
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
      if (allVisibleSelected) {
        return current.filter((id) => !filteredTickets.some((ticket) => ticket.id === id));
      }
      const next = new Set(current);
      for (const ticket of filteredTickets) next.add(ticket.id);
      return Array.from(next);
    });
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
      <aside className="w-[220px] bg-sidebar text-white flex flex-col py-6 shrink-0">
        <div className="px-6 mb-8">
          <div className="flex items-center gap-2 text-[#38bdf8] font-extrabold text-xl tracking-tight">
            <TicketIcon className="w-6 h-6" />
            <span>TaskFlow</span>
          </div>
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
            ...(profile?.role === 'admin' ? [{ id: 'users', label: 'Users', icon: UserIcon }] : []),
          ].map((item) => (
            <div 
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`px-6 py-3 flex items-center gap-3 text-sm cursor-pointer border-l-4 transition-all ${
                activeTab === item.id 
                  ? 'bg-white/5 border-primary opacity-100' 
                  : 'border-transparent opacity-60 hover:opacity-100 hover:bg-white/5'
              }`}
            >
              <item.icon className="w-4 h-4" />
              <span>{item.label}</span>
            </div>
          ))}
        </nav>

        <div className="mt-auto px-6 pt-4 border-t border-white/10 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-white/10 overflow-hidden border border-white/20">
              {profile?.photoURL ? (
                <img src={profile.photoURL} alt="Avatar" referrerPolicy="no-referrer" />
              ) : (
                <UserIcon className="w-full h-full p-1.5 text-white/40" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold truncate">{profile?.displayName}</p>
              <p className="text-[10px] text-white/40 uppercase tracking-tighter">{profile?.role}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={logout} className="w-full justify-start text-white/60 hover:text-white hover:bg-white/5 px-0">
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeTab === 'users' ? (
          <UserManagement />
        ) : (
          <>
        <header className="h-16 bg-white border-b border-border-theme flex items-center justify-between px-6 shrink-0">
          <div className="relative w-[300px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-light" />
            <Input 
              placeholder="Search tickets, descriptions, or updates..." 
              className="pl-9 bg-[#f1f5f9] border-border-theme h-9 text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-4">
            <CreateTicketDialog />
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          {/* Ticket List */}
          <aside className="w-[360px] bg-white border-r border-border-theme flex flex-col min-h-0 shrink-0">
            <div
              className={`border-b border-border-theme px-4 py-3 transition-colors ${
                creatingFromMail ? 'bg-slate-50' : 'bg-white'
              }`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const files = Array.from(e.dataTransfer.files) as File[];
                if (files.length > 0) handleInboxImport(files);
              }}
            >
              <button
                type="button"
                className={`flex w-full items-center gap-3 rounded-lg border border-dashed px-3 py-3 text-left transition-colors ${
                  creatingFromMail
                    ? 'border-slate-300 bg-slate-50'
                    : 'border-border-theme bg-[#f8fafc] hover:border-primary/50 hover:bg-slate-50'
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
                  <div className="text-xs font-semibold text-text-dark">New from email</div>
                  <div className="text-[11px] text-text-light">Drop an Outlook mail here to create a ticket straight from the list.</div>
                </div>
              </button>
            </div>
            <div className="border-b border-border-theme bg-white/50">
              <div className="p-4 flex items-center justify-between">
              <span className="font-bold text-sm">Tickets ({filteredTickets.length})</span>
              <div className="flex items-center gap-2">
                <select
                  value={ticketSort}
                  onChange={(e) => setTicketSort(e.target.value as TicketSort)}
                  className="h-8 rounded-md border border-border-theme bg-white px-2 text-[11px] text-text-dark"
                >
                  <option value="changed_desc">Changed</option>
                  <option value="created_desc">Created</option>
                  <option value="priority_desc">Priority</option>
                  <option value="deadline_asc">Deadline</option>
                </select>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-8 w-8 ${showListFilters || hasActiveListFilters ? 'bg-slate-100 text-text-dark' : ''}`}
                  onClick={() => setShowListFilters((current) => !current)}
                >
                  <Filter className="h-4 w-4 text-text-light" />
                </Button>
              </div>
              </div>
              {bulkMode && (
                <div className="border-t border-border-theme px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-[11px] text-text-dark">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAllVisible}
                        className="h-4 w-4"
                      />
                      Select all visible
                    </label>
                    <button
                      type="button"
                      className="text-[11px] font-medium text-text-light hover:text-text-dark"
                      onClick={() => {
                        setSelectedTicketIds([]);
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                    <span className="text-[11px] font-medium text-text-dark">
                      {selectedTicketIds.length} selected
                    </span>
                    <div className="flex items-center gap-2">
                    <select
                      value={bulkStatus}
                      onChange={(e) => handleBulkStatusChange(e.target.value as TicketStatus)}
                      className="h-8 rounded-md border border-border-theme bg-white px-2 text-[11px]"
                      disabled={selectedTicketIds.length === 0 || bulkUpdatingStatus}
                    >
                      <option value="new">New</option>
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="waiting">Waiting</option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                    </select>
                    {bulkUpdatingStatus && (
                      <span className="text-[11px] text-text-light">Updating...</span>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                      disabled={selectedTicketIds.length === 0 || bulkDeleting}
                      onClick={handleDeleteSelected}
                    >
                      {bulkDeleting ? 'Deleting...' : 'Delete Selected'}
                    </Button>
                    </div>
                  </div>
                </div>
              )}
              {showListFilters && (
                <div className="border-t border-border-theme px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-text-light">Filters</span>
                    {hasActiveListFilters && (
                      <button
                        type="button"
                        onClick={() => {
                          setPriorityFilter('all');
                          setDeadlineFilter('all');
                          setUnassignedOnly(false);
                          setWaitingOnly(false);
                        }}
                        className="text-[10px] font-semibold text-text-light hover:text-text-dark"
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                  <div className="mt-3">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-text-light">Priority</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                    {(['all', 'low', 'medium', 'high', 'critical'] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setPriorityFilter(value)}
                        className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                          priorityFilter === value
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border-theme bg-white text-text-light hover:text-text-dark'
                        }`}
                      >
                        {value === 'all' ? 'All priorities' : value}
                      </button>
                    ))}
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-text-light">Deadline</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {([
                        ['all', 'Any deadline'],
                        ['overdue', 'Overdue'],
                        ['today', 'Due today'],
                        ['this_week', 'Due this week'],
                        ['none', 'No deadline'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setDeadlineFilter(value)}
                          className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                            deadlineFilter === value
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border-theme bg-white text-text-light hover:text-text-dark'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-text-light">Queue</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {([
                        ['unassigned', 'Unassigned only', unassignedOnly, setUnassignedOnly],
                        ['waiting', 'Waiting only', waitingOnly, setWaitingOnly],
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
            </div>

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
                <div className="divide-y divide-border-theme">
                  {filteredTickets.map((ticket) => {
                    const deadlineState = getDeadlineState(ticket);
                    const selected = selectedTicketIds.includes(ticket.id);
                    return (
                    <div 
                      key={ticket.id} 
                      className={`group p-4 cursor-pointer transition-all border-r-4 ${
                        selected
                          ? 'bg-slate-50 border-slate-300'
                          : selectedTicket?.id === ticket.id 
                          ? 'bg-[#eff6ff] border-primary' 
                          : 'border-transparent hover:bg-slate-50'
                      }`}
                      onClick={() => setSelectedTicket(ticket)}
                    >
                      <div className="flex justify-between text-[10px] text-text-light font-medium mb-1">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            aria-label={selected ? 'Deselect ticket' : 'Select ticket'}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleTicketSelection(ticket.id);
                            }}
                            className={`flex h-4 w-4 items-center justify-center rounded border transition-all ${
                              selected
                                ? 'border-primary bg-primary text-white opacity-100'
                                : 'border-slate-300 bg-white text-transparent opacity-0 group-hover:opacity-100'
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
                      <div className="mb-2 flex items-center gap-2">
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
                        <Badge variant="outline" className={`status-pill ${
                          ticket.priority === 'critical' || ticket.priority === 'high' ? 'status-urgent' : 
                          ticket.status === 'new' ? 'status-new' : 'status-active'
                        }`}>
                          {ticket.status.replace('_', ' ')}
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
          </aside>

          {/* Detail Pane */}
          <main className="flex-1 bg-white overflow-hidden flex flex-col">
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
