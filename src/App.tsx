import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import { useTickets } from './hooks/useTickets';
import { Ticket, TicketStatus, TicketPriority } from './types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Plus, 
  Search, 
  Filter, 
  LogOut, 
  Ticket as TicketIcon, 
  Clock, 
  AlertCircle,
  CheckCircle2,
  User as UserIcon,
  Mail,
  Calendar as CalendarIcon,
  ChevronRight,
  History
} from 'lucide-react';
import { format } from 'date-fns';
import { CreateTicketDialog } from './components/CreateTicket';
import { TicketDetailsDialog } from './components/TicketDetails';
import { Toaster } from '@/components/ui/sonner';
import { UserManagement } from './components/UserManagement';

const statusColors: Record<TicketStatus, string> = {
  new: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  open: 'bg-green-500/10 text-green-500 border-green-500/20',
  in_progress: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  waiting: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  resolved: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
  closed: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
};

const priorityColors: Record<TicketPriority, string> = {
  low: 'bg-slate-100 text-slate-600',
  medium: 'bg-blue-100 text-blue-600',
  high: 'bg-orange-100 text-orange-600',
  critical: 'bg-red-100 text-red-600',
};

export default function App() {
  const { user, profile, loading: authLoading, signIn, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginName, setLoginName] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const { tickets, loading: ticketsLoading } = useTickets(activeTab, user?.uid, user?.email || undefined, searchQuery);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);

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

  const filteredTickets = tickets;

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
            { id: 'all', label: 'All Open Tickets', icon: TicketIcon },
            { id: 'assigned', label: 'Assigned to Me', icon: UserIcon },
            { id: 'archived', label: 'Archived Tasks', icon: History },
            { id: 'requesters', label: 'Requesters', icon: Mail },
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
            <div className="p-4 border-b border-border-theme flex items-center justify-between bg-white/50">
              <span className="font-bold text-sm">Tickets ({filteredTickets.length})</span>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Filter className="h-4 w-4 text-text-light" />
                </Button>
              </div>
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
                  {filteredTickets.map((ticket) => (
                    <div 
                      key={ticket.id} 
                      className={`p-4 cursor-pointer transition-all border-r-4 ${
                        selectedTicket?.id === ticket.id 
                          ? 'bg-[#eff6ff] border-primary' 
                          : 'border-transparent hover:bg-slate-50'
                      }`}
                      onClick={() => setSelectedTicket(ticket)}
                    >
                      <div className="flex justify-between text-[10px] text-text-light font-medium mb-1">
                        <span>#{ticket.id.slice(0, 8).toUpperCase()}</span>
                        <span>{ticket.createdAt?.toDate ? format(ticket.createdAt.toDate(), 'HH:mm') : 'Now'}</span>
                      </div>
                      <h3 className="font-semibold text-sm mb-2 line-clamp-1">
                        {ticket.title}
                      </h3>
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className={`status-pill ${
                          ticket.priority === 'critical' || ticket.priority === 'high' ? 'status-urgent' : 
                          ticket.status === 'new' ? 'status-new' : 'status-active'
                        }`}>
                          {ticket.status.replace('_', ' ')}
                        </Badge>
                        <span className="text-[10px] text-text-light">{ticket.requesterName}</span>
                      </div>
                    </div>
                  ))}
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
