import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { nanoid } from 'nanoid';
import type { Ticket, TicketPriority, UserProfile } from '../src/types';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof import('better-sqlite3');
const { Pool } = require('pg') as typeof import('pg');

export interface NewTicketInput {
  title: string;
  description: string;
  priority: TicketPriority;
  requesterName: string;
  requesterEmail: string;
  attachments?: unknown[];
}

export interface NewCommentInput {
  ticketId: string;
  authorId: string;
  authorName: string;
  content: string;
  isInternal: boolean;
  attachments?: unknown[];
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
          attachments JSONB NOT NULL DEFAULT '[]'::jsonb
        );
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
        FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
      );
    `);
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

  async createTicket(input: NewTicketInput): Promise<Ticket> {
    const id = nanoid(16);
    const timestamp = now();
    if (this.pg) {
      await this.pg.query(
        `INSERT INTO tickets (id, title, description, status, priority, requester_email, requester_name, created_at, updated_at, tags, attachments)
         VALUES ($1, $2, $3, 'new', $4, $5, $6, $7, $7, $8, $9)`,
        [id, input.title, input.description, input.priority, input.requesterEmail, input.requesterName, timestamp, json([]), json(input.attachments)],
      );
    } else {
      this.sqlite!.prepare(
        `INSERT INTO tickets (id, title, description, status, priority, requester_email, requester_name, created_at, updated_at, tags, attachments)
         VALUES (?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, input.title, input.description, input.priority, input.requesterEmail, input.requesterName, timestamp, timestamp, json([]), json(input.attachments));
    }
    return (await this.getTicket(id))!;
  }

  async getTicket(id: string): Promise<Ticket | null> {
    const rows = await this.queryTickets('WHERE id = ?', [id]);
    return rows[0] || null;
  }

  async listTickets(filter = 'all', currentUserId?: string, currentUserEmail?: string): Promise<Ticket[]> {
    if (filter === 'assigned' && currentUserId) {
      return this.queryTickets('WHERE assignee_id = ?', [currentUserId], 'ORDER BY created_at DESC');
    }
    if (filter === 'archived') {
      return this.queryTickets("WHERE status IN ('closed', 'resolved')", [], 'ORDER BY created_at DESC');
    }
    if (filter === 'requesters' && currentUserEmail) {
      return this.queryTickets('WHERE requester_email = ?', [currentUserEmail], 'ORDER BY created_at DESC');
    }
    if (['new', 'open', 'in_progress', 'waiting', 'resolved', 'closed'].includes(filter)) {
      return this.queryTickets('WHERE status = ?', [filter], 'ORDER BY created_at DESC');
    }
    return this.queryTickets("WHERE status NOT IN ('closed', 'resolved')", [], 'ORDER BY status ASC, created_at DESC');
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
                created_at AS "createdAt", is_internal AS "isInternal", attachments
           FROM comments WHERE ticket_id = $1 ORDER BY created_at ASC`,
        [ticketId],
      )).rows
      : this.sqlite!.prepare(
        `SELECT id, ticket_id AS ticketId, author_id AS authorId, author_name AS authorName, content,
                created_at AS createdAt, is_internal AS isInternal, attachments
           FROM comments WHERE ticket_id = ? ORDER BY created_at ASC`,
      ).all(ticketId);

    return rows.map((row: any) => ({
      ...row,
      isInternal: Boolean(row.isInternal),
      attachments: parseJson(row.attachments, []),
    }));
  }

  async createComment(input: NewCommentInput) {
    const id = nanoid(16);
    const timestamp = now();
    if (this.pg) {
      await this.pg.query(
        `INSERT INTO comments (id, ticket_id, author_id, author_name, content, created_at, is_internal, attachments)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, input.ticketId, input.authorId, input.authorName, input.content, timestamp, input.isInternal, json(input.attachments)],
      );
    } else {
      this.sqlite!.prepare(
        `INSERT INTO comments (id, ticket_id, author_id, author_name, content, created_at, is_internal, attachments)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, input.ticketId, input.authorId, input.authorName, input.content, timestamp, input.isInternal ? 1 : 0, json(input.attachments));
    }

    const comments = await this.listComments(input.ticketId);
    return comments.find((comment) => comment.id === id);
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
}
