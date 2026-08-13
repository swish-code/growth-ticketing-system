import { Router, type Request, type Response } from 'express';
import { allowedBrands } from '../../shared/spec';
import { query } from '../db';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  deleteSession,
  hashPassword,
  isCompanyEmail,
  needsMigration,
  normalizeEmail,
  resolveViewer,
  resolveViewerByEmail,
  setSessionCookie,
  verifyPassword,
} from '../auth';

export const authRouter = Router();

const MIN_PASSWORD = 8;

function publicUser(viewer: NonNullable<Awaited<ReturnType<typeof resolveViewer>>>) {
  return {
    email: viewer.email,
    name: viewer.name,
    isAdmin: viewer.isAdmin,
    roleId: viewer.roleId,
    roleName: viewer.roleName,
    permissions: viewer.permissions,
    brands: viewer.brands,
    allowedBrands: allowedBrands(viewer),
  };
}

authRouter.get('/', async (req, res) => {
  const viewer = await resolveViewer(req);
  res.json({ user: viewer ? publicUser(viewer) : null });
});

authRouter.post('/', async (req, res) => {
  const action = String(req.body?.action ?? '');

  try {
    switch (action) {
      case 'register':
        // Self-registration is disabled: only administrators create accounts,
        // from Admin panel → Staff access.
        return res.status(403).json({
          error: 'Accounts are created by administrators only. Ask an administrator to add you.',
        });
      case 'login':
        return await handleLogin(req, res);
      case 'logout':
        return await handleLogout(req, res);
      case 'updateName':
        return await handleUpdateName(req, res);
      case 'changePassword':
        return await handleChangePassword(req, res);
      default:
        return res.status(400).json({ error: 'Unknown action.' });
    }
  } catch (error) {
    console.error('[auth]', action, error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* --------------------------------- login -------------------------------- */

async function handleLogin(req: Request, res: Response): Promise<Response> {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password ?? '');

  if (!isCompanyEmail(email)) {
    return res.status(400).json({ error: 'Email must be a valid @swishhh.net company address.' });
  }
  if (password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` });
  }

  const account = await query<{
    email: string;
    password_hash: string | null;
    password_salt: string | null;
    password_iterations: number | null;
    must_set_password: boolean;
  }>(
    `SELECT email, password_hash, password_salt, password_iterations, must_set_password
     FROM accounts WHERE email = $1`,
    [email],
  );

  if (!account.rowCount) {
    return res.status(404).json({
      error: 'No account found for this email. Ask an administrator to add you as staff.',
    });
  }

  const row = account.rows[0];
  const firstOrReset = row.must_set_password || !row.password_hash || !row.password_salt;

  if (firstOrReset) {
    // First login after admin creation or a password reset stores the password
    // the staff member typed (spec §4.3 / §4.7).
    const { hash, salt, iterations } = await hashPassword(password);
    await query(
      `UPDATE accounts
       SET password_hash = $2, password_salt = $3, password_iterations = $4, must_set_password = FALSE
       WHERE email = $1`,
      [email, hash, salt, iterations],
    );
  } else {
    const stored = {
      hash: row.password_hash as string,
      salt: row.password_salt as string,
      iterations: row.password_iterations ?? 0,
    };
    if (!(await verifyPassword(password, stored))) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }
    if (needsMigration(stored)) {
      const migrated = await hashPassword(password);
      await query(
        `UPDATE accounts SET password_hash = $2, password_salt = $3, password_iterations = $4 WHERE email = $1`,
        [email, migrated.hash, migrated.salt, migrated.iterations],
      );
    }
  }

  const sessionId = await createSession(email);
  setSessionCookie(res, sessionId);

  const viewer = await resolveViewerByEmail(email);
  return res.json({ user: viewer ? publicUser(viewer) : null });
}

/* -------------------------------- logout -------------------------------- */

async function handleLogout(req: Request, res: Response): Promise<Response> {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (sessionId) await deleteSession(sessionId);
  clearSessionCookie(res);
  // "storage" already clears cookies, localStorage, sessionStorage, IndexedDB
  // and Cache Storage — every place user data can live. "cache" is deliberately
  // omitted: it only evicts the fingerprinted JS/CSS, which holds no user data,
  // and forced a full re-download on every logout.
  res.setHeader('Clear-Site-Data', '"storage"');
  return res.json({ ok: true });
}

/* ------------------------------ updateName ------------------------------ */

async function handleUpdateName(req: Request, res: Response): Promise<Response> {
  const viewer = await resolveViewer(req);
  if (!viewer) return res.status(401).json({ error: 'Not signed in.' });

  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required.' });

  await query(`UPDATE accounts SET name = $2 WHERE email = $1`, [viewer.email, name]);
  await query(`UPDATE staff SET name = $2 WHERE email = $1`, [viewer.email, name]);

  const updated = await resolveViewerByEmail(viewer.email);
  return res.json({ user: updated ? publicUser(updated) : null });
}

/* ---------------------------- changePassword ---------------------------- */

async function handleChangePassword(req: Request, res: Response): Promise<Response> {
  const viewer = await resolveViewer(req);
  if (!viewer) return res.status(401).json({ error: 'Not signed in.' });

  const currentPassword = String(req.body?.currentPassword ?? '');
  const newPassword = String(req.body?.newPassword ?? '');

  if (newPassword.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD} characters.` });
  }

  const account = await query<{
    password_hash: string | null;
    password_salt: string | null;
    password_iterations: number | null;
  }>(
    `SELECT password_hash, password_salt, password_iterations FROM accounts WHERE email = $1`,
    [viewer.email],
  );
  if (!account.rowCount) return res.status(404).json({ error: 'Account not found.' });

  const row = account.rows[0];
  if (row.password_hash && row.password_salt) {
    const ok = await verifyPassword(currentPassword, {
      hash: row.password_hash,
      salt: row.password_salt,
      iterations: row.password_iterations ?? 0,
    });
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  const { hash, salt, iterations } = await hashPassword(newPassword);
  await query(
    `UPDATE accounts
     SET password_hash = $2, password_salt = $3, password_iterations = $4, must_set_password = FALSE
     WHERE email = $1`,
    [viewer.email, hash, salt, iterations],
  );

  return res.json({ ok: true });
}
