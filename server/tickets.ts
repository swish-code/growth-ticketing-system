import crypto from 'node:crypto';
import {
  ACCEPTANCE_SLA_MS,
  MENU_ISSUES,
  dateReached,
  tabName,
  todayKey,
  type ActivityEvent,
  type AuditEntry,
  type Ticket,
  type TicketStatus,
} from '../shared/spec';
import { query } from './db';

/* ------------------------------------------------------------------ */
/* Row mapping                                                         */
/* ------------------------------------------------------------------ */

export interface TicketRow {
  id: string;
  area: string;
  brand: string;
  title: string;
  campaign_date: string;
  status: string;
  owner_email: string | null;
  requester_email: string;
  requester_name: string;
  data: Record<string, unknown> | null;
  notes: string | null;
  decline_reason: string | null;
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
}

export function mapTicket(row: TicketRow): Ticket {
  return {
    id: row.id,
    area: row.area,
    brand: row.brand,
    title: row.title,
    campaignDate: row.campaign_date,
    status: row.status as TicketStatus,
    ownerEmail: row.owner_email,
    requesterEmail: row.requester_email,
    requesterName: row.requester_name,
    data: row.data ?? {},
    notes: row.notes ?? '',
    declineReason: row.decline_reason ?? '',
    createdAt: Number(row.created_at),
    acceptedAt: row.accepted_at === null ? null : Number(row.accepted_at),
    completedAt: row.completed_at === null ? null : Number(row.completed_at),
  };
}

export const TICKET_COLUMNS = `
  id, area, brand, title, campaign_date, status, owner_email,
  requester_email, requester_name, data, notes, decline_reason,
  created_at, accepted_at, completed_at
`;

export async function getTicket(id: string): Promise<Ticket | null> {
  const result = await query<TicketRow>(
    `SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = $1`,
    [id],
  );
  return result.rowCount ? mapTicket(result.rows[0]) : null;
}

export async function listTickets(): Promise<Ticket[]> {
  const result = await query<TicketRow>(
    `SELECT ${TICKET_COLUMNS} FROM tickets ORDER BY created_at DESC`,
  );
  return result.rows.map(mapTicket);
}

/* ------------------------------------------------------------------ */
/* Audit & activity writers (spec §17, §18)                            */
/* ------------------------------------------------------------------ */

export interface Actor {
  name: string;
  email: string;
}

export const SYSTEM_ACTOR: Actor = { name: 'System', email: 'system' };

/**
 * Writes an audit row. Passing a stable `id` makes the write idempotent, which
 * is how duplicate SLA escalations are prevented (spec §16.4).
 */
export async function writeAudit(
  ticketId: string,
  action: string,
  actor: Actor,
  details: Record<string, unknown> = {},
  id?: string,
): Promise<void> {
  await query(
    `INSERT INTO ticket_audit (id, ticket_id, action, actor_name, actor_email, details, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO NOTHING`,
    [
      id ?? crypto.randomUUID(),
      ticketId,
      action,
      actor.name,
      actor.email,
      JSON.stringify(details),
      Date.now(),
    ],
  );
}

export async function writeEvent(
  type: string,
  title: string,
  message: string,
  ticketId: string | null,
  area: string | null,
  id?: string,
): Promise<void> {
  await query(
    `INSERT INTO activity_events (id, type, title, message, ticket_id, area, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO NOTHING`,
    [id ?? crypto.randomUUID(), type, title, message, ticketId, area, Date.now()],
  );
}

export async function listAudit(ticketId: string): Promise<AuditEntry[]> {
  const result = await query<{
    id: string;
    ticket_id: string;
    action: string;
    actor_name: string;
    actor_email: string;
    details: Record<string, unknown> | null;
    created_at: string;
  }>(
    `SELECT id, ticket_id, action, actor_name, actor_email, details, created_at
     FROM ticket_audit WHERE ticket_id = $1 ORDER BY created_at ASC`,
    [ticketId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    ticketId: row.ticket_id,
    action: row.action,
    actorName: row.actor_name,
    actorEmail: row.actor_email,
    details: row.details ?? {},
    createdAt: Number(row.created_at),
  }));
}

export async function listEventsSince(since: number, limit = 20): Promise<ActivityEvent[]> {
  const result = await query<{
    id: string;
    type: string;
    title: string;
    message: string;
    ticket_id: string | null;
    area: string | null;
    created_at: string;
  }>(
    `SELECT id, type, title, message, ticket_id, area, created_at
     FROM activity_events WHERE created_at > $1 ORDER BY created_at ASC LIMIT $2`,
    [since, limit],
  );
  return result.rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    ticketId: row.ticket_id,
    area: row.area,
    createdAt: Number(row.created_at),
  }));
}

/* ------------------------------------------------------------------ */
/* Scheduled → Done + SLA escalation (spec §15.6, §16)                 */
/* ------------------------------------------------------------------ */

/**
 * Runs on every ticket-list request (spec §25 — there is no separate cron
 * worker). Converts due Scheduled tickets to Done and raises acceptance /
 * completion escalations exactly once per ticket and escalation type.
 */
export async function processDueAndEscalations(): Promise<void> {
  const now = Date.now();
  const today = todayKey(now);

  // 1. Scheduled requests whose campaign date has arrived become Done.
  const due = await query<TicketRow>(
    `SELECT ${TICKET_COLUMNS} FROM tickets WHERE status = 'Scheduled' AND campaign_date <= $1`,
    [today],
  );

  for (const row of due.rows) {
    await query(`UPDATE tickets SET status = 'Done', completed_at = $2 WHERE id = $1`, [
      row.id,
      now,
    ]);
    await writeAudit(
      row.id,
      'Automatically completed',
      SYSTEM_ACTOR,
      { from: 'Scheduled', to: 'Done', campaignDate: row.campaign_date },
      `auto-done-${row.id}`,
    );
    await writeEvent(
      'ticket.updated',
      'Request completed automatically',
      `${tabName(row.area)} · ${row.id} · ${row.title}`,
      row.id,
      row.area,
      `auto-done-event-${row.id}`,
    );
  }

  // 2. Acceptance SLA — still New more than 24h after submission (spec §16.1).
  const lateAcceptance = await query<TicketRow>(
    `SELECT ${TICKET_COLUMNS} FROM tickets WHERE status = 'New' AND created_at < $1`,
    [now - ACCEPTANCE_SLA_MS],
  );
  for (const row of lateAcceptance.rows) {
    await raiseEscalation(row, 'acceptance', 'Acceptance overdue', 'not accepted within 24 hours');
  }

  // 3. Completion SLA — campaign date passed while still open (spec §16.2).
  const lateCompletion = await query<TicketRow>(
    `SELECT ${TICKET_COLUMNS} FROM tickets
     WHERE status NOT IN ('Done', 'Declined') AND campaign_date < $1 AND area <> $2`,
    [today, MENU_ISSUES],
  );
  for (const row of lateCompletion.rows) {
    await raiseEscalation(row, 'completion', 'Completion overdue', 'campaign date has passed');
  }
}

async function raiseEscalation(
  row: TicketRow,
  kind: 'acceptance' | 'completion',
  title: string,
  reason: string,
): Promise<void> {
  const stableId = `sla-${kind}-${row.id}`;
  await writeAudit(
    row.id,
    'SLA escalation',
    SYSTEM_ACTOR,
    { kind, reason, status: row.status },
    stableId,
  );
  await writeEvent(
    'sla.escalation',
    title,
    `${tabName(row.area)} · ${row.id} · ${row.title} — ${reason}`,
    row.id,
    row.area,
    `${stableId}-event`,
  );
}

/* ------------------------------------------------------------------ */
/* Workflow guards (spec §15)                                          */
/* ------------------------------------------------------------------ */

/**
 * Done is only reachable on or after the campaign date, except for Menu Issues
 * and except for administrators (spec §15.5).
 */
export function canMarkDone(ticket: Ticket, isAdmin: boolean, now = Date.now()): boolean {
  if (ticket.area === MENU_ISSUES) return true;
  if (isAdmin) return true;
  return dateReached(ticket.campaignDate, now);
}

/** Scheduled applies only to non-Menu-Issue requests before the campaign date. */
export function canSchedule(ticket: Ticket, now = Date.now()): boolean {
  if (ticket.area === MENU_ISSUES) return false;
  return !dateReached(ticket.campaignDate, now);
}
