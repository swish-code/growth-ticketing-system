import { Router } from 'express';
import { resolveViewer } from '../auth';
import { listEventsSince } from '../tickets';

export const eventsRouter = Router();

/** Spec §21.6 — max 20 events per poll, SLA escalations are admin-only. */
eventsRouter.get('/', async (req, res) => {
  const viewer = await resolveViewer(req);
  if (!viewer) return res.status(401).json({ error: 'Not signed in.' });

  const since = Number(req.query.since ?? 0);
  const events = await listEventsSince(Number.isFinite(since) ? since : 0, 20);
  const visible = viewer.isAdmin ? events : events.filter((e) => e.type !== 'sla.escalation');

  return res.json({ events: visible, now: Date.now() });
});
