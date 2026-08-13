import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response } from 'express';
import {
  ADMIN_ROLE_ID,
  COMPANY_DOMAIN,
  OWNER_EMAIL,
  adminPermissions,
  emptyPermissions,
  normalizePermissions,
  type RolePermissions,
  type Viewer,
} from '../shared/spec';
import { query } from './db';

/* ------------------------------------------------------------------ */
/* Password hashing (spec §4.5)                                        */
/* ------------------------------------------------------------------ */

const ITERATIONS = 60_000;
const LEGACY_ITERATIONS = 150_000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

export interface PasswordHash {
  hash: string;
  salt: string;
  iterations: number;
}

const pbkdf2 = promisify(crypto.pbkdf2);

/**
 * Async on purpose: the sync variant blocks the event loop for the whole
 * derivation, so concurrent sign-ins would queue behind each other.
 */
export async function hashPassword(
  password: string,
  salt?: string,
  iterations = ITERATIONS,
): Promise<PasswordHash> {
  const usedSalt = salt ?? crypto.randomBytes(16).toString('hex');
  const derived = await pbkdf2(password, usedSalt, iterations, KEY_LENGTH, DIGEST);
  return { hash: derived.toString('hex'), salt: usedSalt, iterations };
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const iterations = stored.iterations || LEGACY_ITERATIONS;
  const candidate = await hashPassword(password, stored.salt, iterations);
  const a = Buffer.from(candidate.hash, 'hex');
  const b = Buffer.from(stored.hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** A legacy 150k-iteration hash is accepted then migrated (spec §4.5). */
export function needsMigration(stored: PasswordHash): boolean {
  return (stored.iterations || LEGACY_ITERATIONS) !== ITERATIONS;
}

/* ------------------------------------------------------------------ */
/* Email rules (spec §4.1)                                             */
/* ------------------------------------------------------------------ */

export function normalizeEmail(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

export function isCompanyEmail(email: string): boolean {
  if (!email.endsWith(COMPANY_DOMAIN)) return false;
  const local = email.slice(0, -COMPANY_DOMAIN.length);
  return local.length > 0 && !local.includes('@');
}

export function isOwner(email: string): boolean {
  return normalizeEmail(email) === OWNER_EMAIL;
}

/* ------------------------------------------------------------------ */
/* Sessions (spec §4.4)                                                */
/* ------------------------------------------------------------------ */

export const SESSION_COOKIE = 'gts_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createSession(email: string): Promise<string> {
  const id = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  await query(
    `INSERT INTO sessions (id, email, expires_at, created_at) VALUES ($1, $2, $3, $4)`,
    [id, email, now + SESSION_TTL_MS, now],
  );
  return id;
}

export async function deleteSession(id: string): Promise<void> {
  await query(`DELETE FROM sessions WHERE id = $1`, [id]);
}

export async function deleteSessionsForEmail(email: string): Promise<void> {
  await query(`DELETE FROM sessions WHERE email = $1`, [email]);
}

export function setSessionCookie(res: Response, id: string): void {
  res.cookie(SESSION_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

/* ------------------------------------------------------------------ */
/* Viewer resolution                                                   */
/* ------------------------------------------------------------------ */

interface AccountRow {
  email: string;
  name: string;
  brands: string[] | null;
  must_set_password: boolean;
}

interface StaffRow {
  email: string;
  name: string;
  role_id: string | null;
  is_admin: boolean;
}

interface RoleRow {
  id: string;
  name: string;
  permissions: unknown;
}

/**
 * Effective permissions are read from the CURRENTLY assigned role at request
 * time, so editing a role instantly changes every staff member on it
 * (spec §5.8).
 */
export async function resolveViewer(req: Request): Promise<Viewer | null> {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (!sessionId) return null;

  const session = await query<{ email: string; expires_at: string }>(
    `SELECT email, expires_at FROM sessions WHERE id = $1`,
    [sessionId],
  );
  if (!session.rowCount) return null;
  if (Number(session.rows[0].expires_at) < Date.now()) {
    await deleteSession(sessionId);
    return null;
  }

  return resolveViewerByEmail(session.rows[0].email);
}

/**
 * Same resolution without the session lookup — used right after sign-in, where
 * the account is already known and re-reading the session it just created
 * would be a wasted round trip.
 */
export async function resolveViewerByEmail(email: string): Promise<Viewer | null> {
  const account = await query<AccountRow>(
    `SELECT email, name, brands, must_set_password FROM accounts WHERE email = $1`,
    [email],
  );
  if (!account.rowCount) return null;

  const staff = await query<StaffRow>(
    `SELECT email, name, role_id, is_admin FROM staff WHERE email = $1`,
    [email],
  );
  const staffRow = staff.rows[0];

  const owner = isOwner(email);
  const isAdmin = owner || Boolean(staffRow?.is_admin);

  let permissions: RolePermissions = emptyPermissions();
  let roleId: string | null = staffRow?.role_id ?? null;
  let roleName: string | null = null;

  if (isAdmin) {
    permissions = adminPermissions();
    roleId = ADMIN_ROLE_ID;
    roleName = 'Admin';
  } else if (roleId) {
    const role = await query<RoleRow>(`SELECT id, name, permissions FROM roles WHERE id = $1`, [
      roleId,
    ]);
    if (role.rowCount) {
      permissions = normalizePermissions(role.rows[0].permissions);
      roleName = role.rows[0].name;
    }
  }

  return {
    email,
    name: staffRow?.name || account.rows[0].name || email,
    isAdmin,
    permissions,
    roleId,
    roleName,
    brands: Array.isArray(account.rows[0].brands) ? account.rows[0].brands : [],
  };
}
