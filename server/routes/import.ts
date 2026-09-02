import { Router } from 'express';
import { getTab } from '../../shared/spec';
import { resolveViewer } from '../auth';
import { loadFormSettings } from '../forms';
import { importTickets } from '../import';

export const importRouter = Router();

/** Bulk ticket import from CSV — administrators only (spec: same gate as CSV export/tracking). */
importRouter.post('/', async (req, res) => {
  const viewer = await resolveViewer(req);
  if (!viewer) return res.status(401).json({ error: 'Not signed in.' });
  if (!viewer.isAdmin) return res.status(403).json({ error: 'Administrators only.' });

  const area = String(req.body?.area ?? '');
  const tab = getTab(area);
  if (!tab) return res.status(400).json({ error: 'Unknown request tab.' });

  const csv = req.body?.csv;
  if (typeof csv !== 'string' || !csv.trim()) {
    return res.status(400).json({ error: 'No CSV content received.' });
  }

  try {
    const settings = await loadFormSettings();
    const result = await importTickets(tab, csv, settings, { name: viewer.name, email: viewer.email });
    return res.json(result);
  } catch (error) {
    console.error('[import]', error);
    return res.status(500).json({ error: 'Import failed. Please try again.' });
  }
});
