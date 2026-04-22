import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Paperclip, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../AuthContext';
import { Attachment, Requester, TicketPriority } from '../types';
import { createTicket, importEmailPreview, listRequesters, uploadFile } from '../lib/api';
import { FileViewer } from './FileViewer';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export function CreateTicketDialog() {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [viewingFile, setViewingFile] = useState<Attachment | null>(null);
  const [requesters, setRequesters] = useState<Requester[]>([]);
  const [importedEmailCount, setImportedEmailCount] = useState(0);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium' as TicketPriority,
    requesterName: '',
    requesterEmail: '',
  });

  const resetForm = () => {
    setAttachments([]);
    setViewingFile(null);
    setImportedEmailCount(0);
    setFormData({
      title: '',
      description: '',
      priority: 'medium',
      requesterName: '',
      requesterEmail: '',
    });
  };

  useEffect(() => {
    let cancelled = false;
    listRequesters()
      .then((items) => {
        if (!cancelled) setRequesters(items);
      })
      .catch((error) => console.error('Failed to load requesters', error));
    return () => {
      cancelled = true;
    };
  }, []);

  const requesterOptions = useMemo(() => {
    const seen = new Set<string>();
    return requesters.filter((requester) => {
      const key = requester.requesterName.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [requesters]);

  const applyImportedDraft = (draft: {
    title: string;
    description: string;
    requesterName: string;
    requesterEmail: string;
  }) => {
    setFormData((current) => ({
      ...current,
      title: current.title.trim() ? current.title : draft.title,
      description: current.description.trim() ? current.description : draft.description,
      requesterName: current.requesterName.trim() ? current.requesterName : draft.requesterName,
      requesterEmail: current.requesterEmail,
    }));
  };

  const handleFileUpload = async (files: File[]) => {
    setUploading(true);
    setUploadProgress(0);
    const nextAttachments: Attachment[] = [...attachments];

    try {
      for (const file of files) {
        if (file.name.toLowerCase().endsWith('.msg')) {
          const result = await importEmailPreview(file, { persistUpload: true });
          if (result.attachment) {
            nextAttachments.push(result.attachment);
          }
          applyImportedDraft(result.draft);
          setImportedEmailCount((count) => count + 1);
          if (result.parseError) {
            toast.warning(`Imported ${file.name}, but parsing was limited`);
          } else {
            toast.success(`Imported ${file.name} into the new ticket`);
          }
          continue;
        }

        nextAttachments.push(await uploadFile(file, setUploadProgress));
        toast.success(`Uploaded ${file.name}`);
      }
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error(`Failed to upload file: ${error.message || 'Unknown error'}`);
    } finally {
      setAttachments(nextAttachments);
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.description) {
      toast.error('Please fill in all required fields');
      return;
    }

    setLoading(true);
    try {
      await createTicket({
        ...formData,
        requesterEmail: '',
        createdById: profile?.uid,
        createdByName: profile?.displayName,
        tags: [],
        attachments,
      });
      setRequesters((current) => {
        const name = formData.requesterName.trim();
        if (!name || current.some((item) => item.requesterName.toLowerCase() === name.toLowerCase())) {
          return current;
        }
        return [...current, { requesterName: name, requesterEmail: '' }].sort((a, b) =>
          a.requesterName.localeCompare(b.requesterName),
        );
      });
      toast.success('Ticket created successfully');
      setOpen(false);
      resetForm();
    } catch (error) {
      console.error('Error creating ticket:', error);
      toast.error('Failed to create ticket');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="w-4 h-4" />
          New Ticket
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create New Ticket</DialogTitle>
            <DialogDescription>
              Drop in an Outlook email to prefill the ticket, or enter the details manually.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                placeholder="Brief summary of the issue"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="priority">Priority</Label>
                <Select
                  value={formData.priority}
                  onValueChange={(value: TicketPriority) => setFormData({ ...formData, priority: value })}
                >
                  <SelectTrigger id="priority">
                    <SelectValue placeholder="Select priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="requester">Requester</Label>
                <Input
                  id="requester"
                  list="requester-options"
                  placeholder="Type a name or pick a saved requester"
                  value={formData.requesterName}
                  required
                  onChange={(e) => {
                    const requesterName = e.target.value;
                    const matched = requesterOptions.find((item) => item.requesterName.toLowerCase() === requesterName.toLowerCase());
                    setFormData({
                      ...formData,
                      requesterName,
                      requesterEmail: matched ? '' : formData.requesterEmail,
                    });
                  }}
                />
                <datalist id="requester-options">
                  {requesterOptions.map((requester) => (
                    <option
                      key={requester.requesterName}
                      value={requester.requesterName}
                    />
                  ))}
                </datalist>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Add the ticket summary, or import an Outlook email to prefill it..."
                className="min-h-[120px]"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                required
              />
            </div>

            {importedEmailCount > 0 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-700">
                Imported email {importedEmailCount === 1 ? 'attached and used to prefill this ticket.' : 'files attached and used to prefill this ticket where fields were still empty.'}
              </div>
            )}

            {attachments.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs">Attachments</Label>
                <div className="flex flex-wrap gap-2">
                  {attachments.map((file, i) => (
                    <div key={i} className="flex items-center gap-2 bg-slate-100 px-2 py-1 rounded text-[10px] border group">
                      <button
                        type="button"
                        onClick={() => setViewingFile(file)}
                        className="truncate max-w-[100px] hover:text-primary hover:underline"
                      >
                        {file.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAttachments(attachments.filter((_, idx) => idx !== i))}
                        className="text-red-500 hover:text-red-700 font-bold"
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <FileViewer file={viewingFile} onClose={() => setViewingFile(null)} />

            <div
              className={`flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed rounded-lg transition-colors cursor-pointer ${
                uploading ? 'bg-slate-100 border-slate-300' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
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
                <Paperclip className="w-6 h-6 text-slate-400" />
              )}
              <div className="text-center">
                <p className="text-xs font-medium">Drop an Outlook email here to start the ticket</p>
                <p className="mt-1 text-[10px] text-slate-400">`.msg` files prefill the ticket and stay attached. Other files are added as attachments.</p>
              </div>
            </div>
            <div className="flex justify-start">
              <Button
                type="button"
                variant="outline"
                disabled={uploading}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.msg';
                  input.onchange = (e) => {
                    const files = Array.from((e.target as HTMLInputElement).files || []);
                    if (files.length > 0) handleFileUpload(files);
                  };
                  input.click();
                }}
              >
                Import Email (.msg)
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || uploading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Ticket
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
