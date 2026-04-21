import React, { useState } from 'react';
import { Loader2, Paperclip, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../AuthContext';
import { Attachment, TicketPriority } from '../types';
import { createTicket, uploadFile } from '../lib/api';
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
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium' as TicketPriority,
    requesterName: profile?.displayName || '',
    requesterEmail: profile?.email || '',
  });

  const handleFileUpload = async (files: File[]) => {
    setUploading(true);
    setUploadProgress(0);
    const nextAttachments: Attachment[] = [...attachments];

    try {
      for (const file of files) {
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
        tags: [],
        attachments,
      });
      toast.success('Ticket created successfully');
      setOpen(false);
      setAttachments([]);
      setFormData({
        title: '',
        description: '',
        priority: 'medium',
        requesterName: profile?.displayName || '',
        requesterEmail: profile?.email || '',
      });
    } catch (error) {
      console.error('Error creating ticket:', error);
      toast.error('Failed to create ticket');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
              Fill in the details below to log a new support request or task.
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
                <Label htmlFor="requester">Requester Name</Label>
                <Input
                  id="requester"
                  value={formData.requesterName}
                  onChange={(e) => setFormData({ ...formData, requesterName: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Provide as much detail as possible..."
                className="min-h-[120px]"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                required
              />
            </div>

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
                        ×
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
                <p className="text-xs font-medium">Click or drag files here to attach</p>
                <p className="text-[10px] text-slate-400 mt-1">Supports images, PDFs, and reference files</p>
              </div>
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
