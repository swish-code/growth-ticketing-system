import { Router, type Request, type Response } from 'express';
import {
  MENU_ISSUES,
  canManage,
  canUseBrand,
  deriveCampaignDate,
  deriveTitle,
  getTab,
  hasFormAccess,
  hasSubmissionAccess,
  tabAccess,
  tabName,
  todayKey,
  type Ticket,
  type Viewer,
} from '../../shared/spec';
import { resolveViewer } from '../auth';
import { nextTicketNumber, query } from '../db';
import { loadFormSettings } from '../forms';
import {
  TICKET_COLUMNS,
  canMarkDone,
  canSchedule,
  getTicket,
  listAudit,
  listTickets,
  mapTicket,
  processDueAndEscalations,
  writeAudit,
  writeEvent,
  type TicketRow,
} from '../tickets';
import { validateSubmission } from '../validate';
import { notifyTicketEvent } from '../mailer';

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

  const settings = await loadFormSettings();
  const result = validateSubmission(tab, req.body?.data ?? {}, settings, viewer.isAdmin);
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
  if (created) notifyTicketEvent('created', created, { name: viewer.name, email: viewer.email });
  return res.json({ ticket: created });
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
    if (declined) notifyTicketEvent('declined', declined, actor, reason);
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
    if (scheduled) notifyTicketEvent('scheduled', scheduled, actor);
    return res.json({ ticket: scheduled });
  }

  /* -------------------------------- done -------------------------------- */
  if (op === 'done') {
    if (ticket.status === 'Done') return res.status(409).json({ error: 'Already completed.' });
    if (ticket.status === 'Declined') {
      return res.status(409).json({ error: 'A declined request cannot be completed.' });
    }
    if (!canMarkDone(ticket, viewer.isAdmin, now)) {
      return res.status(400).json({
        error: `Done is available from ${ticket.campaignDate}. Use Schedule until then.`,
      });
    }

    await query(
      `UPDATE tickets SET status = 'Done', completed_at = $2, owner_email = COALESCE(owner_email, $3)
       WHERE id = $1`,
      [id, now, viewer.email],
    );
    await writeAudit(id, 'Completed', actor, { from: ticket.status, to: 'Done' });
    await writeEvent(
      'ticket.updated',
      'Request completed',
      `${tabName(ticket.area)} · ${id} · ${ticket.title} — by ${viewer.name}`,
      id,
      ticket.area,
    );
    const completed = await getTicket(id);
    if (completed) notifyTicketEvent('done', completed, actor);
    return res.json({ ticket: completed });
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
    if (noted) notifyTicketEvent('updated', noted, actor, 'The staff notes were updated.');
    return res.json({ ticket: noted });
  }

  return res.status(400).json({ error: 'Unknown workflow action.' });
}

/* ------------------------------------------------------------------ */
/* DELETE — administrators only (spec §21.2)                           */
/* ------------------------------------------------------------------ */

ticketsRouter.delete('/', async (req: Request, res: Response) => {
  const viewer = await resolveViewer(req);
  if (!viewer) return res.status(401).json({ error: 'Not signed in.' });
  if (!viewer.isAdmin) return res.status(403).json({ error: 'Administrators only.' });

  const id = String(req.query.id ?? req.body?.id ?? '');
  const ticket = await getTicket(id);
  if (!ticket) return res.status(404).json({ error: 'Request not found.' });

  await query(`DELETE FROM ticket_audit WHERE ticket_id = $1`, [id]);
  await query(`DELETE FROM tickets WHERE id = $1`, [id]);
  await writeEvent(
    'ticket.deleted',
    'Request deleted',
    `${tabName(ticket.area)} · ${id} · ${ticket.title} — by ${viewer.name}`,
    id,
    ticket.area,
  );
  notifyTicketEvent('deleted', ticket, { name: viewer.name, email: viewer.email });

  return res.json({ ok: true });
});
