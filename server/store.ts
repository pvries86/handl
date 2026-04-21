import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { nanoid } from 'nanoid';
import type { Attachment, Comment, Requester, Ticket, TicketPriority, UserProfile } from '../src/types';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof import('better-sqlite3');
const { Pool } = require('pg') as typeof import('pg');

export interface NewTicketInput {
  title: string;
  description: string;
  priority: TicketPriority;
  requesterName: string;
  requesterEmail: string;
  createdById?: string;
  createdByName?: string;
  attachments?: unknown[];
}

export interface NewCommentInput {
  ticketId: string;
  authorId: string;
  authorName: string;
  content: string;
  isInternal: boolean;
  attachments?: unknown[];
  sourceType?: 'manual' | 'email_import';
  sourceFileName?: string;
  emailSubject?: string;
  emailFrom?: string;
  emailSentAt?: string | null;
}

export interface UpdateCommentInput {
  content?: string;
  isInternal?: boolean;
}

type SqliteDatabase = import('better-sqlite3').Database;
type PgPool = import('pg').Pool;

const defaultDataDir = path.resolve(process.cwd(), 'data');

function json(value: unknown) {
  return JSON.stringify(value ?? []);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value as T;
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function now() {
  return new Date().toISOString();
}

function toSqlLike(value: string) {
  return `%${value.replace(/[%_]/g, '\\$&').toLowerCase()}%`;
}

function adminEmails() {
  return (process.env.ADMIN_EMAILS || 'paulvries@gmail.com')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export class Store {
  private sqlite?: SqliteDatabase;
  private pg?: PgPool;

  constructor() {
    if (process.env.DATABASE_URL) {
      this.pg = new Pool({ connectionString: process.env.DATABASE_URL });
      return;
    }

    const dataDir = process.env.DATA_DIR || defaultDataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    this.sqlite = new Database(path.join(dataDir, 'taskflow.sqlite'));
    this.sqlite.pragma('journal_mode = WAL');
  }

  async init() {
    if (this.pg) {
      await this.pg.query(`
        CREATE TABLE IF NOT EXISTS users (
          uid TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          display_name TEXT NOT NULL,
          photo_url TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL DEFAULT 'user',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS tickets (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          status TEXT NOT NULL,
          priority TEXT NOT NULL,
          requester_email TEXT NOT NULL,
          requester_name TEXT NOT NULL,
          created_by_id TEXT,
          created_by_name TEXT,
          assignee_id TEXT,
          assignee_name TEXT,
          deadline TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL,
          tags JSONB NOT NULL DEFAULT '[]'::jsonb,
          attachments JSONB NOT NULL DEFAULT '[]'::jsonb
        );

        CREATE TABLE IF NOT EXISTS comments (
          id TEXT PRIMARY KEY,
          ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
          author_id TEXT NOT NULL,
          author_name TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL,
          is_internal BOOLEAN NOT NULL DEFAULT false,
          attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
          source_type TEXT NOT NULL DEFAULT 'manual',
          source_file_name TEXT,
          email_subject TEXT,
          email_from TEXT,
          email_sent_at TIMESTAMPTZ
        );

        ALTER TABLE comments ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual';
        ALTER TABLE comments ADD COLUMN IF NOT EXISTS source_file_name TEXT;
        ALTER TABLE comments ADD COLUMN IF NOT EXISTS email_subject TEXT;
        ALTER TABLE comments ADD COLUMN IF NOT EXISTS email_from TEXT;
        ALTER TABLE comments ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ;
      `);
      return;
    }

    this.sqlite!.exec(`
      CREATE TABLE IF NOT EXISTS users (
        uid TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        photo_url TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        requester_email TEXT NOT NULL,
        requester_name TEXT NOT NULL,
        created_by_id TEXT,
        created_by_name TEXT,
        assignee_id TEXT,
        assignee_name TEXT,
        deadline TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        attachments TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        is_internal INTEGER NOT NULL DEFAULT 0,
        attachments TEXT NOT NULL DEFAULT '[]',
        source_type TEXT NOT NULL DEFAULT 'manual',
        source_file_name TEXT,
        email_subject TEXT,
        email_from TEXT,
        email_sent_at TEXT,
        FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
      );
    `);

    this.ensureSqliteColumn('comments', 'source_type', "TEXT NOT NULL DEFAULT 'manual'");
    this.ensureSqliteColumn('comments', 'source_file_name', 'TEXT');
    this.ensureSqliteColumn('comments', 'email_subject', 'TEXT');
    this.ensureSqliteColumn('comments', 'email_from', 'TEXT');
    this.ensureSqliteColumn('comments', 'email_sent_at', 'TEXT');
    this.ensureSqliteColumn('tickets', 'created_by_id', 'TEXT');
    this.ensureSqliteColumn('tickets', 'created_by_name', 'TEXT');
  }

  async getOrCreateUser(email: string, displayName?: string): Promise<UserProfile> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) throw new Error('Email is required');

    const existing = await this.getUserByEmail(normalizedEmail);
    if (existing) return existing;

    const uid = nanoid(16);
    const role = adminEmails().includes(normalizedEmail) ? 'admin' : 'user';
    const profile: UserProfile = {
      uid,
      email: normalizedEmail,
      displayName: displayName?.trim() || normalizedEmail.split('@')[0],
      photoURL: '',
      role,
    };

    if (this.pg) {
      await this.pg.query(
        'INSERT INTO users (uid, email, display_name, photo_url, role) VALUES ($1, $2, $3, $4, $5)',
        [profile.uid, profile.email, profile.displayName, profile.photoURL, profile.role],
      );
      return profile;
    }

    this.sqlite!.prepare(
      'INSERT INTO users (uid, email, display_name, photo_url, role) VALUES (?, ?, ?, ?, ?)',
    ).run(profile.uid, profile.email, profile.displayName, profile.photoURL, profile.role);
    return profile;
  }

  async getUser(uid: string): Promise<UserProfile | null> {
    const row = this.pg
      ? (await this.pg.query('SELECT uid, email, display_name AS "displayName", photo_url AS "photoURL", role FROM users WHERE uid = $1', [uid])).rows[0]
      : this.sqlite!.prepare('SELECT uid, email, display_name AS displayName, photo_url AS photoURL, role FROM users WHERE uid = ?').get(uid);
    return row ? (row as UserProfile) : null;
  }

  async listUsers(): Promise<UserProfile[]> {
    const rows = this.pg
      ? (await this.pg.query(
        'SELECT uid, email, display_name AS "displayName", photo_url AS "photoURL", role FROM users ORDER BY display_name, email',
      )).rows
      : this.sqlite!.prepare(
        'SELECT uid, email, display_name AS displayName, photo_url AS photoURL, role FROM users ORDER BY display_name, email',
      ).all();
    return rows as UserProfile[];
  }

  async updateUser(uid: string, updates: Partial<Pick<UserProfile, 'displayName' | 'role' | 'photoURL'>>): Promise<UserProfile | null> {
    const allowed: Record<string, string> = {
      displayName: 'display_name',
      role: 'role',
      photoURL: 'photo_url',
    };
    const entries = Object.entries(updates).filter(([key, value]) => key in allowed && value !== undefined);

    if (entries.length === 0) return this.getUser(uid);

    if (this.pg) {
      const values = entries.map(([, value]) => value);
      const assignments = entries.map(([key], index) => `${allowed[key]} = $${index + 1}`).join(', ');
      values.push(uid);
      await this.pg.query(`UPDATE users SET ${assignments} WHERE uid = $${entries.length + 1}`, values);
    } else {
      const values = entries.map(([, value]) => value);
      const assignments = entries.map(([key]) => `${allowed[key]} = ?`).join(', ');
      values.push(uid);
      this.sqlite!.prepare(`UPDATE users SET ${assignments} WHERE uid = ?`).run(...values);
    }

    return this.getUser(uid);
  }

  async listAgents(): Promise<UserProfile[]> {
    const rows = this.pg
      ? (await this.pg.query('SELECT uid, email, display_name AS "displayName", photo_url AS "photoURL", role FROM users WHERE role IN ($1, $2) ORDER BY display_name', ['admin', 'agent'])).rows
      : this.sqlite!.prepare('SELECT uid, email, display_name AS displayName, photo_url AS photoURL, role FROM users WHERE role IN (?, ?) ORDER BY display_name').all('admin', 'agent');
    return rows as UserProfile[];
  }

  async listRequesters(): Promise<Requester[]> {
    const rows = this.pg
      ? (await this.pg.query(
        `SELECT requester_name AS "requesterName", requester_email AS "requesterEmail"
         FROM tickets
         WHERE requester_name <> '' OR requester_email <> ''
         GROUP BY requester_name, requester_email
         ORDER BY requester_name, requester_email`,
      )).rows
      : this.sqlite!.prepare(
        `SELECT requester_name AS requesterName, requester_email AS requesterEmail
         FROM tickets
         WHERE requester_name <> '' OR requester_email <> ''
         GROUP BY requester_name, requester_email
         ORDER BY requester_name, requester_email`,
      ).all();
    return rows as Requester[];
  }

  async createTicket(input: NewTicketInput): Promise<Ticket> {
    const id = nanoid(16);
    const timestamp = now();
    if (this.pg) {
      await this.pg.query(
        `INSERT INTO tickets (
           id, title, description, status, priority, requester_email, requester_name, created_by_id, created_by_name,
           created_at, updated_at, tags, attachments
         ) VALUES ($1, $2, $3, 'new', $4, $5, $6, $7, $8, $9, $9, $10, $11)`,
        [
          id,
          input.title,
          input.description,
          input.priority,
          input.requesterEmail,
          input.requesterName,
          input.createdById || null,
          input.createdByName || null,
          timestamp,
          json([]),
          json(input.attachments),
        ],
      );
    } else {
      this.sqlite!.prepare(
        `INSERT INTO tickets (
          id, title, description, status, priority, requester_email, requester_name, created_by_id, created_by_name,
          created_at, updated_at, tags, attachments
        ) VALUES (?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.title,
        input.description,
        input.priority,
        input.requesterEmail,
        input.requesterName,
        input.createdById || null,
        input.createdByName || null,
        timestamp,
        timestamp,
        json([]),
        json(input.attachments),
      );
    }
    return (await this.getTicket(id))!;
  }

  async getTicket(id: string): Promise<Ticket | null> {
    const rows = await this.queryTickets('WHERE id = ?', [id]);
    return rows[0] || null;
  }

  async listTickets(filter = 'all', currentUserId?: string, currentUserEmail?: string, search?: string): Promise<Ticket[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter === 'assigned' && currentUserId) {
      conditions.push('assignee_id = ?');
      params.push(currentUserId);
    } else if (filter === 'archived') {
      conditions.push("status IN ('closed', 'resolved')");
    } else if (filter === 'created' && currentUserId) {
      conditions.push('created_by_id = ?');
      params.push(currentUserId);
    } else if (['new', 'open', 'in_progress', 'waiting', 'resolved', 'closed'].includes(filter)) {
      conditions.push('status = ?');
      params.push(filter);
    } else {
      conditions.push("status NOT IN ('closed', 'resolved')");
    }

    if (search?.trim()) {
      const term = toSqlLike(search.trim());
      conditions.push(`(
        LOWER(title) LIKE ? ESCAPE '\\'
        OR LOWER(description) LIKE ? ESCAPE '\\'
        OR LOWER(id) LIKE ? ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM comments c
          WHERE c.ticket_id = tickets.id
            AND (
              LOWER(c.content) LIKE ? ESCAPE '\\'
              OR LOWER(COALESCE(c.email_subject, '')) LIKE ? ESCAPE '\\'
              OR LOWER(COALESCE(c.email_from, '')) LIKE ? ESCAPE '\\'
              OR LOWER(COALESCE(c.source_file_name, '')) LIKE ? ESCAPE '\\'
            )
        )
      )`);
      params.push(term, term, term, term, term, term, term);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const order = filter === 'all' ? 'ORDER BY status ASC, created_at DESC' : 'ORDER BY created_at DESC';
    return this.queryTickets(where, params, order);
  }

  async updateTicket(id: string, updates: Partial<Ticket>): Promise<Ticket | null> {
    const allowed: Record<string, string> = {
      status: 'status',
      priority: 'priority',
      assigneeId: 'assignee_id',
      assigneeName: 'assignee_name',
      deadline: 'deadline',
      attachments: 'attachments',
    };
    const entries = Object.entries(updates).filter(([key]) => key in allowed);
    const values = entries.map(([key, value]) => key === 'attachments' ? json(value) : value);
    values.push(now());
    values.push(id);

    if (entries.length === 0) return this.getTicket(id);

    if (this.pg) {
      const assignments = entries.map(([key], index) => `${allowed[key]} = $${index + 1}`).join(', ');
      await this.pg.query(`UPDATE tickets SET ${assignments}, updated_at = $${entries.length + 1} WHERE id = $${entries.length + 2}`, values);
    } else {
      const assignments = entries.map(([key]) => `${allowed[key]} = ?`).join(', ');
      const sqliteValues = entries.map(([key, value]) => key === 'attachments' ? json(value) : value);
      sqliteValues.push(now(), id);
      this.sqlite!.prepare(`UPDATE tickets SET ${assignments}, updated_at = ? WHERE id = ?`).run(...sqliteValues);
    }
    return this.getTicket(id);
  }

  async listComments(ticketId: string) {
    const rows = this.pg
      ? (await this.pg.query(
        `SELECT id, ticket_id AS "ticketId", author_id AS "authorId", author_name AS "authorName", content,
                created_at AS "createdAt", is_internal AS "isInternal", attachments,
                source_type AS "sourceType", source_file_name AS "sourceFileName",
                email_subject AS "emailSubject", email_from AS "emailFrom", email_sent_at AS "emailSentAt"
           FROM comments WHERE ticket_id = $1 ORDER BY created_at ASC`,
        [ticketId],
      )).rows
      : this.sqlite!.prepare(
        `SELECT id, ticket_id AS ticketId, author_id AS authorId, author_name AS authorName, content,
                created_at AS createdAt, is_internal AS isInternal, attachments,
                source_type AS sourceType, source_file_name AS sourceFileName,
                email_subject AS emailSubject, email_from AS emailFrom, email_sent_at AS emailSentAt
           FROM comments WHERE ticket_id = ? ORDER BY created_at ASC`,
      ).all(ticketId);

    return rows.map((row: any) => ({
      ...row,
      isInternal: Boolean(row.isInternal),
      attachments: parseJson(row.attachments, []),
    }));
  }

  async createComment(input: NewCommentInput): Promise<Comment | undefined> {
    const id = nanoid(16);
    const timestamp = now();
    if (this.pg) {
      await this.pg.query(
        `INSERT INTO comments (
            id, ticket_id, author_id, author_name, content, created_at, is_internal, attachments,
            source_type, source_file_name, email_subject, email_from, email_sent_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13)`,
        [
          id,
          input.ticketId,
          input.authorId,
          input.authorName,
          input.content,
          timestamp,
          input.isInternal,
          json(input.attachments),
          input.sourceType || 'manual',
          input.sourceFileName || null,
          input.emailSubject || null,
          input.emailFrom || null,
          input.emailSentAt || null,
        ],
      );
    } else {
      this.sqlite!.prepare(
        `INSERT INTO comments (
           id, ticket_id, author_id, author_name, content, created_at, is_internal, attachments,
           source_type, source_file_name, email_subject, email_from, email_sent_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.ticketId,
        input.authorId,
        input.authorName,
        input.content,
        timestamp,
        input.isInternal ? 1 : 0,
        json(input.attachments),
        input.sourceType || 'manual',
        input.sourceFileName || null,
        input.emailSubject || null,
        input.emailFrom || null,
        input.emailSentAt || null,
      );
    }

    const comments = await this.listComments(input.ticketId);
    return comments.find((comment) => comment.id === id);
  }

  async updateComment(ticketId: string, commentId: string, updates: UpdateCommentInput): Promise<Comment | undefined> {
    const entries = Object.entries(updates).filter(([, value]) => value !== undefined);
    if (entries.length === 0) {
      const comments = await this.listComments(ticketId);
      return comments.find((comment) => comment.id === commentId);
    }

    if (this.pg) {
      const values: unknown[] = [];
      const assignments: string[] = [];
      let index = 1;

      if (updates.content !== undefined) {
        assignments.push(`content = $${index++}`);
        values.push(updates.content);
      }
      if (updates.isInternal !== undefined) {
        assignments.push(`is_internal = $${index++}`);
        values.push(updates.isInternal);
      }

      values.push(commentId, ticketId);
      await this.pg.query(
        `UPDATE comments SET ${assignments.join(', ')} WHERE id = $${index++} AND ticket_id = $${index}`,
        values,
      );
    } else {
      const assignments: string[] = [];
      const values: unknown[] = [];

      if (updates.content !== undefined) {
        assignments.push('content = ?');
        values.push(updates.content);
      }
      if (updates.isInternal !== undefined) {
        assignments.push('is_internal = ?');
        values.push(updates.isInternal ? 1 : 0);
      }

      values.push(commentId, ticketId);
      this.sqlite!.prepare(
        `UPDATE comments SET ${assignments.join(', ')} WHERE id = ? AND ticket_id = ?`,
      ).run(...values);
    }

    const comments = await this.listComments(ticketId);
    return comments.find((comment) => comment.id === commentId);
  }

  async deleteComment(ticketId: string, commentId: string): Promise<boolean> {
    let changes = 0;
    if (this.pg) {
      const result = await this.pg.query('DELETE FROM comments WHERE id = $1 AND ticket_id = $2', [commentId, ticketId]);
      changes = result.rowCount ?? 0;
    } else {
      const result = this.sqlite!.prepare('DELETE FROM comments WHERE id = ? AND ticket_id = ?').run(commentId, ticketId);
      changes = result.changes;
    }
    return changes > 0;
  }

  async deleteAttachment(ticketId: string, attachmentUrl: string) {
    const ticket = await this.getTicket(ticketId);
    if (!ticket) return null;

    const nextTicketAttachments = (ticket.attachments || []).filter((attachment) => attachment.url !== attachmentUrl);
    await this.updateTicket(ticketId, { attachments: nextTicketAttachments });

    if (this.pg) {
      const comments = await this.listComments(ticketId);
      for (const comment of comments) {
        const attachments = (comment.attachments || []).filter((attachment) => attachment.url !== attachmentUrl);
        if (attachments.length !== (comment.attachments || []).length) {
          await this.pg.query('UPDATE comments SET attachments = $1::jsonb WHERE id = $2 AND ticket_id = $3', [
            json(attachments),
            comment.id,
            ticketId,
          ]);
        }
      }
    } else {
      const comments = await this.listComments(ticketId);
      for (const comment of comments) {
        const attachments = (comment.attachments || []).filter((attachment) => attachment.url !== attachmentUrl);
        if (attachments.length !== (comment.attachments || []).length) {
          this.sqlite!.prepare('UPDATE comments SET attachments = ? WHERE id = ? AND ticket_id = ?').run(
            json(attachments),
            comment.id,
            ticketId,
          );
        }
      }
    }

    return this.getTicket(ticketId);
  }

  async importEmailToTicket(ticketId: string, author: Pick<UserProfile, 'uid' | 'displayName'>, attachment: Attachment, email: {
    subject?: string | null;
    from?: string | null;
    sentAt?: string | null;
    body?: string | null;
    parseError?: string | null;
  }) {
    const ticket = await this.getTicket(ticketId);
    if (!ticket) return null;

    const existingAttachments = ticket.attachments || [];
    const dedupedAttachments = [...existingAttachments, attachment];
    await this.updateTicket(ticketId, { attachments: dedupedAttachments });

    const content = email.body?.trim()
      ? email.body.trim()
      : 'Parsing unavailable for this imported Outlook email. The original .msg file is attached for reference.';

    const comment = await this.createComment({
      ticketId,
      authorId: author.uid,
      authorName: author.displayName,
      content,
      isInternal: false,
      attachments: [attachment],
      sourceType: 'email_import',
      sourceFileName: attachment.name,
      emailSubject: email.subject || undefined,
      emailFrom: email.from || undefined,
      emailSentAt: email.sentAt || undefined,
    });

    return {
      ticket: await this.getTicket(ticketId),
      comment,
      attachment,
      parseError: email.parseError || undefined,
    };
  }

  private async getUserByEmail(email: string): Promise<UserProfile | null> {
    const row = this.pg
      ? (await this.pg.query('SELECT uid, email, display_name AS "displayName", photo_url AS "photoURL", role FROM users WHERE email = $1', [email])).rows[0]
      : this.sqlite!.prepare('SELECT uid, email, display_name AS displayName, photo_url AS photoURL, role FROM users WHERE email = ?').get(email);
    return row ? (row as UserProfile) : null;
  }

  private async queryTickets(where: string, params: unknown[] = [], order = ''): Promise<Ticket[]> {
    const select = `SELECT id, title, description, status, priority,
      requester_email AS ${this.pg ? '"requesterEmail"' : 'requesterEmail'},
      requester_name AS ${this.pg ? '"requesterName"' : 'requesterName'},
      created_by_id AS ${this.pg ? '"createdById"' : 'createdById'},
      created_by_name AS ${this.pg ? '"createdByName"' : 'createdByName'},
      assignee_id AS ${this.pg ? '"assigneeId"' : 'assigneeId'},
      assignee_name AS ${this.pg ? '"assigneeName"' : 'assigneeName'},
      deadline,
      created_at AS ${this.pg ? '"createdAt"' : 'createdAt'},
      updated_at AS ${this.pg ? '"updatedAt"' : 'updatedAt'},
      tags,
      attachments
      FROM tickets`;

    if (this.pg) {
      let index = 0;
      const pgWhere = where.replace(/\?/g, () => `$${++index}`);
      const rows = (await this.pg.query(`${select} ${pgWhere} ${order}`, params)).rows;
      return rows.map((row) => this.ticketFromRow(row));
    }

    return this.sqlite!.prepare(`${select} ${where} ${order}`).all(...params).map((row: any) => this.ticketFromRow(row));
  }

  private ticketFromRow(row: any): Ticket {
    return {
      ...row,
      tags: parseJson(row.tags, []),
      attachments: parseJson(row.attachments, []),
    } as Ticket;
  }

  private ensureSqliteColumn(table: string, column: string, definition: string) {
    const columns = this.sqlite!.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((entry) => entry.name === column)) {
      this.sqlite!.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}
