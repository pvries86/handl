import React, { useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, File as FileIcon, FileText } from 'lucide-react';
import { Attachment } from '../types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface FileViewerProps {
  file: Attachment | null;
  onClose: () => void;
}

const TEXT_FILE_EXTENSIONS = new Set([
  'txt',
  'log',
  'md',
  'csv',
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

function isTextPreviewable(file: Attachment | null) {
  if (!file) return false;
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

export function FileViewer({ file, onClose }: FileViewerProps) {
  const [textContent, setTextContent] = useState('');
  const [loadingText, setLoadingText] = useState(false);
  const [textError, setTextError] = useState('');
  const fileUrl = file?.url || '';
  const fileName = file?.name || '';
  const fileType = file?.type || '';
  const isTextFile = useMemo(() => isTextPreviewable(file), [fileName, fileType]);

  useEffect(() => {
    if (!file || !isTextFile) {
      setTextContent('');
      setTextError('');
      setLoadingText(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadText = async () => {
      setLoadingText(true);
      setTextError('');
      try {
        const response = await fetch(file.url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Failed to load file (${response.status})`);
        }
        const content = await response.text();
        if (!cancelled) {
          setTextContent(content);
        }
      } catch (error: any) {
        if (controller.signal.aborted) return;
        if (!cancelled) {
          setTextContent('');
          setTextError(error?.message || 'Could not preview this text file.');
        }
      } finally {
        if (!cancelled) {
          setLoadingText(false);
        }
      }
    };

    void loadText();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [fileUrl, isTextFile]);

  if (!file) return null;

  const isImage = file.type.startsWith('image/');
  const isPDF = file.type === 'application/pdf';

  return (
    <Dialog open={!!file} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 overflow-hidden border-none shadow-2xl">
        <DialogHeader className="p-4 border-b bg-white shrink-0 flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-slate-100 rounded">
              {isImage ? <FileIcon className="w-4 h-4 text-blue-500" /> : <FileText className="w-4 h-4 text-orange-500" />}
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-sm font-bold truncate">{file.name}</DialogTitle>
              <p className="text-[10px] text-text-light">{(file.size / 1024).toFixed(1)} KB - {file.type}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild className="h-8 text-[10px] font-bold">
              <a href={file.url} download={file.name}>
                <Download className="w-3 h-3 mr-1" /> Download
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild className="h-8 text-[10px] font-bold">
              <a href={file.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3 h-3 mr-1" /> Open Original
              </a>
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 bg-slate-50 overflow-auto flex items-center justify-center p-8">
          {isImage ? (
            <img
              src={file.url}
              alt={file.name}
              className="max-w-full max-h-full object-contain shadow-lg rounded-lg bg-white"
              referrerPolicy="no-referrer"
            />
          ) : isPDF ? (
            <iframe
              src={`${file.url}#toolbar=0`}
              className="w-full h-full border-none rounded-lg shadow-lg bg-white"
              title={file.name}
            />
          ) : isTextFile ? (
            <div className="h-full w-full overflow-hidden rounded-lg border bg-white shadow-lg">
              {loadingText ? (
                <div className="flex h-full items-center justify-center text-sm text-text-light">
                  Loading preview...
                </div>
              ) : textError ? (
                <div className="flex h-full items-center justify-center p-8">
                  <div className="max-w-md text-center">
                    <h3 className="font-bold text-text-dark">Preview unavailable</h3>
                    <p className="mt-2 text-xs text-text-light">{textError}</p>
                  </div>
                </div>
              ) : (
                <pre className="h-full overflow-auto p-4 text-xs leading-relaxed text-text-dark whitespace-pre-wrap break-words font-mono">
                  {textContent}
                </pre>
              )}
            </div>
          ) : (
            <div className="text-center p-12 bg-white rounded-2xl shadow-sm border max-w-sm">
              <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-slate-300" />
              </div>
              <h3 className="font-bold text-text-dark mb-2">Preview not available</h3>
              <p className="text-xs text-text-light mb-6">
                This file type ({file.type}) cannot be previewed directly in the browser.
                Please download it to view the content.
              </p>
              <Button asChild className="w-full">
                <a href={file.url} download={file.name}>
                  Download File
                </a>
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
