import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { Store } from './store';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = process.env.DATA_DIR || path.join(rootDir, 'data');
const uploadsDir = path.join(dataDir, 'uploads');
const distDir = path.join(rootDir, 'dist');
const port = Number(process.env.PORT || 3000);

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

app.post('/api/tickets/:id/comments', async (req, res, next) => {
  try {
    const comment = await store.createComment({ ...req.body, ticketId: req.params.id });
    res.status(201).json(comment);
  } catch (error) {
    next(error);
  }
});

app.post('/api/uploads', upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  res.status(201).json({
    name: req.file.originalname,
    url: `/uploads/${req.file.filename}`,
    type: req.file.mimetype || 'application/octet-stream',
    size: req.file.size,
    createdAt: new Date().toISOString(),
  });
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
