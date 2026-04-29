import React, { useEffect, useMemo, useState } from 'react';
import { endOfMonth, format } from 'date-fns';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
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

const STATUS_OPTIONS: Array<{ value: TicketStatus; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

const PRIORITY_OPTIONS: Array<{ value: TicketPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

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

function toDateInputValue(value?: { toDate?: () => Date } | Date | null) {
  const date = value instanceof Date ? value : value?.toDate ? value.toDate() : null;
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toDeadlineStorageValue(dateValue: string) {
  if (!dateValue) return '';
  const [year, month, day] = dateValue.split('-').map(Number);
  return new Date(year, month - 1, day, 23, 59, 0, 0).toISOString();
}

function getDeadlineTone(ticket: Ticket) {
  const deadline = ticket.deadline?.toDate ? ticket.deadline.toDate() : null;
  if (!deadline) {
    return { label: 'No due date', classes: 'border-slate-200 bg-slate-50 text-slate-500' };
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
    sent: formatMailDate(match[3].trim()),
    body: (match[4] || '').trim(),
  };
}

function formatMailDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : format(date, 'MMM d, yyyy HH:mm');
}

export function TicketDetailsDialog({ ticket, onClose, onTicketDeleted }: TicketDetailsProps) {
  const { agents } = useAgents();
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentOrder, setCommentOrder] = useState<'desc' | 'asc'>('desc');
  const [newComment, setNewComment] = useState('');
  const [deadlineDate, setDeadlineDate] = useState('');
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
  const [editingDetails, setEditingDetails] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState({
    title: ticket.title,
    requesterName: ticket.requesterName || '',
    description: ticket.description || '',
  });

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
  const selectedStatusLabel = useMemo(
    () => STATUS_OPTIONS.find((option) => option.value === ticket.status)?.label || 'Status',
    [ticket.status],
  );
  const savedDeadlineValue = useMemo(() => toDateInputValue(ticket.deadline), [ticket.deadline]);
  const hasDeadline = Boolean(ticket.deadline?.toDate);
  const deadlineTone = useMemo(() => getDeadlineTone(ticket), [ticket]);
  const descriptionEmail = useMemo(
    () => parseEmailStyleDescription(ticket.description || ''),
    [ticket.description],
  );

  useEffect(() => {
    setDeadlineDate(savedDeadlineValue);
  }, [savedDeadlineValue]);

  useEffect(() => {
    if (editingDetails) return;
    setDetailsDraft({
      title: ticket.title,
      requesterName: ticket.requesterName || '',
      description: ticket.description || '',
    });
  }, [editingDetails, ticket.description, ticket.requesterName, ticket.title]);

  useEffect(() => {
    setDescriptionExpanded(false);
  }, [ticket.id, ticket.description]);

  const applyDeadlineDate = async (nextDate: string) => {
    setDeadlineDate(nextDate);
    setSavingDeadline(true);
    try {
      await updateTicket(ticket.id, {
        deadline: nextDate ? toDeadlineStorageValue(nextDate) : null as any,
      });
      toast.success(nextDate ? 'Due date updated' : 'Due date cleared');
    } catch {
      toast.error(nextDate ? 'Failed to update due date' : 'Failed to clear due date');
      setDeadlineDate(savedDeadlineValue);
    } finally {
      setSavingDeadline(false);
    }
  };

  const quickSetDeadline = async (mode: 'today' | 'tomorrow' | 'week' | 'month') => {
    const target = new Date();

    if (mode === 'tomorrow') {
      target.setDate(target.getDate() + 1);
    } else if (mode === 'week') {
      const day = target.getDay();
      const daysUntilFriday = day <= 5 ? 5 - day : 12 - day;
      target.setDate(target.getDate() + daysUntilFriday);
    } else if (mode === 'month') {
      const monthEnd = endOfMonth(target);
      target.setFullYear(monthEnd.getFullYear(), monthEnd.getMonth(), monthEnd.getDate());
    }

    await applyDeadlineDate(toDateInputValue(target));
  };

  const isLongComment = (comment: Comment) => {
    const text = comment.content || '';
    const lines = text.split(/\r?\n/).length;
    return text.length > 280 || lines > 6;
  };

  const isLongText = (text: string) => {
    const lines = text.split(/\r?\n/);
    return text.length > 280 || lines.length > 6;
  };

  const getTextPreview = (text: string) => {
    const lines = text.split(/\r?\n/);
    const firstLines = lines.slice(0, 4).join('\n');
    return firstLines.length > 520 ? `${firstLines.slice(0, 520).trimEnd()}...` : firstLines;
  };

  const getCommentPreview = (comment: Comment) => getTextPreview(comment.content || '');

  const getCommentActorName = (comment: Comment) => {
    if (comment.sourceType !== 'email_import' || !comment.emailFrom) return comment.authorName;

    const angleMatch = comment.emailFrom.match(/^(.*?)(?:<([^>]+)>)$/);
    if (angleMatch) {
      return angleMatch[1].trim().replace(/^"|"$/g, '') || angleMatch[2].trim();
    }

    return comment.emailFrom;
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

  const handleDeadlineClear = async () => {
    await applyDeadlineDate('');
  };

  const handleSaveDetails = async () => {
    const title = detailsDraft.title.trim();
    const requesterName = detailsDraft.requesterName.trim();
    const description = detailsDraft.description.trim();

    if (!title || !requesterName || !description) {
      toast.error('Title, requestor, and description are required');
      return;
    }

    setSavingDetails(true);
    try {
      await updateTicket(ticket.id, {
        title,
        requesterName,
        description,
      });
      setEditingDetails(false);
      toast.success('Ticket details updated');
    } catch {
      toast.error('Failed to update ticket details');
    } finally {
      setSavingDetails(false);
    }
  };

  const handleCancelDetailsEdit = () => {
    setDetailsDraft({
      title: ticket.title,
      requesterName: ticket.requesterName || '',
      description: ticket.description || '',
    });
    setEditingDetails(false);
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

  const handleClipboardPaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) return;
    event.preventDefault();
    await handleFileUpload(files);
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

  const descriptionBody = descriptionEmail ? descriptionEmail.body || 'No message body found.' : ticket.description || '';
  const descriptionIsLong = isLongText(descriptionBody);
  const visibleDescriptionBody = descriptionIsLong && !descriptionExpanded ? getTextPreview(descriptionBody) : descriptionBody;
  const renderDescriptionToggle = () => (
    descriptionIsLong ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-3 h-7 px-2 text-[11px]"
        onClick={() => setDescriptionExpanded((current) => !current)}
      >
        {descriptionExpanded ? 'Collapse description' : 'Show full description'}
      </Button>
    ) : null
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-white dark:bg-slate-950">
      <div className="min-h-[118px] p-8 flex justify-between items-start gap-6 shrink-0">
        <div>
          <div className="text-sm font-medium text-text-light uppercase tracking-wider mb-1">
            TICKET #{ticket.id.slice(0, 8).toUpperCase()}
          </div>
          {editingDetails ? (
            <div className="max-w-[640px] rounded-xl border border-border-theme bg-white px-4 py-3 shadow-sm dark:bg-slate-900">
              <Input
                value={detailsDraft.title}
                onChange={(e) => setDetailsDraft((current) => ({ ...current, title: e.target.value }))}
                className="h-auto border-0 bg-transparent px-0 py-0 text-2xl font-bold text-text-dark shadow-none ring-0 focus-visible:border-0 focus-visible:ring-0"
              />
            </div>
          ) : (
            <h1 className="text-2xl font-bold text-text-dark leading-tight">{ticket.title}</h1>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={(
                  <button
                    type="button"
                    className={`status-pill inline-flex h-8 items-center gap-2 rounded-full px-3 text-[11px] ${getStatusClass(ticket.status)}`}
                  >
                    <span>{selectedStatusLabel}</span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                )}
              />
              <DropdownMenuContent align="start" className="min-w-[180px]">
                {STATUS_OPTIONS.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={() => handleStatusChange(option.value)}
                    className={option.value === ticket.status ? 'bg-accent' : undefined}
                  >
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getStatusClass(option.value)}`}>
                      {option.label}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={(
                  <button
                    type="button"
                    className={`inline-flex h-8 items-center gap-2 rounded-full px-3 text-[11px] font-medium ${getPriorityClass(ticket.priority)}`}
                  >
                    <span>{getPriorityLabel(ticket.priority)}</span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                )}
              />
              <DropdownMenuContent align="start" className="min-w-[180px]">
                {PRIORITY_OPTIONS.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={() => handlePriorityChange(option.value)}
                    className={option.value === ticket.priority ? 'bg-accent' : undefined}
                  >
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getPriorityClass(option.value)}`}>
                      {getPriorityLabel(option.value)}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={(
                  <button
                    type="button"
                    className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[11px] font-medium ${deadlineTone.classes}`}
                  >
                    <span>{hasDeadline ? format(ticket.deadline.toDate(), 'MMM d, yyyy') : 'No due date'}</span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                )}
              />
              <DropdownMenuContent align="start" className="w-[380px] p-3">
                <div className="space-y-3">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-text-light">Due Date</div>
                  <div className="flex flex-nowrap gap-1.5">
                    <button
                      type="button"
                      className="h-7 shrink-0 rounded-md border border-border-theme bg-white px-2 text-[10px] font-medium text-text-dark transition-colors hover:bg-slate-50 disabled:opacity-50 dark:bg-slate-950 dark:hover:bg-slate-900"
                      onClick={() => void quickSetDeadline('today')}
                      disabled={savingDeadline}
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      className="h-7 shrink-0 rounded-md border border-border-theme bg-white px-2 text-[10px] font-medium text-text-dark transition-colors hover:bg-slate-50 disabled:opacity-50 dark:bg-slate-950 dark:hover:bg-slate-900"
                      onClick={() => void quickSetDeadline('tomorrow')}
                      disabled={savingDeadline}
                    >
                      Tomorrow
                    </button>
                    <button
                      type="button"
                      className="h-7 shrink-0 rounded-md border border-border-theme bg-white px-2 text-[10px] font-medium text-text-dark transition-colors hover:bg-slate-50 disabled:opacity-50 dark:bg-slate-950 dark:hover:bg-slate-900"
                      onClick={() => void quickSetDeadline('week')}
                      disabled={savingDeadline}
                    >
                      End of Week
                    </button>
                    <button
                      type="button"
                      className="h-7 shrink-0 rounded-md border border-border-theme bg-white px-2 text-[10px] font-medium text-text-dark transition-colors hover:bg-slate-50 disabled:opacity-50 dark:bg-slate-950 dark:hover:bg-slate-900"
                      onClick={() => void quickSetDeadline('month')}
                      disabled={savingDeadline}
                    >
                      End of Month
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={deadlineDate}
                      onChange={(e) => void applyDeadlineDate(e.target.value)}
                      disabled={savingDeadline}
                      className="h-8 flex-1 rounded-md border border-border-theme bg-white px-2 text-xs outline-none transition-colors focus:border-primary dark:bg-slate-950 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      className="h-8 shrink-0 rounded-md px-2 text-[11px] font-medium text-text-light transition-colors hover:bg-slate-50 hover:text-text-dark disabled:opacity-50"
                      onClick={() => void handleDeadlineClear()}
                      disabled={savingDeadline || (!hasDeadline && !deadlineDate)}
                    >
                      {savingDeadline ? 'Saving...' : 'Clear'}
                    </button>
                  </div>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="mt-3 flex items-center gap-3">
            {editingDetails ? (
              <>
                <Button type="button" size="sm" className="h-8 px-3" onClick={handleSaveDetails} disabled={savingDetails}>
                  {savingDetails ? 'Saving...' : 'Save Details'}
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-8 px-3" onClick={handleCancelDetailsEdit} disabled={savingDetails}>
                  Cancel
                </Button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setEditingDetails(true)}
                className="text-[11px] font-semibold uppercase tracking-widest text-text-light transition-colors hover:text-text-dark"
              >
                Edit Details
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Button
            type="button"
            variant="outline"
            className="h-9 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
            onClick={removeTicket}
            disabled={deletingTicket}
          >
            {deletingTicket ? 'Deleting...' : 'Delete Ticket'}
          </Button>
          <Button
            type="submit"
            form="ticket-update-form"
            className="h-9 bg-primary px-6 font-bold text-white hover:bg-primary/90"
            disabled={loading || uploading || !newComment.trim()}
          >
            {loading ? 'Saving...' : 'Save Update'}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="flex min-h-full w-full max-w-[1400px] flex-col p-8">
          <div className="grid grid-cols-2 gap-6 rounded-xl bg-[linear-gradient(135deg,#f8fbff_0%,#f8fafc_100%)] p-6 shadow-[inset_0_0_0_1px_rgba(226,232,240,0.8)] dark:bg-none dark:bg-slate-900 dark:shadow-[inset_0_0_0_1px_rgba(30,41,59,0.9)]">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-text-light mb-1">Requestor</div>
              {editingDetails ? (
                <div className="max-w-[280px] rounded-lg border border-border-theme bg-white px-3 py-2 shadow-sm dark:bg-slate-950">
                  <Input
                    value={detailsDraft.requesterName}
                    onChange={(e) => setDetailsDraft((current) => ({ ...current, requesterName: e.target.value }))}
                    className="h-auto border-0 bg-transparent px-0 py-0 text-sm font-semibold shadow-none ring-0 focus-visible:border-0 focus-visible:ring-0"
                  />
                </div>
              ) : (
                <div className="text-sm font-semibold">{ticket.requesterName || 'No requester set'}</div>
              )}
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-text-light mb-1">Assigned To</div>
              <Select value={ticket.assigneeId || 'unassigned'} onValueChange={handleAssigneeChange}>
                <SelectTrigger className="h-7 text-xs w-48 bg-white dark:bg-slate-950 dark:text-slate-100">
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
          </div>

          <section className="mt-8">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-text-light mb-3">Description</h4>
            {editingDetails ? (
              <div className="rounded-xl border border-border-theme bg-white p-4 shadow-sm dark:bg-slate-900">
                <Textarea
                  value={detailsDraft.description}
                  onChange={(e) => setDetailsDraft((current) => ({ ...current, description: e.target.value }))}
                  className="min-h-[220px] border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                />
              </div>
            ) : descriptionEmail ? (
              <div className="rounded-lg border border-blue-100 bg-blue-50/70 dark:border-slate-700 dark:bg-slate-900">
                <div className="border-b border-blue-100 px-4 py-3 dark:border-slate-700">
                  <div className="text-sm font-semibold text-text-dark">{descriptionEmail.subject}</div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-light">
                    <span><span className="font-semibold text-text-dark">From:</span> {descriptionEmail.from}</span>
                    <span><span className="font-semibold text-text-dark">Sent:</span> {descriptionEmail.sent}</span>
                  </div>
                </div>
                <div className="px-4 py-3">
                  <div className="whitespace-pre-wrap rounded-md bg-white px-3 py-3 text-sm leading-relaxed text-text-dark dark:bg-slate-950">
                    {visibleDescriptionBody}
                  </div>
                  {renderDescriptionToggle()}
                </div>
              </div>
            ) : (
              <>
                <div className="text-sm text-text-dark leading-relaxed whitespace-pre-wrap">
                  {visibleDescriptionBody}
                </div>
                {renderDescriptionToggle()}
              </>
            )}
          </section>

          <FileViewer file={viewingFile} onClose={() => setViewingFile(null)} />

          <section className="mt-8 flex min-h-[340px] flex-col space-y-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-text-light">Add Update</div>
            <form id="ticket-update-form" onSubmit={handleAddComment} className="flex flex-col space-y-4">
              <Textarea
                placeholder="Add an update..."
                className="min-h-[180px] bg-white border-border-theme rounded-xl p-4 text-sm focus-visible:ring-primary dark:bg-slate-900 dark:text-slate-100"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.altKey && e.key === 'Enter' && newComment.trim() && !loading && !uploading) {
                    e.preventDefault();
                    void handleAddComment(e as unknown as React.FormEvent);
                  }
                }}
                onPaste={(e) => {
                  void handleClipboardPaste(e);
                }}
              />

              <div
                className={`border-2 border-dashed border-border-theme p-6 text-center rounded-xl transition-all cursor-pointer ${
                  uploading ? 'bg-slate-100 border-slate-300 dark:bg-slate-800 dark:border-slate-700' : 'bg-[#fafafa] text-text-light text-sm hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800'
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
            </form>
          </section>

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
            <div className="space-y-4 pl-6 shadow-[-2px_0_0_0_rgba(191,219,254,0.7)] dark:shadow-[-2px_0_0_0_rgba(51,65,85,0.9)]">
              {orderedComments.map((comment) => {
                const collapsed = collapsedComments[comment.id] ?? false;
                const editing = editingCommentId === comment.id;
                const canEdit = comment.sourceType !== 'email_import';
                const isLong = isLongComment(comment);

                return (
                  <div key={comment.id} className="relative rounded-lg bg-[linear-gradient(135deg,rgba(248,250,252,0.82)_0%,rgba(255,255,255,0.96)_100%)] p-3 shadow-[inset_0_0_0_1px_rgba(226,232,240,0.45)] transition-shadow hover:shadow-[inset_0_0_0_1px_rgba(148,163,184,0.4)] dark:bg-none dark:bg-slate-900 dark:shadow-[inset_0_0_0_1px_rgba(51,65,85,0.8)] dark:hover:shadow-[inset_0_0_0_1px_rgba(71,85,105,0.9)]">
                    <div className="absolute -left-[28px] top-4 h-2 w-2 rounded-full bg-sky-200 shadow-[0_0_0_4px_white,0_0_0_7px_rgba(219,234,254,0.9)] dark:bg-sky-300 dark:shadow-[0_0_0_4px_#020617,0_0_0_7px_rgba(56,189,248,0.28)]" />

                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        className="flex-1 min-w-0 text-left"
                        onClick={() => toggleComment(comment.id)}
                      >
                        <div className="flex items-center gap-2 text-[11px] mb-1 flex-wrap">
                          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          <span className="font-bold">{getCommentActorName(comment)}</span>
                          <span className="text-text-light">
                            {comment.createdAt?.toDate ? format(comment.createdAt.toDate(), 'MMM d, HH:mm') : 'Just now'}
                          </span>
                          {comment.sourceType === 'email_import' && (
                            <Badge variant="outline" className="text-[8px] h-4 uppercase tracking-tighter bg-blue-50 text-blue-700 border-blue-200 dark:border-sky-500/30 dark:bg-sky-500/12 dark:text-sky-300">
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

                    <div className="mt-2 space-y-3">
                        {comment.sourceType === 'email_import' && (
                          <div className="rounded-lg border border-blue-100 bg-blue-50/70 dark:border-slate-700 dark:bg-slate-950">
                            <div className="border-b border-blue-100 px-3 py-2 dark:border-slate-700">
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
                              <div className={`whitespace-pre-wrap rounded-md bg-white px-3 py-2 text-sm leading-relaxed text-text-dark dark:bg-slate-950 ${collapsed ? '' : 'max-h-[420px] overflow-auto'}`}>
                                {collapsed ? getCommentPreview(comment) : comment.content}
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
                          <p className="text-sm text-text-dark whitespace-pre-wrap">{collapsed ? getCommentPreview(comment) : comment.content}</p>
                        ) : null}

                        {isLong && !editing && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => toggleComment(comment.id)}
                          >
                            {collapsed ? 'Show full update' : 'Collapse update'}
                          </Button>
                        )}

                        {comment.attachments && comment.attachments.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {comment.attachments.map((attachment) => renderAttachmentChip(attachment))}
                          </div>
                        )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {ticket.attachments && ticket.attachments.length > 0 && (
            <section className="mt-8">
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-text-light mb-3">Attachments</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {ticket.attachments.map((file) => (
                  <div key={file.url} className="flex flex-col gap-2 p-3 bg-white border border-border-theme rounded-lg hover:bg-slate-50 transition-all group dark:bg-slate-900 dark:hover:bg-slate-800">
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
