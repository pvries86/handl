import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ChevronDown, ChevronRight, Loader2, Paperclip, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAgents } from '../hooks/useAgents';
import { Attachment, Comment, Ticket, TicketPriority, TicketStatus } from '../types';
import {
  createComment,
  deleteAttachment,
  deleteComment,
  deleteTicket,
  importEmail,
  listComments,
  updateComment,
  updateTicket,
  uploadFile,
} from '../lib/api';
import { FileViewer } from './FileViewer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface TicketDetailsProps {
  ticket: Ticket;
  onClose: () => void;
  onTicketDeleted?: (ticketId: string) => void;
}

const TEXT_FILE_EXTENSIONS = new Set([
  'txt',
  'log',
  'md',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'xml',
  'yaml',
  'yml',
  'ini',
  'cfg',
  'conf',
  'env',
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'css',
  'scss',
  'html',
  'htm',
  'sql',
  'py',
  'ps1',
  'sh',
  'bat',
  'cmd',
]);

function getFileExtension(name: string) {
  const parts = name.toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() || '' : '';
}

function isTextPreviewable(file: Attachment) {
  const type = file.type.toLowerCase();
  if (
    type.startsWith('text/') ||
    type.includes('json') ||
    type.includes('xml') ||
    type.includes('javascript') ||
    type.includes('typescript') ||
    type.includes('csv')
  ) {
    return true;
  }
  return TEXT_FILE_EXTENSIONS.has(getFileExtension(file.name));
}

function AttachmentInlinePreview({ file, onOpen }: { file: Attachment; onOpen: () => void }) {
  const [textContent, setTextContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileUrl = file.url;
  const fileName = file.name;
  const fileType = file.type;
  const previewable = useMemo(() => isTextPreviewable(file), [fileName, fileType]);

  useEffect(() => {
    if (!previewable) {
      setTextContent('');
      setError('');
      setLoading(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadText = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(file.url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Failed to load file (${response.status})`);
        }
        const content = await response.text();
        if (!cancelled) {
          setTextContent(content.slice(0, 2000));
        }
      } catch (error: any) {
        if (controller.signal.aborted) return;
        if (!cancelled) {
          setTextContent('');
          setError(error?.message || 'Could not load preview.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadText();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [fileUrl, previewable]);

  if (file.type.startsWith('image/')) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="relative aspect-video w-full overflow-hidden rounded border bg-slate-100 text-left transition-opacity hover:opacity-95"
      >
        <img
          src={file.url}
          alt={file.name}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
      </button>
    );
  }

  if (!previewable) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative aspect-video w-full overflow-hidden rounded border bg-slate-50 text-left transition-opacity hover:opacity-95"
    >
      {loading ? (
        <div className="flex h-full items-center justify-center text-[11px] text-text-light">
          Loading preview...
        </div>
      ) : error ? (
        <div className="flex h-full items-center justify-center p-4 text-center text-[10px] text-text-light">
          {error}
        </div>
      ) : (
        <pre className="h-full overflow-auto p-3 text-[10px] leading-relaxed text-text-dark whitespace-pre-wrap break-words font-mono">
          {textContent}
        </pre>
      )}
    </button>
  );
}

function toDateTimeInputValue(value?: { toDate?: () => Date } | null) {
  if (!value?.toDate) return '';
  const date = value.toDate();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function getDeadlineTone(ticket: Ticket) {
  const deadline = ticket.deadline?.toDate ? ticket.deadline.toDate() : null;
  if (!deadline) {
    return { label: 'Open Ended', classes: 'border-slate-200 bg-slate-50 text-slate-500' };
  }

  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const weekEnd = new Date(today);
  const day = today.getDay();
  weekEnd.setDate(today.getDate() + ((7 - day) % 7) + 1);

  if (deadline < now) {
    return { label: 'Overdue', classes: 'border-red-200 bg-red-50 text-red-700' };
  }
  if (deadline >= today && deadline < tomorrow) {
    return { label: 'Due Today', classes: 'border-amber-200 bg-amber-50 text-amber-700' };
  }
  if (deadline >= today && deadline < weekEnd) {
    return { label: 'This Week', classes: 'border-sky-200 bg-sky-50 text-sky-700' };
  }
  return { label: 'Scheduled', classes: 'border-slate-200 bg-slate-50 text-slate-600' };
}

function parseEmailStyleDescription(description: string) {
  const normalized = description.replace(/\r\n/g, '\n');
  const match = normalized.match(
    /^Subject:\s*(.+)\nFrom:\s*(.+)\nSent:\s*(.+?)(?:\n\n([\s\S]*))?$/i,
  );

  if (!match) return null;

  return {
    subject: match[1].trim(),
    from: match[2].trim(),
    sent: match[3].trim(),
    body: (match[4] || '').trim(),
  };
}

export function TicketDetailsDialog({ ticket, onClose, onTicketDeleted }: TicketDetailsProps) {
  const { agents } = useAgents();
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentOrder, setCommentOrder] = useState<'desc' | 'asc'>('desc');
  const [newComment, setNewComment] = useState('');
  const [deadlineValue, setDeadlineValue] = useState('');
  const [savingDeadline, setSavingDeadline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [viewingFile, setViewingFile] = useState<Attachment | null>(null);
  const [collapsedComments, setCollapsedComments] = useState<Record<string, boolean>>({});
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [savingCommentId, setSavingCommentId] = useState<string | null>(null);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [deletingAttachmentUrl, setDeletingAttachmentUrl] = useState<string | null>(null);
  const [deletingTicket, setDeletingTicket] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      listComments(ticket.id)
        .then((items) => {
          if (!cancelled) setComments(items);
        })
        .catch((error) => console.error('Failed to load comments', error));
    };

    load();
    const interval = window.setInterval(load, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [ticket.id]);

  const commentIds = useMemo(() => new Set(comments.map((comment) => comment.id)), [comments]);
  const orderedComments = useMemo(() => {
    const items = [...comments];
    items.sort((a, b) => {
      const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
      const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
      return commentOrder === 'desc' ? bTime - aTime : aTime - bTime;
    });
    return items;
  }, [commentOrder, comments]);
  const assigneeOptions = useMemo(() => {
    const items = [...agents];
    if (
      ticket.assigneeId &&
      ticket.assigneeName &&
      !items.some((agent) => agent.uid === ticket.assigneeId)
    ) {
      items.push({
        uid: ticket.assigneeId,
        email: '',
        displayName: ticket.assigneeName,
        photoURL: '',
        role: 'user',
      });
    }
    return items;
  }, [agents, ticket.assigneeId, ticket.assigneeName]);
  const selectedAssigneeLabel = useMemo(() => {
    if (!ticket.assigneeId) return 'Unassigned';
    return (
      assigneeOptions.find((agent) => agent.uid === ticket.assigneeId)?.displayName ||
      ticket.assigneeName ||
      'Assigned'
    );
  }, [assigneeOptions, ticket.assigneeId, ticket.assigneeName]);
  const savedDeadlineValue = useMemo(() => toDateTimeInputValue(ticket.deadline), [ticket.deadline]);
  const deadlineChanged = deadlineValue !== savedDeadlineValue;
  const hasDeadline = Boolean(ticket.deadline?.toDate);
  const deadlineTone = useMemo(() => getDeadlineTone(ticket), [ticket]);
  const descriptionEmail = useMemo(
    () => parseEmailStyleDescription(ticket.description || ''),
    [ticket.description],
  );

  useEffect(() => {
    setDeadlineValue(savedDeadlineValue);
  }, [savedDeadlineValue]);

  const isLongComment = (comment: Comment) => {
    const text = comment.content || '';
    const lines = text.split(/\r?\n/).length;
    return text.length > 280 || lines > 6;
  };

  useEffect(() => {
    setCollapsedComments((current) => {
      const next: Record<string, boolean> = {};
      for (const comment of comments) {
        if (comment.id in current) {
          next[comment.id] = current[comment.id];
        } else {
          next[comment.id] = isLongComment(comment);
        }
      }
      return next;
    });
  }, [commentIds, comments]);

  const refreshComments = async () => {
    setComments(await listComments(ticket.id));
  };

  const toggleComment = (commentId: string) => {
    setCollapsedComments((current) => ({
      ...current,
      [commentId]: !current[commentId],
    }));
  };

  const handleStatusChange = async (newStatus: TicketStatus) => {
    try {
      await updateTicket(ticket.id, { status: newStatus });
      toast.success(`Status updated to ${newStatus}`);
    } catch {
      toast.error('Failed to update status');
    }
  };

  const handlePriorityChange = async (newPriority: TicketPriority) => {
    try {
      await updateTicket(ticket.id, { priority: newPriority });
      toast.success(`Priority updated to ${newPriority}`);
    } catch {
      toast.error('Failed to update priority');
    }
  };

  const handleAssigneeChange = async (newAssigneeId: string) => {
    if (newAssigneeId === 'unassigned') {
      try {
        await updateTicket(ticket.id, { assigneeId: undefined, assigneeName: undefined });
        toast.success('Ticket unassigned');
      } catch {
        toast.error('Failed to update assignee');
      }
      return;
    }

    const agent = agents.find((item) => item.uid === newAssigneeId);
    if (!agent) return;

    try {
      await updateTicket(ticket.id, {
        assigneeId: agent.uid,
        assigneeName: agent.displayName,
      });
      toast.success(`Ticket assigned to ${agent.displayName}`);
    } catch {
      toast.error('Failed to update assignee');
    }
  };

  const handleDeadlineSave = async () => {
    setSavingDeadline(true);
    try {
      await updateTicket(ticket.id, {
        deadline: deadlineValue ? new Date(deadlineValue).toISOString() : undefined,
      });
      toast.success(deadlineValue ? 'Deadline updated' : 'Deadline cleared');
    } catch {
      toast.error('Failed to update deadline');
    } finally {
      setSavingDeadline(false);
    }
  };

  const handleDeadlineClear = async () => {
    setSavingDeadline(true);
    try {
      setDeadlineValue('');
      await updateTicket(ticket.id, { deadline: null as any });
      toast.success('Deadline cleared');
    } catch {
      toast.error('Failed to clear deadline');
    } finally {
      setSavingDeadline(false);
    }
  };

  const handleFileUpload = async (files: File[]) => {
    setUploading(true);
    setUploadProgress(0);
    const nextTicketAttachments: Attachment[] = [...(ticket.attachments || [])];
    let attachedFiles = 0;
    let importedEmails = 0;

    try {
      for (const file of files) {
        if (file.name.toLowerCase().endsWith('.msg')) {
          const result = await importEmail(ticket.id, file);
          importedEmails += 1;
          if (result.parseError) {
            toast.warning(`Imported ${file.name}, but parsing was limited`);
          } else {
            toast.success(`Imported email from ${file.name}`);
          }
          await refreshComments();
          continue;
        }

        nextTicketAttachments.push(await uploadFile(file, setUploadProgress));
        attachedFiles += 1;
      }

      if (attachedFiles > 0) {
        await updateTicket(ticket.id, {
          attachments: nextTicketAttachments,
        });
        toast.success(
          attachedFiles === 1
            ? 'Attachment saved'
            : `${attachedFiles} attachments saved`,
        );
      }

      if (importedEmails > 0) {
        await refreshComments();
      }
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error(`Failed to upload file: ${error.message || 'Unknown error'}`);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    setLoading(true);
    try {
      await createComment(ticket.id, {
        ticketId: ticket.id,
        content: newComment,
        isInternal: false,
        attachments: [],
        sourceType: 'manual',
      });

      setNewComment('');
      await refreshComments();
      toast.success('Update saved');
    } catch (error: any) {
      console.error('Failed to add update', error);
      toast.error(error?.message || 'Failed to add update');
    } finally {
      setLoading(false);
    }
  };

  const beginEditComment = (comment: Comment) => {
    setEditingCommentId(comment.id);
    setEditingCommentText(comment.content);
    setCollapsedComments((current) => ({ ...current, [comment.id]: false }));
  };

  const saveEditedComment = async (comment: Comment) => {
    setSavingCommentId(comment.id);
    try {
      await updateComment(ticket.id, comment.id, {
        content: editingCommentText,
        isInternal: comment.isInternal,
      });
      setEditingCommentId(null);
      setEditingCommentText('');
      await refreshComments();
      toast.success('Update edited');
    } catch {
      toast.error('Failed to edit update');
    } finally {
      setSavingCommentId(null);
    }
  };

  const removeComment = async (commentId: string) => {
    setDeletingCommentId(commentId);
    try {
      await deleteComment(ticket.id, commentId);
      if (editingCommentId === commentId) {
        setEditingCommentId(null);
        setEditingCommentText('');
      }
      await refreshComments();
      toast.success('Update deleted');
    } catch {
      toast.error('Failed to delete update');
    } finally {
      setDeletingCommentId(null);
    }
  };

  const removeAttachment = async (attachment: Attachment) => {
    setDeletingAttachmentUrl(attachment.url);
    try {
      await deleteAttachment(ticket.id, attachment.url);
      setComments((current) =>
        current.map((comment) => ({
          ...comment,
          attachments: (comment.attachments || []).filter((item) => item.url !== attachment.url),
        })),
      );
      if (viewingFile?.url === attachment.url) {
        setViewingFile(null);
      }
      toast.success(`Deleted ${attachment.name}`);
    } catch {
      toast.error('Failed to delete attachment');
    } finally {
      setDeletingAttachmentUrl(null);
    }
  };

  const removeTicket = async () => {
    const confirmed = window.confirm(`Delete ticket "${ticket.title}"? This removes its updates and attachments too.`);
    if (!confirmed) return;

    setDeletingTicket(true);
    try {
      await deleteTicket(ticket.id);
      toast.success('Ticket deleted');
      onTicketDeleted?.(ticket.id);
      onClose();
    } catch (error: any) {
      console.error('Failed to delete ticket', error);
      toast.error(error?.message || 'Failed to delete ticket');
    } finally {
      setDeletingTicket(false);
    }
  };

  const renderAttachmentChip = (attachment: Attachment) => (
    <div key={attachment.url} className="flex items-center gap-2 bg-slate-100 px-2 py-1 rounded text-[10px] border">
      <button
        type="button"
        onClick={() => setViewingFile(attachment)}
        className="truncate max-w-[120px] hover:text-primary hover:underline"
      >
        {attachment.name}
      </button>
      <button
        type="button"
        onClick={() => removeAttachment(attachment)}
        className="text-red-500 hover:text-red-700"
        disabled={deletingAttachmentUrl === attachment.url}
      >
        {deletingAttachmentUrl === attachment.url ? '...' : 'x'}
      </button>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-white">
      <div className="p-8 border-b border-border-theme flex justify-between items-start gap-6 shrink-0">
        <div>
          <div className="text-sm font-medium text-text-light uppercase tracking-wider mb-1">
            TICKET #{ticket.id.slice(0, 8).toUpperCase()}
          </div>
          <h1 className="text-2xl font-bold text-text-dark leading-tight">{ticket.title}</h1>
        </div>
        <div className="flex items-start gap-3">
          <div className="min-w-[160px]">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-text-light">Status</div>
            <Select value={ticket.status} onValueChange={handleStatusChange}>
              <SelectTrigger className="h-9 text-xs w-40 bg-white">
                <SelectValue placeholder="Change Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="waiting">Waiting</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            type="submit"
            form="ticket-update-form"
            className="mt-[18px] bg-primary px-6 font-bold text-white hover:bg-primary/90"
            disabled={loading || uploading || !newComment.trim()}
          >
            {loading ? 'Saving...' : 'Save Update'}
          </Button>
          <Badge variant="outline" className={`status-pill px-3 py-1 text-xs ${
            ticket.priority === 'critical' || ticket.priority === 'high' ? 'status-urgent' :
            ticket.status === 'new' ? 'status-new' : 'status-active'
          }`}>
            {ticket.status.replace('_', ' ')}
          </Badge>
          <Button
            type="button"
            variant="outline"
            className="mt-[18px] border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
            onClick={removeTicket}
            disabled={deletingTicket}
          >
            {deletingTicket ? 'Deleting...' : 'Delete Ticket'}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="flex min-h-full w-full max-w-[1400px] flex-col p-8">
          <div className="grid grid-cols-2 gap-6 p-6 bg-[#f8fafc] rounded-xl border border-border-theme">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-text-light mb-1">Requestor</div>
              <div className="text-sm font-semibold">{ticket.requesterName || 'No requester set'}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-text-light mb-1">Deadline</div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-text-dark">
                      {hasDeadline ? format(ticket.deadline.toDate(), 'MMM d, yyyy HH:mm') : 'No deadline set'}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={`shrink-0 ${deadlineTone.classes}`}
                  >
                    {deadlineTone.label}
                  </Badge>
                </div>
                <input
                  type="datetime-local"
                  value={deadlineValue}
                  onChange={(e) => setDeadlineValue(e.target.value)}
                  className="h-8 w-full rounded-md border border-border-theme bg-white px-2 text-xs outline-none transition-colors focus:border-primary"
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={handleDeadlineSave}
                    disabled={savingDeadline || !deadlineChanged}
                  >
                    {savingDeadline ? 'Saving...' : 'Save'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={handleDeadlineClear}
                    disabled={savingDeadline || (!hasDeadline && !deadlineValue)}
                  >
                    Clear
                  </Button>
                  {deadlineChanged && (
                    <span className="text-[11px] text-text-light">Unsaved changes</span>
                  )}
                </div>
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-text-light mb-1">Assigned To</div>
              <Select value={ticket.assigneeId || 'unassigned'} onValueChange={handleAssigneeChange}>
                <SelectTrigger className="h-7 text-xs w-48 bg-white">
                  <span className="truncate">{selectedAssigneeLabel}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {assigneeOptions.map((agent) => (
                    <SelectItem key={agent.uid} value={agent.uid}>{agent.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-text-light mb-1">Priority</div>
              <Select value={ticket.priority} onValueChange={handlePriorityChange}>
                <SelectTrigger className="h-7 text-xs w-32 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <section className="mt-8">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-text-light mb-3">Description</h4>
            {descriptionEmail ? (
              <div className="rounded-lg border border-blue-100 bg-blue-50/70">
                <div className="border-b border-blue-100 px-4 py-3">
                  <div className="text-sm font-semibold text-text-dark">{descriptionEmail.subject}</div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-light">
                    <span><span className="font-semibold text-text-dark">From:</span> {descriptionEmail.from}</span>
                    <span><span className="font-semibold text-text-dark">Sent:</span> {descriptionEmail.sent}</span>
                  </div>
                </div>
                <div className="px-4 py-3">
                  <div className="whitespace-pre-wrap rounded-md bg-white px-3 py-3 text-sm leading-relaxed text-text-dark">
                    {descriptionEmail.body || 'No message body found.'}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-text-dark leading-relaxed whitespace-pre-wrap">
                {ticket.description}
              </div>
            )}
          </section>

          <FileViewer file={viewingFile} onClose={() => setViewingFile(null)} />

          <section className="mt-8 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-text-light">Activity Log & Updates</h4>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-[11px]"
                onClick={() => setCommentOrder((current) => (current === 'desc' ? 'asc' : 'desc'))}
              >
                {commentOrder === 'desc' ? 'Newest first' : 'Oldest first'}
              </Button>
            </div>
            <div className="space-y-4 border-l-2 border-border-theme pl-6">
              {orderedComments.map((comment) => {
                const collapsed = collapsedComments[comment.id] ?? false;
                const editing = editingCommentId === comment.id;
                const canEdit = comment.sourceType !== 'email_import';

                return (
                  <div key={comment.id} className="relative rounded-lg border border-transparent p-3 hover:border-border-theme/70">
                    <div className="absolute -left-[31px] top-4 w-2 h-2 rounded-full bg-border-theme border-4 border-white" />

                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        className="flex-1 min-w-0 text-left"
                        onClick={() => toggleComment(comment.id)}
                      >
                        <div className="flex items-center gap-2 text-[11px] mb-1 flex-wrap">
                          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          <span className="font-bold">{comment.authorName}</span>
                          <span className="text-text-light">
                            {comment.createdAt?.toDate ? format(comment.createdAt.toDate(), 'MMM d, HH:mm') : 'Just now'}
                          </span>
                          {comment.sourceType === 'email_import' && (
                            <Badge variant="outline" className="text-[8px] h-4 uppercase tracking-tighter bg-blue-50 text-blue-700 border-blue-200">
                              Imported Email
                            </Badge>
                          )}
                        </div>
                      </button>

                      <div className="flex items-center gap-2 shrink-0">
                        {canEdit && (
                          <Button type="button" variant="ghost" size="icon-sm" onClick={() => beginEditComment(comment)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeComment(comment.id)}
                          disabled={deletingCommentId === comment.id}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-600" />
                        </Button>
                      </div>
                    </div>

                    {!collapsed && (
                      <div className="mt-2 space-y-3">
                        {comment.sourceType === 'email_import' && (
                          <div className="rounded-lg border border-blue-100 bg-blue-50/70">
                            <div className="border-b border-blue-100 px-3 py-2">
                              <div className="text-sm font-semibold text-text-dark">
                                {comment.emailSubject || comment.sourceFileName || 'Imported email'}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-light">
                                {comment.emailFrom && <span><span className="font-semibold text-text-dark">From:</span> {comment.emailFrom}</span>}
                                {comment.emailSentAt?.toDate && (
                                  <span><span className="font-semibold text-text-dark">Sent:</span> {format(comment.emailSentAt.toDate(), 'MMM d, yyyy HH:mm')}</span>
                                )}
                                {comment.sourceFileName && <span><span className="font-semibold text-text-dark">File:</span> {comment.sourceFileName}</span>}
                              </div>
                            </div>
                            <div className="px-3 py-3">
                              <div className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md bg-white px-3 py-2 text-sm leading-relaxed text-text-dark">
                                {comment.content}
                              </div>
                            </div>
                          </div>
                        )}

                        {editing ? (
                          <div className="space-y-2">
                            <Textarea
                              value={editingCommentText}
                              onChange={(e) => setEditingCommentText(e.target.value)}
                              className="min-h-[140px]"
                            />
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                onClick={() => saveEditedComment(comment)}
                                disabled={savingCommentId === comment.id}
                              >
                                {savingCommentId === comment.id ? 'Saving...' : 'Save'}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                  setEditingCommentId(null);
                                  setEditingCommentText('');
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : comment.sourceType !== 'email_import' ? (
                          <p className="text-sm text-text-dark whitespace-pre-wrap">{comment.content}</p>
                        ) : null}

                        {comment.attachments && comment.attachments.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {comment.attachments.map((attachment) => renderAttachmentChip(attachment))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="mt-8 flex flex-1 min-h-[340px] flex-col space-y-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-text-light">Add Update</div>
            <form id="ticket-update-form" onSubmit={handleAddComment} className="flex flex-1 flex-col space-y-4">
              <Textarea
                placeholder="Add an update..."
                className="min-h-[180px] flex-1 bg-white border-border-theme rounded-xl p-4 text-sm focus-visible:ring-primary"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
              />

              <div
                className={`border-2 border-dashed border-border-theme p-6 text-center rounded-xl transition-all cursor-pointer ${
                  uploading ? 'bg-slate-100 border-slate-300' : 'bg-[#fafafa] text-text-light text-sm hover:bg-slate-50'
                }`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const files = Array.from(e.dataTransfer.files) as File[];
                  if (files.length > 0) handleFileUpload(files);
                }}
                onClick={() => {
                  if (uploading) return;
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.multiple = true;
                  input.onchange = (e) => {
                    const files = Array.from((e.target as HTMLInputElement).files || []);
                    if (files.length > 0) handleFileUpload(files);
                  };
                  input.click();
                }}
              >
                {uploading ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    <div className="w-32 h-1 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                    <p className="text-[10px] font-medium text-slate-500">{Math.round(uploadProgress)}%</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p>Drag and drop Outlook emails or attachments here</p>
                    <p className="text-[11px]">Attachments save right away. `.msg` files become searchable updates and stay attached to the ticket.</p>
                  </div>
                )}
              </div>

              <div className="mt-auto flex items-center justify-between">
                <div />
                <Button type="submit" className="bg-primary hover:bg-primary/90 text-white font-bold px-8" disabled={loading || uploading || !newComment.trim()}>
                  Save Update
                </Button>
              </div>
            </form>
          </section>

          {ticket.attachments && ticket.attachments.length > 0 && (
            <section className="mt-8">
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-text-light mb-3">Attachments</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {ticket.attachments.map((file) => (
                  <div key={file.url} className="flex flex-col gap-2 p-3 bg-white border border-border-theme rounded-lg hover:bg-slate-50 transition-all group">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Paperclip className="w-3 h-3 text-text-light shrink-0" />
                        <span className="font-medium text-xs truncate">{file.name}</span>
                      </div>
                      <span className="text-[10px] text-text-light shrink-0">({(file.size / 1024).toFixed(1)} KB)</span>
                    </div>

                    <AttachmentInlinePreview file={file} onOpen={() => setViewingFile(file)} />

                    {file.name.toLowerCase().endsWith('.msg') && (
                      <div className="p-2 bg-amber-50 rounded border border-amber-100 text-[10px] text-amber-700">
                        Outlook email (.msg). The original file stays attached after import for reference.
                      </div>
                    )}

                    <div className="flex gap-2 mt-1">
                      <button
                        onClick={() => setViewingFile(file)}
                        className="text-[10px] font-bold text-primary hover:underline"
                      >
                        View Full
                      </button>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(file.url);
                          toast.success('Link copied to clipboard');
                        }}
                        className="text-[10px] font-bold text-text-light hover:underline"
                      >
                        Copy Link
                      </button>
                      <a
                        href={file.url}
                        download={file.name}
                        className="text-[10px] font-bold text-text-light hover:underline"
                      >
                        Download
                      </a>
                      <button
                        onClick={() => removeAttachment(file)}
                        className="text-[10px] font-bold text-red-600 hover:underline"
                        disabled={deletingAttachmentUrl === file.url}
                      >
                        {deletingAttachmentUrl === file.url ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
