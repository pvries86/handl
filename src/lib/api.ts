import { Attachment, Comment, Requester, Ticket, UserProfile } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const TOKEN_KEY = 'taskflow_user_id';
export const TICKETS_CHANGED_EVENT = 'taskflow:tickets-changed';

export interface LocalUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
}

function timestamp(value: unknown) {
  if (!value) return value;
  const date = new Date(String(value));
  return {
    toDate: () => date,
    seconds: Math.floor(date.getTime() / 1000),
  };
}

function withTimestamps<T extends Record<string, any>>(item: T): T {
  return {
    ...item,
    createdAt: timestamp(item.createdAt),
    updatedAt: timestamp(item.updatedAt),
    deadline: timestamp(item.deadline),
    emailSentAt: timestamp(item.emailSentAt),
    attachments: (item.attachments || []).map((attachment: Attachment) => ({
      ...attachment,
      createdAt: timestamp(attachment.createdAt),
    })),
  };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.set('x-user-id', token);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed with ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json();
}

function notifyTicketsChanged() {
  window.dispatchEvent(new Event(TICKETS_CHANGED_EVENT));
}

export function getStoredUserId() {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearStoredUserId() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function login(email: string, displayName: string) {
  const result = await request<{ user: UserProfile; token: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, displayName }),
  });
  localStorage.setItem(TOKEN_KEY, result.token);
  return result.user;
}

export async function getCurrentUser() {
  const result = await request<{ user: UserProfile | null }>('/api/auth/me');
  return result.user;
}

export async function listAgents() {
  return request<UserProfile[]>('/api/users/agents');
}

export async function listRequesters() {
  return request<Requester[]>('/api/requesters');
}

export async function listUsers() {
  return request<UserProfile[]>('/api/users');
}

export async function updateUser(id: string, updates: Partial<Pick<UserProfile, 'displayName' | 'role' | 'photoURL'>>) {
  return request<UserProfile>(`/api/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function listTickets(filter: string, currentUserId?: string, currentUserEmail?: string, search?: string) {
  const params = new URLSearchParams({ filter });
  if (currentUserId) params.set('currentUserId', currentUserId);
  if (currentUserEmail) params.set('currentUserEmail', currentUserEmail);
  if (search?.trim()) params.set('search', search.trim());
  const tickets = await request<Ticket[]>(`/api/tickets?${params.toString()}`);
  return tickets.map((ticket) => withTimestamps(ticket));
}

export async function createTicket(ticket: Partial<Ticket>) {
  const createdTicket = withTimestamps(await request<Ticket>('/api/tickets', {
    method: 'POST',
    body: JSON.stringify(ticket),
  }));
  notifyTicketsChanged();
  return createdTicket;
}

export async function updateTicket(id: string, updates: Partial<Ticket>) {
  const updatedTicket = withTimestamps(await request<Ticket>(`/api/tickets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  }));
  notifyTicketsChanged();
  return updatedTicket;
}

export async function deleteTicket(id: string) {
  const result = await request<void>(`/api/tickets/${id}`, {
    method: 'DELETE',
  });
  notifyTicketsChanged();
  return result;
}

export async function listComments(ticketId: string) {
  const comments = await request<Comment[]>(`/api/tickets/${ticketId}/comments`);
  return comments.map((comment) => withTimestamps(comment));
}

export async function createComment(ticketId: string, comment: Partial<Comment>) {
  const createdComment = withTimestamps(await request<Comment>(`/api/tickets/${ticketId}/comments`, {
    method: 'POST',
    body: JSON.stringify(comment),
  }));
  notifyTicketsChanged();
  return createdComment;
}

export async function updateComment(ticketId: string, commentId: string, comment: Partial<Comment>) {
  const updatedComment = withTimestamps(await request<Comment>(`/api/tickets/${ticketId}/comments/${commentId}`, {
    method: 'PATCH',
    body: JSON.stringify(comment),
  }));
  notifyTicketsChanged();
  return updatedComment;
}

export async function deleteComment(ticketId: string, commentId: string) {
  const result = await request<void>(`/api/tickets/${ticketId}/comments/${commentId}`, {
    method: 'DELETE',
  });
  notifyTicketsChanged();
  return result;
}

export async function uploadFile(file: File, onProgress?: (progress: number) => void) {
  const form = new FormData();
  form.set('file', file);
  onProgress?.(25);
  const attachment = await request<Attachment>('/api/uploads', {
    method: 'POST',
    body: form,
  });
  onProgress?.(100);
  return withTimestamps(attachment);
}

export async function deleteUploadedFile(attachmentUrl: string) {
  const params = new URLSearchParams({ url: attachmentUrl });
  return request<void>(`/api/uploads?${params.toString()}`, {
    method: 'DELETE',
  });
}

export async function importEmail(ticketId: string, file: File) {
  const form = new FormData();
  form.set('file', file);
  const result = await request<{ ticket: Ticket; comment: Comment | null; attachment: Attachment; parseError?: string }>(
    `/api/tickets/${ticketId}/import-email`,
    {
      method: 'POST',
      body: form,
    },
  );
  notifyTicketsChanged();
  return result;
}

export async function importEmailPreview(file: File, options?: { persistUpload?: boolean }) {
  const form = new FormData();
  form.set('file', file);
  if (options?.persistUpload) {
    form.set('persistUpload', 'true');
  }
  return request<{
    attachment?: Attachment;
    parseError?: string;
    parsedEmail: {
      subject?: string | null;
      from?: string | null;
      sentAt?: string | null;
      body?: string | null;
      parseError?: string | null;
    };
    draft: {
      title: string;
      description: string;
      requesterName: string;
      requesterEmail: string;
    };
  }>('/api/email-import-preview', {
    method: 'POST',
    body: form,
  });
}

export async function deleteAttachment(ticketId: string, attachmentUrl: string) {
  const params = new URLSearchParams({ url: attachmentUrl });
  const ticket = withTimestamps(await request<Ticket>(`/api/tickets/${ticketId}/attachments?${params.toString()}`, {
    method: 'DELETE',
  }));
  notifyTicketsChanged();
  return ticket;
}
