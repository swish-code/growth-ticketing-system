import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import {
  ADMIN_ROLE_ID,
  TAB_IDS,
  normalizePermissions,
  type AreaFormSettings,
  type StaffMember,
} from '../../shared/spec';
import {
  deleteSessionsForEmail,
  isCompanyEmail,
  isOwner,
  normalizeEmail,
  resolveViewer,
} from '../auth';
import { query } from '../db';
import { loadFormSettings, saveFormSettings } from '../forms';

export const staffRouter = Router();
export const rolesRouter = Router();
export const formsRouter = Router();

async function requireAdmin(req: Request, res: Response) {
  const viewer = await resolveViewer(req);
  if (!viewer) {
    res.status(401).json({ error: 'Not signed in.' });
    return null;
  }
  if (!viewer.isAdmin) {
    res.status(403).json({ error: 'Administrators only.' });
    return null;
  }
  return viewer;
}

/* ------------------------------------------------------------------ */
/* /api/staff (spec §20.1, §21.3)                                      */
/* ------------------------------------------------------------------ */

staffRouter.get('/', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;

  const result = await query<{
    email: string;
    name: string;
    role_id: string | null;
    is_admin: boolean;
    created_at: string;
    must_set_password: boolean | null;
    account_email: string | null;
  }>(
    `SELECT s.email, s.name, s.role_id, s.is_admin, s.created_at,
            a.must_set_password, a.email AS account_email
     FROM staff s LEFT JOIN accounts a ON a.email = s.email
     ORDER BY s.created_at ASC`,
  );

  const staff: StaffMember[] = result.rows.map((row) => ({
    email: row.email,
    name: row.name,
    roleId: isOwner(row.email) ? ADMIN_ROLE_ID : row.role_id,
    isAdmin: isOwner(row.email) || row.is_admin,
    mustSetPassword: Boolean(row.must_set_password),
    hasAccount: Boolean(row.account_email),
    createdAt: Number(row.created_at),
  }));

  res.json({ staff });
});

staffRouter.post('/', async (req, res) => {
  const viewer = await requireAdmin(req, res);
  if (!viewer) return;

  const op = String(req.body?.op ?? '');
  const email = normalizeEmail(req.body?.email);
  if (!isCompanyEmail(email)) {
    return res.status(400).json({ error: 'Email must be a valid @swishhh.net company address.' });
  }

  try {
    if (op === 'create') {
      const name = String(req.body?.name ?? '').trim();
      const isAdmin = Boolean(req.body?.isAdmin);
      const roleId = req.body?.roleId ? String(req.body.roleId) : null;

      if (!name) return res.status(400).json({ error: 'Name is required.' });
      if (!isAdmin && !roleId) {
        return res.status(400).json({ error: 'Assign a role, or make the staff member an administrator.' });
      }

      const existing = await query(`SELECT email FROM staff WHERE email = $1`, [email]);
      if (existing.rowCount) return res.status(409).json({ error: 'This staff member already exists.' });

      const now = Date.now();
      await query(
        `INSERT INTO staff (email, name, role_id, is_admin, created_at) VALUES ($1, $2, $3, $4, $5)`,
        [email, name, isAdmin ? ADMIN_ROLE_ID : roleId, isAdmin, now],
      );
      // Pending account — the staff member sets their password on first login.
      await query(
        `INSERT INTO accounts (email, name, brands, must_set_password, created_at)
         VALUES ($1, $2, '[]'::jsonb, TRUE, $3)
         ON CONFLICT (email) DO NOTHING`,
        [email, name, now],
      );
      return res.json({ ok: true });
    }

    if (op === 'update') {
      const owner = isOwner(email);
      const name = String(req.body?.name ?? '').trim();
      const roleId = req.body?.roleId ? String(req.body.roleId) : null;
      const isAdmin = owner ? true : Boolean(req.body?.isAdmin);

      if (!name) return res.status(400).json({ error: 'Name is required.' });

      await query(
        `UPDATE staff SET name = $2, role_id = $3, is_admin = $4 WHERE email = $1`,
        [email, name, isAdmin ? ADMIN_ROLE_ID : roleId, isAdmin],
      );
      await query(`UPDATE accounts SET name = $2 WHERE email = $1`, [email, name]);
      return res.json({ ok: true });
    }

    if (op === 'reset') {
      if (isOwner(email)) {
        return res.status(403).json({
          error: 'The owner account cannot be reset here and must change its own password.',
        });
      }
      await query(
        `UPDATE accounts
         SET must_set_password = TRUE, password_hash = NULL, password_salt = NULL, password_iterations = NULL
         WHERE email = $1`,
        [email],
      );
      await deleteSessionsForEmail(email);
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (error) {
    console.error('[staff]', op, error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

staffRouter.delete('/', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;

  const email = normalizeEmail(req.query.email ?? req.body?.email);
  if (isOwner(email)) {
    return res.status(403).json({ error: 'The owner account is protected and cannot be deleted.' });
  }

  await deleteSessionsForEmail(email);
  await query(`DELETE FROM staff WHERE email = $1`, [email]);
  await query(`DELETE FROM accounts WHERE email = $1`, [email]);
  return res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* /api/roles (spec §20.2, §21.4)                                      */
/* ------------------------------------------------------------------ */

rolesRouter.get('/', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;

  const result = await query<{
    id: string;
    name: string;
    permissions: unknown;
    created_at: string;
  }>(`SELECT id, name, permissions, created_at FROM roles ORDER BY created_at ASC`);

  res.json({
    roles: result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      permissions: normalizePermissions(row.permissions),
      createdAt: Number(row.created_at),
      protected: row.id === ADMIN_ROLE_ID,
    })),
  });
});

rolesRouter.post('/', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;

  const id = req.body?.id ? String(req.body.id) : `role-${crypto.randomUUID()}`;
  const name = String(req.body?.name ?? '').trim();

  if (id === ADMIN_ROLE_ID) {
    return res.status(403).json({ error: 'The Admin role is protected and cannot be changed.' });
  }
  if (!name) return res.status(400).json({ error: 'Role name is required.' });

  const permissions = normalizePermissions(req.body?.permissions);
  const now = Date.now();

  await query(
    `INSERT INTO roles (id, name, permissions, created_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, permissions = EXCLUDED.permissions`,
    [id, name, JSON.stringify(permissions), now],
  );

  return res.json({ ok: true, id });
});

rolesRouter.delete('/', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;

  const id = String(req.query.id ?? req.body?.id ?? '');
  if (id === ADMIN_ROLE_ID) {
    return res.status(403).json({ error: 'The Admin role is protected and cannot be deleted.' });
  }

  await query(`UPDATE staff SET role_id = NULL WHERE role_id = $1`, [id]);
  await query(`DELETE FROM roles WHERE id = $1`, [id]);
  return res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* /api/forms (spec §20.4, §21.5)                                      */
/* ------------------------------------------------------------------ */

formsRouter.get('/', async (req, res) => {
  const viewer = await resolveViewer(req);
  if (!viewer) return res.status(401).json({ error: 'Not signed in.' });
  return res.json({ settings: await loadFormSettings() });
});

formsRouter.post('/', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;

  const area = String(req.body?.area ?? '');
  if (!TAB_IDS.includes(area)) return res.status(400).json({ error: 'Unknown request tab.' });

  const raw = req.body?.settings;
  if (!raw || typeof raw !== 'object') {
    return res.status(400).json({ error: 'Invalid settings payload.' });
  }

  const settings: AreaFormSettings = {};
  for (const [label, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = value as { enabled?: unknown; required?: unknown };
    settings[label] = {
      enabled: entry?.enabled !== false,
      required: Boolean(entry?.required),
    };
  }

  await saveFormSettings(area, settings);
  return res.json({ ok: true, settings: await loadFormSettings() });
});
