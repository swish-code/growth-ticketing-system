import { Router } from 'express';
import { resolveViewer } from '../auth';
import { countUnread, listNotifications, listNotificationsSince, markAllRead, markRead } from '../notifications';

export const notificationsRouter = Router();

notificationsRouter.get('/', async (req, res) => {
  const viewer = await resolveViewer(req);
  if (!viewer) return res.status(401).json({ error: 'Not signed in.' });

  if (req.query.since !== undefined) {
    const since = Number(req.query.since);
    const notifications = await listNotificationsSince(viewer.email, Number.isFinite(since) ? since : 0);
    return res.json({ notifications, now: Date.now() });
  }

  const [notifications, unread] = await Promise.all([
    listNotifications(viewer.email),
    countUnread(viewer.email),
  ]);
  return res.json({ notifications, unread });
});

notificationsRouter.post('/', async (req, res) => {
  const viewer = await resolveViewer(req);
  if (!viewer) return res.status(401).json({ error: 'Not signed in.' });

  const action = String(req.body?.action ?? '');
  if (action === 'markRead') {
    const id = String(req.body?.id ?? '');
    if (!id) return res.status(400).json({ error: 'Missing notification id.' });
    await markRead(id, viewer.email);
    return res.json({ ok: true });
  }
  if (action === 'markAllRead') {
    await markAllRead(viewer.email);
    return res.json({ ok: true });
  }
  return res.status(400).json({ error: 'Unknown action.' });
});
