import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import MsgReader from '@kenjiuno/msgreader';
import { Store } from './store';
import type { Attachment } from '../src/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = process.env.DATA_DIR || path.join(rootDir, 'data');
const uploadsDir = path.join(dataDir, 'uploads');
const distDir = path.join(rootDir, 'dist');
const port = Number(process.env.PORT || 3000);
const pythonBin = process.env.PYTHON_BIN || 'python';

fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
const store = new Store();

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}_${safeName}`);
    },
  }),
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024),
  },
});

app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(uploadsDir));

async function getRequestUser(req: express.Request) {
  const uid = String(req.header('x-user-id') || '');
  return uid ? store.getUser(uid) : null;
}

async function requireUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const user = await getRequestUser(req);
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    res.locals.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

async function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const user = await getRequestUser(req);
    if (!user || user.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    res.locals.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

function createAttachmentFromUpload(file: Express.Multer.File): Attachment {
  return {
    name: file.originalname,
    url: `/uploads/${file.filename}`,
    type: file.mimetype || 'application/octet-stream',
    size: file.size,
    createdAt: new Date().toISOString(),
  };
}

function normalizeEmailBody(body: unknown) {
  if (typeof body !== 'string') return '';
  return body.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function parseMsgFileJs(buffer: Buffer) {
  const parsed = new MsgReader(buffer).getFileData();
  if ((parsed as any).error) {
    throw new Error(String((parsed as any).error));
  }
  return {
    subject: parsed.subject || null,
    from: parsed.senderEmail || parsed.senderName || null,
    sentAt: parsed.messageDeliveryTime || parsed.clientSubmitTime || parsed.creationTime || null,
    body: normalizeEmailBody(parsed.body),
  };
}

function parseMsgFilePython(filePath: string) {
  const scriptPath = path.join(rootDir, 'server', 'msg_parser.py');
  const result = spawnSync(pythonBin, [scriptPath, filePath], {
    encoding: 'utf-8',
    timeout: 30000,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || `Python parser failed with exit code ${result.status}`);
  }

  const payload = JSON.parse(result.stdout);
  return {
    subject: payload.subject || null,
    from: payload.from || null,
    sentAt: payload.sentAt || null,
    body: normalizeEmailBody(payload.body),
  };
}

function parseMsgFile(filePath: string) {
  const errors: string[] = [];

  try {
    return parseMsgFilePython(filePath);
  } catch (error) {
    errors.push(`python: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    return parseMsgFileJs(fs.readFileSync(filePath));
  } catch (error) {
    errors.push(`js: ${error instanceof Error ? error.message : String(error)}`);
  }

  throw new Error(errors.join(' | '));
}

function extractEmailIdentity(from: string | null | undefined) {
  if (!from) {
    return { name: '', email: '' };
  }

  const trimmed = from.trim();
  const angleMatch = trimmed.match(/^(.*?)(?:<([^>]+)>)$/);
  if (angleMatch) {
    return {
      name: angleMatch[1].trim().replace(/^"|"$/g, ''),
      email: angleMatch[2].trim(),
    };
  }

  const emailMatch = trimmed.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (emailMatch) {
    const email = emailMatch[0];
    const name = trimmed.replace(email, '').replace(/[()<>"]/g, '').trim();
    return { name, email };
  }

  return { name: trimmed, email: '' };
}

function buildImportedEmailDescription(email: {
  subject?: string | null;
  from?: string | null;
  sentAt?: string | null;
  body?: string | null;
  parseError?: string | null;
}) {
  const lines: string[] = [];
  if (email.subject) lines.push(`Subject: ${email.subject}`);
  if (email.from) lines.push(`From: ${email.from}`);
  if (email.sentAt) lines.push(`Sent: ${email.sentAt}`);
  if (email.body?.trim()) {
    if (lines.length > 0) lines.push('');
    lines.push(email.body.trim());
  } else if (email.parseError) {
    if (lines.length > 0) lines.push('');
    lines.push('Parsing unavailable for this imported Outlook email. The original .msg file is attached for reference.');
  }
  return lines.join('\n');
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const user = await store.getOrCreateUser(req.body.email, req.body.displayName);
    res.json({ user, token: user.uid });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me', async (req, res, next) => {
  try {
    const uid = String(req.header('x-user-id') || '');
    const user = uid ? await store.getUser(uid) : null;
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

app.get('/api/users/agents', async (_req, res, next) => {
  try {
    res.json(await store.listAgents());
  } catch (error) {
    next(error);
  }
});

app.get('/api/requesters', async (_req, res, next) => {
  try {
    res.json(await store.listRequesters());
  } catch (error) {
    next(error);
  }
});

app.get('/api/users', requireAdmin, async (_req, res, next) => {
  try {
    res.json(await store.listUsers());
  } catch (error) {
    next(error);
  }
});

app.patch('/api/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const role = req.body.role;
    if (role && !['admin', 'agent', 'user'].includes(role)) {
      res.status(400).json({ error: 'Invalid role' });
      return;
    }

    const user = await store.updateUser(req.params.id, {
      displayName: req.body.displayName,
      role,
      photoURL: req.body.photoURL,
    });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  } catch (error) {
    next(error);
  }
});

app.get('/api/tickets', async (req, res, next) => {
  try {
    const tickets = await store.listTickets(
      String(req.query.filter || 'all'),
      req.query.currentUserId ? String(req.query.currentUserId) : undefined,
      req.query.currentUserEmail ? String(req.query.currentUserEmail) : undefined,
      req.query.search ? String(req.query.search) : undefined,
    );
    res.json(tickets);
  } catch (error) {
    next(error);
  }
});

app.post('/api/tickets', async (req, res, next) => {
  try {
    res.status(201).json(await store.createTicket(req.body));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/tickets/:id', async (req, res, next) => {
  try {
    const ticket = await store.updateTicket(req.params.id, req.body);
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    res.json(ticket);
  } catch (error) {
    next(error);
  }
});

app.get('/api/tickets/:id/comments', async (req, res, next) => {
  try {
    res.json(await store.listComments(req.params.id));
  } catch (error) {
    next(error);
  }
});

app.post('/api/tickets/:id/comments', requireUser, async (req, res, next) => {
  try {
    const comment = await store.createComment({
      ...req.body,
      ticketId: req.params.id,
      authorId: res.locals.user.uid,
      authorName: res.locals.user.displayName,
    });
    res.status(201).json(comment);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/tickets/:ticketId/comments/:commentId', async (req, res, next) => {
  try {
    const comment = await store.updateComment(req.params.ticketId, req.params.commentId, {
      content: req.body.content,
      isInternal: req.body.isInternal,
    });
    if (!comment) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }
    res.json(comment);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/tickets/:ticketId/comments/:commentId', async (req, res, next) => {
  try {
    const deleted = await store.deleteComment(req.params.ticketId, req.params.commentId);
    if (!deleted) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post('/api/tickets/:id/import-email', requireUser, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }
    if (!req.file.originalname.toLowerCase().endsWith('.msg')) {
      res.status(400).json({ error: 'Only Outlook .msg files can be imported as email' });
      return;
    }

    const attachment = createAttachmentFromUpload(req.file);
    let parsedEmail: { subject?: string | null; from?: string | null; sentAt?: string | null; body?: string | null; parseError?: string | null };

    try {
      parsedEmail = parseMsgFile(req.file.path);
    } catch (error) {
      console.error('MSG parse failed:', error);
      parsedEmail = {
        body: '',
        parseError: error instanceof Error ? error.message : 'Unable to parse Outlook email',
      };
    }

    const result = await store.importEmailToTicket(req.params.id, res.locals.user, attachment, parsedEmail);
    if (!result) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/email-import-preview', requireUser, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }
    if (!req.file.originalname.toLowerCase().endsWith('.msg')) {
      res.status(400).json({ error: 'Only Outlook .msg files can be imported as email' });
      return;
    }

    const attachment = createAttachmentFromUpload(req.file);
    let parsedEmail: {
      subject?: string | null;
      from?: string | null;
      sentAt?: string | null;
      body?: string | null;
      parseError?: string | null;
    };

    try {
      parsedEmail = parseMsgFile(req.file.path);
    } catch (error) {
      console.error('MSG preview parse failed:', error);
      parsedEmail = {
        body: '',
        parseError: error instanceof Error ? error.message : 'Unable to parse Outlook email',
      };
    }

    const requester = extractEmailIdentity(parsedEmail.from);
    res.status(201).json({
      attachment,
      parseError: parsedEmail.parseError || undefined,
      parsedEmail,
      draft: {
        title: parsedEmail.subject || '',
        description: buildImportedEmailDescription(parsedEmail),
        requesterName: requester.name || requester.email || '',
        requesterEmail: requester.email,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/uploads', upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  res.status(201).json(createAttachmentFromUpload(req.file));
});

app.delete('/api/tickets/:ticketId/attachments', async (req, res, next) => {
  try {
    const attachmentUrl = String(req.query.url || '');
    if (!attachmentUrl) {
      res.status(400).json({ error: 'Attachment URL is required' });
      return;
    }

    const ticket = await store.deleteAttachment(req.params.ticketId, attachmentUrl);
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }

    const uploadsPrefix = '/uploads/';
    if (attachmentUrl.startsWith(uploadsPrefix)) {
      const fileName = attachmentUrl.slice(uploadsPrefix.length);
      const filePath = path.join(uploadsDir, fileName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    res.json(ticket);
  } catch (error) {
    next(error);
  }
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  res.status(500).json({ error: message });
});

await store.init();

app.listen(port, () => {
  console.log(`TaskFlow listening on http://0.0.0.0:${port}`);
  console.log(process.env.DATABASE_URL ? 'Using Postgres database' : `Using SQLite database in ${dataDir}`);
});
