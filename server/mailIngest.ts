import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import type { Attachment, UserProfile } from '../src/types';
import { Store } from './store';

interface MailIngestConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  to: string;
  pollSeconds: number;
  archiveAfterProcessing: boolean;
  botEmail: string;
  botName: string;
  dataDir: string;
  maxUploadBytes: number;
}

interface ProcessedMail {
  ticketId: string;
  messageId?: string | null;
  gmailThreadId?: string | null;
}

const TICKET_TAG_PATTERN = /\[HANDL:([a-zA-Z0-9_-]+)\]/i;

function envFlag(name: string, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function envNumber(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readMailIngestConfig(dataDir: string): MailIngestConfig {
  const user = process.env.MAIL_INGEST_USER || '';
  return {
    enabled: envFlag('MAIL_INGEST_ENABLED'),
    host: process.env.MAIL_INGEST_HOST || 'imap.gmail.com',
    port: envNumber('MAIL_INGEST_PORT', 993),
    secure: envFlag('MAIL_INGEST_SECURE', true),
    user,
    password: process.env.MAIL_INGEST_PASSWORD || '',
    from: (process.env.MAIL_INGEST_FROM || '').trim().toLowerCase(),
    to: (process.env.MAIL_INGEST_TO || user).trim().toLowerCase(),
    pollSeconds: envNumber('MAIL_INGEST_POLL_SECONDS', 300),
    archiveAfterProcessing: envFlag('MAIL_INGEST_ARCHIVE_AFTER_PROCESSING', true),
    botEmail: (process.env.MAIL_INGEST_BOT_EMAIL || user).trim().toLowerCase(),
    botName: process.env.MAIL_INGEST_BOT_NAME || 'Handl Mail Import',
    dataDir,
    maxUploadBytes: envNumber('MAX_UPLOAD_BYTES', 25 * 1024 * 1024),
  };
}

export function extractHandlTicketId(subject: string | undefined) {
  return subject?.match(TICKET_TAG_PATTERN)?.[1] || null;
}

function normalizeMessageId(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function normalizeReferences(references: ParsedMail['references']) {
  if (!references) return [];
  return (Array.isArray(references) ? references : [references]).map(normalizeMessageId).filter(Boolean);
}

function mailboxAddress(address: ParsedMail['from'] | ParsedMail['replyTo']) {
  const first = address?.value?.[0];
  return {
    name: first?.name?.trim() || first?.address || '',
    email: first?.address?.trim().toLowerCase() || '',
  };
}

function formatMailboxAddress(address: ReturnType<typeof mailboxAddress>) {
  if (address.name && address.email && address.name !== address.email) {
    return `${address.name} <${address.email}>`;
  }
  return address.email || address.name;
}

function addressListIncludes(addresses: ParsedMail['to'], email: string) {
  const list = Array.isArray(addresses) ? addresses : addresses ? [addresses] : [];
  return list.some((entry) => entry.value.some((address) => address.address?.trim().toLowerCase() === email));
}

function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function emailBody(mail: ParsedMail) {
  if (mail.text?.trim()) return mail.text.replace(/\r\n/g, '\n').trim();
  if (typeof mail.html === 'string' && mail.html.trim()) return stripHtml(mail.html);
  return '';
}

function extractOriginalRequesterFromBody(body: string) {
  const headerLine = body
    .split(/\r?\n/)
    .slice(0, 40)
    .map((line) => line.trim())
    .find((line) => /^(original\s+from|original\s+sender|from|sender|reply-to)\s*:/i.test(line));

  if (!headerLine) return null;

  const value = headerLine.replace(/^(original\s+from|original\s+sender|from|sender|reply-to)\s*:\s*/i, '').trim();
  const angleMatch = value.match(/^(.*?)(?:<([^>]+)>)$/);
  if (angleMatch) {
    return {
      name: angleMatch[1].trim().replace(/^"|"$/g, ''),
      email: angleMatch[2].trim().toLowerCase(),
    };
  }

  const emailMatch = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (emailMatch) {
    const email = emailMatch[0].toLowerCase();
    return {
      name: value.replace(emailMatch[0], '').replace(/[()<>"]/g, '').trim(),
      email,
    };
  }

  return null;
}

function requesterAddress(mail: ParsedMail) {
  const replyTo = mailboxAddress(mail.replyTo);
  if (replyTo.email) return replyTo;

  const bodyRequester = extractOriginalRequesterFromBody(emailBody(mail));
  if (bodyRequester?.email) return bodyRequester;

  return mailboxAddress(mail.from);
}

function buildEmailDescription(mail: ParsedMail) {
  const from = requesterAddress(mail);
  const lines: string[] = [];
  if (mail.subject) lines.push(`Subject: ${mail.subject}`);
  if (from.email || from.name) lines.push(`From: ${from.name ? `${from.name} <${from.email}>` : from.email}`);
  if (mail.date) lines.push(`Sent: ${mail.date.toISOString()}`);
  const body = emailBody(mail);
  if (body) {
    if (lines.length > 0) lines.push('');
    lines.push(body);
  }
  return lines.join('\n') || 'No message body found.';
}

function safeFileName(name: string) {
  const fallback = 'attachment';
  return (name || fallback).replace(/[^a-zA-Z0-9._-]/g, '_') || fallback;
}

function createAttachmentFromParsedMail(config: MailIngestConfig, attachment: ParsedMail['attachments'][number]): Attachment {
  if (attachment.size > config.maxUploadBytes) {
    throw new Error(`Attachment ${attachment.filename || attachment.checksum} exceeds MAX_UPLOAD_BYTES`);
  }

  const uploadsDir = path.join(config.dataDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  const originalName = attachment.filename || `attachment-${attachment.checksum || crypto.randomUUID()}`;
  const filename = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}_${safeFileName(originalName)}`;
  const filePath = path.join(uploadsDir, filename);
  fs.writeFileSync(filePath, attachment.content);

  return {
    name: originalName,
    url: `/uploads/${filename}`,
    type: attachment.contentType || 'application/octet-stream',
    size: attachment.size,
    createdAt: new Date().toISOString(),
  };
}

async function resolveTicketId(store: Store, mail: ParsedMail, gmailThreadId?: string | null) {
  const taggedTicketId = extractHandlTicketId(mail.subject);
  if (taggedTicketId && await store.getTicket(taggedTicketId)) {
    return taggedTicketId;
  }

  const referenceIds = [
    normalizeMessageId(mail.inReplyTo),
    ...normalizeReferences(mail.references),
  ].filter(Boolean);

  const referencedTicketId = await store.findTicketIdForMailMessage({
    messageIds: referenceIds,
    gmailThreadId,
  });
  if (referencedTicketId) return referencedTicketId;

  const requester = requesterAddress(mail);
  const subjectMatchedTicket = await store.findOpenTicketByTitleAndRequester(mail.subject || '', requester.email);
  if (subjectMatchedTicket) return subjectMatchedTicket.id;

  return null;
}

async function persistMail(
  store: Store,
  config: MailIngestConfig,
  bot: Pick<UserProfile, 'uid' | 'displayName'>,
  mail: ParsedMail,
  gmailThreadId?: string | null,
): Promise<ProcessedMail> {
  const requester = requesterAddress(mail);
  const messageId = normalizeMessageId(mail.messageId) || null;
  const attachments = mail.attachments
    .filter((attachment) => !attachment.related)
    .map((attachment) => createAttachmentFromParsedMail(config, attachment));

  const existingTicketId = await resolveTicketId(store, mail, gmailThreadId);
  if (existingTicketId) {
    await store.createComment({
      ticketId: existingTicketId,
      authorId: bot.uid,
      authorName: bot.displayName,
      content: emailBody(mail) || 'No message body found.',
      isInternal: false,
      attachments,
      sourceType: 'email_import',
      sourceFileName: mail.subject || undefined,
      emailSubject: mail.subject || undefined,
      emailFrom: formatMailboxAddress(requester) || undefined,
      emailSentAt: mail.date?.toISOString() || undefined,
    });

    return {
      ticketId: existingTicketId,
      messageId,
      gmailThreadId,
    };
  }

  const ticket = await store.createTicket({
    title: mail.subject?.trim() || 'Email request',
    description: buildEmailDescription(mail),
    priority: 'medium',
    requesterName: requester.name || requester.email || 'Unknown requester',
    requesterEmail: requester.email,
    createdById: bot.uid,
    createdByName: bot.displayName,
    attachments,
  });

  return {
    ticketId: ticket.id,
    messageId,
    gmailThreadId,
  };
}

async function archiveOrMarkSeen(client: ImapFlow, uid: number, archiveAfterProcessing: boolean) {
  if (!archiveAfterProcessing) {
    await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
    return;
  }

  const allMailPath = await findArchiveMailboxPath(client);
  if (allMailPath) {
    const moved = await client.messageMove(String(uid), allMailPath, { uid: true });
    if (moved) return;
  }

  const removedInboxLabel = await client.messageFlagsRemove(String(uid), ['\\Inbox'], { uid: true, useLabels: true });
  if (removedInboxLabel) return;

  throw new Error('Unable to archive message by moving to All Mail or removing the Gmail Inbox label');
}

async function findArchiveMailboxPath(client: ImapFlow) {
  const mailboxes = await client.list();
  return (
    mailboxes.find((mailbox) => mailbox.specialUse === '\\All')?.path ||
    mailboxes.find((mailbox) => mailbox.specialUse === '\\Archive')?.path ||
    mailboxes.find((mailbox) => mailbox.path.toLowerCase() === '[gmail]/all mail')?.path ||
    null
  );
}

function shouldAcceptMail(mail: ParsedMail, config: MailIngestConfig) {
  const from = mailboxAddress(mail.from).email;
  return from === config.from && addressListIncludes(mail.to, config.to);
}

async function processUid(client: ImapFlow, store: Store, config: MailIngestConfig, bot: UserProfile, uid: number, uidValidity: bigint) {
  const imapUidKey = `${config.user}:INBOX:${uidValidity.toString()}:${uid}`;

  if (await store.hasProcessedMailMessage(imapUidKey)) {
    await archiveOrMarkSeen(client, uid, config.archiveAfterProcessing);
    return;
  }

  const message = await client.fetchOne(String(uid), { uid: true, source: true, threadId: true }, { uid: true });
  if (!message || !message.source) return;

  const mail = await simpleParser(message.source);
  if (!shouldAcceptMail(mail, config)) {
    return;
  }

  const processed = await persistMail(store, config, bot, mail, message.threadId || null);
  await store.recordMailIngestMessage({
    imapUidKey,
    messageId: processed.messageId,
    gmailThreadId: processed.gmailThreadId,
    ticketId: processed.ticketId,
  });
  await archiveOrMarkSeen(client, uid, config.archiveAfterProcessing);
}

async function pollMailbox(store: Store, config: MailIngestConfig, bot: UserProfile) {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password,
    },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const mailbox = await client.mailboxOpen('INBOX');
    const query = config.from && config.to
      ? { gmraw: `in:inbox is:unread from:${config.from} to:${config.to}` }
      : { seen: false };
    const uids = await client.search(query, { uid: true });

    if (Array.isArray(uids)) {
      for (const uid of uids) {
        try {
          await processUid(client, store, config, bot, uid, mailbox.uidValidity);
        } catch (error) {
          console.error(`Mail ingest failed for UID ${uid}:`, error);
        }
      }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => client.close());
  }
}

function validateConfig(config: MailIngestConfig) {
  const missing = [
    ['MAIL_INGEST_USER', config.user],
    ['MAIL_INGEST_PASSWORD', config.password],
    ['MAIL_INGEST_FROM', config.from],
    ['MAIL_INGEST_TO', config.to],
    ['MAIL_INGEST_BOT_EMAIL', config.botEmail],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(`Mail ingest enabled but missing: ${missing.map(([name]) => name).join(', ')}`);
  }
}

export async function startMailIngest(store: Store, dataDir: string) {
  const config = readMailIngestConfig(dataDir);
  if (!config.enabled) return;

  validateConfig(config);
  const bot = await store.getOrCreateSystemUser(config.botEmail, config.botName);

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await pollMailbox(store, config, bot);
    } catch (error) {
      console.error('Mail ingest poll failed:', error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(run, config.pollSeconds * 1000);
  timer.unref?.();
  void run();
  console.log(`Mail ingest enabled for ${config.user}; polling every ${config.pollSeconds}s`);
}
