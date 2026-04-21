export type TicketStatus = 'new' | 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Attachment {
  name: string;
  url: string;
  type: string;
  size: number;
  createdAt: any;
}

export interface Ticket {
  id: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  requesterEmail: string;
  requesterName: string;
  assigneeId?: string;
  assigneeName?: string;
  deadline?: any;
  createdAt: any;
  updatedAt: any;
  tags: string[];
  attachments?: Attachment[];
}

export interface Comment {
  id: string;
  ticketId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: any;
  isInternal: boolean;
  attachments?: Attachment[];
  sourceType?: 'manual' | 'email_import';
  sourceFileName?: string;
  emailSubject?: string;
  emailFrom?: string;
  emailSentAt?: any;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: 'admin' | 'agent' | 'user';
}
