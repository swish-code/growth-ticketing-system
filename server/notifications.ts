import crypto from 'node:crypto';
import { canManage, canUseBrand, tabName, type Notification, type Ticket } from '../shared/spec';
import { resolveViewerByEmail } from './auth';
import { query } from './db';
import type { Actor } from './tickets';

/**
 * Notification Center — personalized, persisted notifications (spec:
 * "notification center", each employee sees what happened even while
 * logged out). Replaces the old global, in-memory-only toast feed.
 *
 * Recipient rules:
 *   - A brand-new request: the requester, plus every staff member who can
 *     currently Manage that tab for that brand — so managers who haven't
 *     touched the ticket yet still learn a new request needs attention.
 *   - Every other lifecycle event: the requester, the assignee and the
 *     acting staff member (mirrors the email notifier's recipient set).
 *   - SLA escalations: administrators only (unchanged from the old feed).
 */

export type NotificationKind =
  | 'created'
  | 'accepted'
  | 'declined'
  | 'scheduled'
  | 'done'
  | 'updated'
  | 'deleted'
  | 'sla.acceptance'
  | 'sla.completion';

interface CopyResult {
  title: string;
  message: string;
}

function copyFor(kind: NotificationKind, ticket: Ticket, actor: Actor, detail?: string): CopyResult {
  const id = ticket.id;
  const by = actor.email === 'system' ? 'the system' : actor.name;

  switch (kind) {
    case 'created':
      return { title: 'New request submitted', message: `${tabName(ticket.area)} · ${id} · ${ticket.title} — by ${by}` };
    case 'accepted':
      return { title: 'Request accepted', message: `${tabName(ticket.area)} · ${id} · ${ticket.title} — by ${by}` };
    case 'declined':
      return {
        title: 'Request declined',
        message: `${tabName(ticket.area)} · ${id} · ${ticket.title}${detail ? ` — ${detail}` : ''}`,
      };
    case 'scheduled':
      return {
        title: 'Request scheduled',
        message: `${tabName(ticket.area)} · ${id} · ${ticket.title} — completes on ${ticket.campaignDate}`,
      };
    case 'done':
      return { title: 'Request completed', message: `${tabName(ticket.area)} · ${id} · ${ticket.title} — by ${by}` };
    case 'deleted':
      return { title: 'Request deleted', message: `${tabName(ticket.area)} · ${id} · ${ticket.title} — by ${by}` };
    case 'sla.acceptance':
      return {
        title: 'Acceptance overdue',
        message: `${tabName(ticket.area)} · ${id} · ${ticket.title} — not accepted within 24 hours`,
      };
    case 'sla.completion':
      return {
        title: 'Completion overdue',
        message: `${tabName(ticket.area)} · ${id} · ${ticket.title} — campaign date has passed`,
      };
    case 'updated':
    default:
      return {
        title: 'Request updated',
        message: `${tabName(ticket.area)} · ${id} · ${ticket.title}${detail ? ` — ${detail}` : ''}`,
      };
  }
}

/** Every staff member who can currently Manage this tab for this brand. */
async function listManagersFor(area: string, brand: string): Promise<string[]> {
  const staff = await query<{ email: string }>(`SELECT email FROM staff`);
  const viewers = await Promise.all(staff.rows.map((row) => resolveViewerByEmail(row.email)));
  return viewers
    .filter((v): v is NonNullable<typeof v> => Boolean(v))
    .filter((v) => canManage(v, area) && canUseBrand(v, brand))
    .map((v) => v.email);
}

async function listAdmins(): Promise<string[]> {
  const result = await query<{ email: string }>(`SELECT email FROM staff WHERE is_admin = TRUE`);
  return result.rows.map((row) => row.email);
}

async function recipientsFor(kind: NotificationKind, ticket: Ticket, actor: Actor): Promise<string[]> {
  if (kind === 'sla.acceptance' || kind === 'sla.completion') {
    return listAdmins();
  }
  if (kind === 'created') {
    const managers = await listManagersFor(ticket.area, ticket.brand);
    return [...new Set([ticket.requesterEmail, ...managers])];
  }
  const all = [ticket.requesterEmail, ticket.ownerEmail, actor.email];
  return [...new Set(all.filter((e): e is string => Boolean(e && e.includes('@'))))];
}

/**
 * Fans a lifecycle event out to every relevant recipient. `stableId`, when
 * given, makes each recipient's row idempotent (`<stableId>-<email>`) — used
 * by the automatic Scheduled→Done conversion and SLA escalations, which can
 * run again before their audit/event write is confirmed. User-triggered
 * actions fire once per click and don't need one.
 */
export async function fanOutNotification(
  kind: NotificationKind,
  ticket: Ticket,
  actor: Actor,
  detail?: string,
  stableId?: string,
): Promise<void> {
  const recipients = await recipientsFor(kind, ticket, actor);
  if (!recipients.length) return;

  const { title, message } = copyFor(kind, ticket, actor, detail);
  const now = Date.now();

  await Promise.all(
    recipients.map((email) =>
      query(
        `INSERT INTO notifications
           (id, recipient_email, type, title, message, ticket_id, area, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          stableId ? `${stableId}-${email}` : crypto.randomUUID(),
          email,
          kind,
          title,
          message,
          ticket.id,
          ticket.area,
          now,
        ],
      ),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

interface NotificationDbRow {
  id: string;
  type: string;
  title: string;
  message: string;
  ticket_id: string | null;
  area: string | null;
  read_at: string | null;
  created_at: string;
}

function mapRow(row: NotificationDbRow): Notification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    ticketId: row.ticket_id,
    area: row.area,
    readAt: row.read_at === null ? null : Number(row.read_at),
    createdAt: Number(row.created_at),
  };
}

/** Most recent notifications for one employee, newest first. */
export async function listNotifications(email: string, limit = 50): Promise<Notification[]> {
  const result = await query<NotificationDbRow>(
    `SELECT id, type, title, message, ticket_id, area, read_at, created_at
     FROM notifications WHERE recipient_email = $1 ORDER BY created_at DESC LIMIT $2`,
    [email, limit],
  );
  return result.rows.map(mapRow);
}

/** New notifications since a cursor — drives the toast poll. */
export async function listNotificationsSince(email: string, since: number, limit = 20): Promise<Notification[]> {
  const result = await query<NotificationDbRow>(
    `SELECT id, type, title, message, ticket_id, area, read_at, created_at
     FROM notifications WHERE recipient_email = $1 AND created_at > $2
     ORDER BY created_at ASC LIMIT $3`,
    [email, since, limit],
  );
  return result.rows.map(mapRow);
}

export async function countUnread(email: string): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM notifications WHERE recipient_email = $1 AND read_at IS NULL`,
    [email],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** Only marks the caller's own notification — never someone else's. */
export async function markRead(id: string, email: string): Promise<void> {
  await query(
    `UPDATE notifications SET read_at = $3 WHERE id = $1 AND recipient_email = $2 AND read_at IS NULL`,
    [id, email, Date.now()],
  );
}

export async function markAllRead(email: string): Promise<void> {
  await query(
    `UPDATE notifications SET read_at = $2 WHERE recipient_email = $1 AND read_at IS NULL`,
    [email, Date.now()],
  );
}
