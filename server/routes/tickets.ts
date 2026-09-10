import { Router, type Request, type Response } from 'express';
import {
  MENU_ISSUES,
  STATUSES,
  canManage,
  canUseBrand,
  computeEligibility,
  deriveCampaignDate,
  deriveTitle,
  formatDateTimeIso,
  getTab,
  hasFormAccess,
  hasSubmissionAccess,
  tabAccess,
  tabName,
  todayKey,
  type BulkActionResult,
  type Ticket,
  type TicketStatus,
  type Viewer,
} from '../../shared/spec';
import { resolveViewer } from '../auth';
import { nextTicketNumber, query } from '../db';
import { loadFormSettings } from '../forms';
import {
  TICKET_COLUMNS,
  canMarkDone,
  canSchedule,
  getLastRequestAt,
  getTicket,
  listAudit,
  listTickets,
  mapTicket,
  processDueAndEscalations,
  writeAudit,
  writeEvent,
  type Actor,
  type TicketRow,
} from '../tickets';
import { validateSubmission } from '../validate';
import { notifyTicketEvent } from '../mailer';
import { fanOutNotification } from '../notifications';

export const ticketsRouter = Router();

/* ------------------------------------------------------------------ */
/* Visibility (spec §21.2)                                             */
/* ------------------------------------------------------------------ */

function canReadTicket(viewer: Viewer, ticket: Ticket): boolean {
  if (viewer.isAdmin) return true;
  if (!hasSubmissionAccess(viewer)) return false;
  if (tabAccess(viewer, ticket.area) === 'none') return false;
  return canUseBrand(viewer, ticket.brand);
}

/* ------------------------------------------------------------------ */
/* GET — request-frequency eligibility                                 */
/* ------------------------------------------------------------------ */

ticketsRouter.get('/eligibility', async (req: Request, res: Response) => {
  const viewer = await resolveViewer(req);
  if (!viewer) return res.status(401).json({ error: 'Not signed in.' });

  const area = String(req.query.area ?? '');
  if (!getTab(area)) return res.status(400).json({ error: 'Unknown request tab.' });

  const lastRequestAt = await getLastRequestAt(viewer.email, area);
  const eligibility = computeEligibility(area, lastRequestAt, Date.now(), viewer.isAdmin);
  return res.json({ eligibility });
});

/* ------------------------------------------------------------------ */
/* GET — ticket list / audit history                                   */
/* ------------------------------------------------------------------ */

ticketsRouter.get('/', async (req: Request, res: Response) => {
  const viewer = await resolveViewer(req);
  if (!viewer) return res.status(401).json({ error: 'Not signed in.' });

  const auditId = req.query.audit ? String(req.query.audit) : null;
  if (auditId) {
    const ticket = await getTicket(auditId);
    if (!ticket) return res.status(404).json({ error: 'Request not found.' });
    if (!canReadTicket(viewer, ticket)) {
      return res.status(403).json({ error: 'You do not have access to this request.' });
    }
    return res.json({ audit: await listAudit(auditId) });
  }

  // Scheduled conversion + SLA generation happen here (spec §25).
  await processDueAndEscalations();

  const all = await listTickets();
  const tickets = viewer.isAdmin ? all : all.filter((t) => canReadTicket(viewer, t));
  return res.json({ tickets });
});

/* ------------------------------------------------------------------ */
/* POST / PATCH — create & workflow update                             */
/* ------------------------------------------------------------------ */

async function handleWrite(req: Request, res: Response): Promise<Response> {
  const viewer = await resolveViewer(req);
  if (!viewer) return res.status(401).json({ error: 'Not signed in.' });

  const action = String(req.body?.action ?? 'create');
  try {
    if (action === 'create') return await createTicket(req, res, viewer);
    if (action === 'update') return await updateTicket(req, res, viewer);
    if (action === 'edit') return await editTicket(req, res, viewer);
    if (action === 'correctStatus') return await correctStatus(req, res, viewer);
    if (action === 'bulk') return await bulkAction(req, res, viewer);
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (error) {
    console.error('[tickets]', action, error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}

ticketsRouter.post('/', handleWrite);
ticketsRouter.patch('/', handleWrite);

async function createTicket(req: Request, res: Response, viewer: Viewer): Promise<Response> {
  const area = String(req.body?.area ?? '');
  const tab = getTab(area);
  if (!tab) return res.status(400).json({ error: 'Unknown request tab.' });

  if (!hasFormAccess(viewer)) {
    return res.status(403).json({ error: 'Your role does not allow creating requests.' });
  }
  if (tabAccess(viewer, area) === 'none') {
    return res.status(403).json({ error: 'Your role does not have access to this tab.' });
  }

  // Request-frequency cooldown: cannot be bypassed from the frontend — this is
  // the authoritative check regardless of what GET /eligibility last reported.
  if (!viewer.isAdmin) {
    const lastRequestAt = await getLastRequestAt(viewer.email, area);
    const eligibility = computeEligibility(area, lastRequestAt, Date.now(), false);
    if (!eligibility.eligible && eligibility.nextEligibleAt && eligibility.lastRequestAt) {
      return res.status(429).json({
        error:
          `You can submit your next ${tab.name} request on ` +
          `${formatDateTimeIso(eligibility.nextEligibleAt)}. Your previous request was on ` +
          `${formatDateTimeIso(eligibility.lastRequestAt)} (${eligibility.cooldownDays}-day waiting period).`,
        eligibility,
      });
    }
  }

  const settings = await loadFormSettings();
  const result = validateSubmission(tab, req.body?.data ?? {}, settings);
  if ('error' in result) return res.status(400).json({ error: result.error });

  const values = result.values;
  const brand = String(values.Brand ?? '');
  if (!canUseBrand(viewer, brand)) {
    return res.status(403).json({ error: 'You do not have access to this brand.' });
  }

  const now = Date.now();
  const number = await nextTicketNumber(area);
  const id = `${tab.prefix}-${String(number).padStart(6, '0')}`;
  const title = deriveTitle(values);
  const campaignDate = deriveCampaignDate(values, todayKey(now));

  await query(
    `INSERT INTO tickets
       (id, area, brand, title, campaign_date, status, owner_email, requester_email,
        requester_name, data, notes, decline_reason, created_at)
     VALUES ($1, $2, $3, $4, $5, 'New', NULL, $6, $7, $8, '', '', $9)`,
    [id, area, brand, title, campaignDate, viewer.email, viewer.name, JSON.stringify(values), now],
  );

  await writeAudit(id, 'Request created', { name: viewer.name, email: viewer.email }, {
    fields: values,
    brand,
    campaignDate,
  });
  await writeEvent(
    'ticket.created',
    'New request submitted',
    `${tab.name} · ${id} · ${title}`,
    id,
    area,
  );

  const created = await getTicket(id);
  if (created) {
    const createdActor = { name: viewer.name, email: viewer.email };
    notifyTicketEvent('created', created, createdActor);
    await fanOutNotification('created', created, createdActor);
  }
  return res.json({ ticket: created });
}

/**
 * Corrects a mistake in an already-submitted request — a wrong campaign
 * name, a typo in a field, etc. Administrators only. Deliberately separate
 * from the workflow actions below: it only ever touches the submitted field
 * values (brand/title/campaign date/data), never status, assignment or
 * timestamps, and — unlike a fresh submission — doesn't enforce the minimum
 * campaign-date lead time, since the admin is correcting an existing record,
 * not creating a new one.
 */
async function editTicket(req: Request, res: Response, viewer: Viewer): Promise<Response> {
  if (!viewer.isAdmin) return res.status(403).json({ error: 'Administrators only.' });

  const id = String(req.body?.id ?? '');
  const ticket = await getTicket(id);
  if (!ticket) return res.status(404).json({ error: 'Request not found.' });

  const tab = getTab(ticket.area);
  if (!tab) return res.status(400).json({ error: 'Unknown request tab.' });

  const settings = await loadFormSettings();
  const result = validateSubmission(tab, req.body?.data ?? {}, settings, Date.now(), {
    enforceMinDate: false,
  });
  if ('error' in result) return res.status(400).json({ error: result.error });

  const values = result.values;
  const brand = String(values.Brand ?? '');
  const title = deriveTitle(values);
  const campaignDate = deriveCampaignDate(values, todayKey());

  await query(
    `UPDATE tickets SET brand = $2, title = $3, campaign_date = $4, data = $5 WHERE id = $1`,
    [id, brand, title, campaignDate, JSON.stringify(values)],
  );

  const actor = { name: viewer.name, email: viewer.email };
  await writeAudit(id, 'Request edited', actor, { before: ticket.data, after: values });
  await writeEvent(
    'ticket.updated',
    'Request edited',
    `${tab.name} · ${id} · ${title} — by ${viewer.name}`,
    id,
    tab.id,
  );

  const edited = await getTicket(id);
  if (edited) {
    const detail = 'Request details were edited by an administrator.';
    notifyTicketEvent('updated', edited, actor, detail);
    await fanOutNotification('updated', edited, actor, detail);
  }
  return res.json({ ticket: edited });
}

/**
 * Manually sets a request's status to correct a workflow mistake (e.g.
 * marked Done by accident). Administrators only. Deliberately a raw
 * correction, not a re-run of the normal workflow actions: unlike Mark
 * Done, it does NOT enforce the minimum-campaign-date rule (spec §15.5) —
 * this is the escape hatch for when that rule (or any other workflow gate)
 * already let a mistake happen and it needs undoing, not another gate to
 * get past. It only touches status plus the timestamps/fields that would
 * otherwise be left stale (completed_at, and — for a full reset to New —
 * owner_email/accepted_at/decline_reason).
 */
async function correctStatus(req: Request, res: Response, viewer: Viewer): Promise<Response> {
  if (!viewer.isAdmin) return res.status(403).json({ error: 'Administrators only.' });

  const id = String(req.body?.id ?? '');
  const ticket = await getTicket(id);
  if (!ticket) return res.status(404).json({ error: 'Request not found.' });

  const status = String(req.body?.status ?? '') as TicketStatus;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  if (status === ticket.status) return res.status(400).json({ error: `Already ${status}.` });
  if (status === 'Scheduled' && ticket.area === MENU_ISSUES) {
    return res.status(400).json({ error: 'Menu Issues requests cannot be Scheduled.' });
  }

  const completedAt = status === 'Done' ? (ticket.completedAt ?? Date.now()) : null;
  const ownerEmail = status === 'New' ? null : ticket.ownerEmail;
  const acceptedAt = status === 'New' ? null : ticket.acceptedAt;
  const declineReason = status === 'Declined' ? ticket.declineReason : '';

  await query(
    `UPDATE tickets SET status = $2, owner_email = $3, accepted_at = $4, completed_at = $5, decline_reason = $6
     WHERE id = $1`,
    [id, status, ownerEmail, acceptedAt, completedAt, declineReason],
  );

  const actor = { name: viewer.name, email: viewer.email };
  await writeAudit(id, 'Status corrected', actor, { from: ticket.status, to: status });
  await writeEvent(
    'ticket.updated',
    'Status corrected',
    `${tabName(ticket.area)} · ${id} · ${ticket.title} — ${ticket.status} → ${status} by ${viewer.name}`,
    id,
    ticket.area,
  );

  const corrected = await getTicket(id);
  if (corrected) {
    const detail = `Status corrected by an administrator: ${ticket.status} → ${status}.`;
    notifyTicketEvent('updated', corrected, actor, detail);
    await fanOutNotification('updated', corrected, actor, detail);
  }
  return res.json({ ticket: corrected });
}

type WorkflowOp = 'accept' | 'decline' | 'schedule' | 'done' | 'notes';

async function updateTicket(req: Request, res: Response, viewer: Viewer): Promise<Response> {
  const id = String(req.body?.id ?? '');
  const op = String(req.body?.op ?? '') as WorkflowOp;

  const ticket = await getTicket(id);
  if (!ticket) return res.status(404).json({ error: 'Request not found.' });

  if (!hasSubmissionAccess(viewer)) {
    return res.status(403).json({ error: 'Your role does not allow workflow actions.' });
  }
  if (!canManage(viewer, ticket.area)) {
    return res.status(403).json({ error: 'You need Manage access on this tab.' });
  }
  if (!canUseBrand(viewer, ticket.brand)) {
    return res.status(403).json({ error: 'You do not have access to this brand.' });
  }

  const actor = { name: viewer.name, email: viewer.email };
  const now = Date.now();

  /* ------------------------------- accept ------------------------------- */
  if (op === 'accept') {
    if (ticket.status !== 'New') {
      return res.status(409).json({ error: `This request is already ${ticket.status}.` });
    }
    // Concurrent acceptance guard (spec §15.3): the UPDATE only wins when the
    // ticket is still unassigned.
    const claimed = await query<TicketRow>(
      `UPDATE tickets
       SET status = 'In progress', owner_email = $2, accepted_at = $3
       WHERE id = $1 AND owner_email IS NULL AND status = 'New'
       RETURNING ${TICKET_COLUMNS}`,
      [id, viewer.email, now],
    );
    if (!claimed.rowCount) {
      return res.status(409).json({ error: 'Already assigned to another staff member.' });
    }
    await writeAudit(id, 'Accepted', actor, { from: ticket.status, to: 'In progress' });
    await writeAudit(id, 'Assignee changed', actor, { assignee: viewer.email });
    await writeEvent(
      'ticket.updated',
      'Request accepted',
      `${tabName(ticket.area)} · ${id} · ${ticket.title} — by ${viewer.name}`,
      id,
      ticket.area,
    );
    const accepted = mapTicket(claimed.rows[0]);
    notifyTicketEvent('accepted', accepted, actor);
    await fanOutNotification('accepted', accepted, actor);
    return res.json({ ticket: accepted });
  }

  // Every other action respects the assignment lock (spec §15.3).
  if (ticket.ownerEmail && ticket.ownerEmail !== viewer.email && !viewer.isAdmin) {
    return res.status(403).json({
      error: `This request is assigned to ${ticket.ownerEmail}.`,
    });
  }

  /* ------------------------------- decline ------------------------------ */
  if (op === 'decline') {
    const reason = String(req.body?.declineReason ?? '').trim();
    if (!reason) return res.status(400).json({ error: 'A decline reason is required.' });
    if (ticket.status === 'Done' || ticket.status === 'Declined') {
      return res.status(409).json({ error: `This request is already ${ticket.status}.` });
    }

    await query(
      `UPDATE tickets SET status = 'Declined', decline_reason = $2, owner_email = COALESCE(owner_email, $3)
       WHERE id = $1`,
      [id, reason, viewer.email],
    );
    await writeAudit(id, 'Declined', actor, { from: ticket.status, to: 'Declined', reason });
    await writeEvent(
      'ticket.updated',
      'Request declined',
      `${tabName(ticket.area)} · ${id} · ${ticket.title} — by ${viewer.name}`,
      id,
      ticket.area,
    );
    const declined = await getTicket(id);
    if (declined) {
      notifyTicketEvent('declined', declined, actor, reason);
      await fanOutNotification('declined', declined, actor, reason);
    }
    return res.json({ ticket: declined });
  }

  /* ------------------------------ schedule ------------------------------ */
  if (op === 'schedule') {
    if (ticket.area === MENU_ISSUES) {
      return res.status(400).json({ error: 'Menu Issues cannot be scheduled.' });
    }
    if (ticket.status !== 'In progress') {
      return res.status(409).json({ error: 'Only in-progress requests can be scheduled.' });
    }
    if (!canSchedule(ticket, now)) {
      return res
        .status(400)
        .json({ error: 'The campaign date has arrived — mark the request Done instead.' });
    }

    await query(`UPDATE tickets SET status = 'Scheduled' WHERE id = $1`, [id]);
    await writeAudit(id, 'Scheduled', actor, {
      from: ticket.status,
      to: 'Scheduled',
      campaignDate: ticket.campaignDate,
    });
    await writeEvent(
      'ticket.updated',
      'Request scheduled',
      `${tabName(ticket.area)} · ${id} · ${ticket.title} — completes on ${ticket.campaignDate}`,
      id,
      ticket.area,
    );
    const scheduled = await getTicket(id);
    if (scheduled) {
      notifyTicketEvent('scheduled', scheduled, actor);
      await fanOutNotification('scheduled', scheduled, actor);
    }
    return res.json({ ticket: scheduled });
  }

  /* -------------------------------- done -------------------------------- */
  if (op === 'done') {
    const result = await markTicketDone(ticket, viewer, actor);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json({ ticket: result.ticket });
  }

  /* -------------------------------- notes ------------------------------- */
  if (op === 'notes') {
    const notes = String(req.body?.notes ?? '');
    await query(`UPDATE tickets SET notes = $2 WHERE id = $1`, [id, notes]);
    await writeAudit(id, 'Staff notes updated', actor, { from: ticket.notes, to: notes });
    await writeEvent(
      'ticket.updated',
      'Staff notes updated',
      `${tabName(ticket.area)} · ${id} · ${ticket.title} — by ${viewer.name}`,
      id,
      ticket.area,
    );
    const noted = await getTicket(id);
    if (noted) {
      notifyTicketEvent('updated', noted, actor, 'The staff notes were updated.');
      await fanOutNotification('updated', noted, actor, 'The staff notes were updated.');
    }
    return res.json({ ticket: noted });
  }

  return res.status(400).json({ error: 'Unknown workflow action.' });
}

/* ------------------------------------------------------------------ */
/* Shared single-request actions — used by both the single-item routes */
/* above and the bulk endpoint below, so the two never drift apart      */
/* ------------------------------------------------------------------ */

interface ActionOk {
  ok: true;
  ticket: Ticket;
}
interface ActionFail {
  ok: false;
  status: number;
  error: string;
}
type ActionResult = ActionOk | ActionFail;

/** The exact same rules as the "Mark Done" workflow action (spec §15.5). */
async function markTicketDone(ticket: Ticket, viewer: Viewer, actor: Actor): Promise<ActionResult> {
  if (!hasSubmissionAccess(viewer)) {
    return { ok: false, status: 403, error: 'Your role does not allow workflow actions.' };
  }
  if (!canManage(viewer, ticket.area)) {
    return { ok: false, status: 403, error: 'You need Manage access on this tab.' };
  }
  if (!canUseBrand(viewer, ticket.brand)) {
    return { ok: false, status: 403, error: 'You do not have access to this brand.' };
  }
  if (ticket.ownerEmail && ticket.ownerEmail !== viewer.email && !viewer.isAdmin) {
    return { ok: false, status: 403, error: `This request is assigned to ${ticket.ownerEmail}.` };
  }
  if (ticket.status === 'Done') return { ok: false, status: 409, error: 'Already completed.' };
  if (ticket.status === 'Declined') {
    return { ok: false, status: 409, error: 'A declined request cannot be completed.' };
  }
  if (!canMarkDone(ticket)) {
    return {
      ok: false,
      status: 400,
      error: `Done is available from ${ticket.campaignDate}. Use Schedule until then.`,
    };
  }

  const now = Date.now();
  await query(
    `UPDATE tickets SET status = 'Done', completed_at = $2, owner_email = COALESCE(owner_email, $3)
     WHERE id = $1`,
    [ticket.id, now, viewer.email],
  );
  await writeAudit(ticket.id, 'Completed', actor, { from: ticket.status, to: 'Done' });
  await writeEvent(
    'ticket.updated',
    'Request completed',
    `${tabName(ticket.area)} · ${ticket.id} · ${ticket.title} — by ${viewer.name}`,
    ticket.id,
    ticket.area,
  );
  const completed = await getTicket(ticket.id);
  if (!completed) return { ok: false, status: 500, error: 'Could not reload the request.' };
  notifyTicketEvent('done', completed, actor);
  await fanOutNotification('done', completed, actor);
  return { ok: true, ticket: completed };
}

async function deleteTicketRecord(ticket: Ticket, viewer: Viewer, actor: Actor): Promise<ActionResult> {
  if (!viewer.isAdmin) return { ok: false, status: 403, error: 'Administrators only.' };

  await query(`DELETE FROM ticket_audit WHERE ticket_id = $1`, [ticket.id]);
  await query(`DELETE FROM tickets WHERE id = $1`, [ticket.id]);
  await writeEvent(
    'ticket.deleted',
    'Request deleted',
    `${tabName(ticket.area)} · ${ticket.id} · ${ticket.title} — by ${viewer.name}`,
    ticket.id,
    ticket.area,
  );
  notifyTicketEvent('deleted', ticket, actor);
  await fanOutNotification('deleted', ticket, actor);
  return { ok: true, ticket };
}

/* ------------------------------------------------------------------ */
/* DELETE — administrators only (spec §21.2)                           */
/* ------------------------------------------------------------------ */

ticketsRouter.delete('/', async (req: Request, res: Response) => {
  const viewer = await resolveViewer(req);
  if (!viewer) return res.status(401).json({ error: 'Not signed in.' });

  const id = String(req.query.id ?? req.body?.id ?? '');
  const ticket = await getTicket(id);
  if (!ticket) return res.status(404).json({ error: 'Request not found.' });

  const actor = { name: viewer.name, email: viewer.email };
  const result = await deleteTicketRecord(ticket, viewer, actor);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Bulk actions — Mark Done / Delete on several requests at once        */
/* ------------------------------------------------------------------ */

/**
 * Applies "done" or "delete" to a list of request ids, one at a time,
 * reusing the exact same per-item rules as the single-item actions above
 * (markTicketDone / deleteTicketRecord) — a bad or unauthorized id is
 * skipped and reported rather than aborting the whole batch, matching the
 * CSV import's row-independent behaviour.
 */
async function bulkAction(req: Request, res: Response, viewer: Viewer): Promise<Response> {
  const op = String(req.body?.op ?? '');
  if (op !== 'done' && op !== 'delete') {
    return res.status(400).json({ error: 'Unknown bulk action.' });
  }

  const rawIds: unknown[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = [...new Set(rawIds.map((id) => String(id)).filter(Boolean))];
  if (!ids.length) return res.status(400).json({ error: 'No requests selected.' });

  const actor = { name: viewer.name, email: viewer.email };
  const succeeded: string[] = [];
  const failed: BulkActionResult['failed'] = [];

  for (const id of ids) {
    const ticket = await getTicket(id);
    if (!ticket) {
      failed.push({ id, reason: 'Not found.' });
      continue;
    }
    const result =
      op === 'delete'
        ? await deleteTicketRecord(ticket, viewer, actor)
        : await markTicketDone(ticket, viewer, actor);
    if (result.ok) succeeded.push(id);
    else failed.push({ id, reason: result.error });
  }

  return res.json({ succeeded, failed });
}
