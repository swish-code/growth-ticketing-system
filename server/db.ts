import pg from 'pg';
import {
  ADMIN_ROLE_ID,
  OWNER_EMAIL,
  adminPermissions,
} from '../shared/spec';

const { Pool } = pg;

/**
 * Railway exposes the Postgres URL under different names depending on how the
 * database was attached (a referenced variable, the private network URL, or the
 * plugin default), so accept any of them.
 */
const connectionString =
  process.env.DATABASE_URL ||
  process.env.DATABASE_PRIVATE_URL ||
  process.env.DATABASE_PUBLIC_URL ||
  process.env.POSTGRES_URL ||
  process.env.PGURL;

if (!connectionString) {
  throw new Error(
    'No Postgres connection string found. Set DATABASE_URL on the service — on Railway, ' +
      'add a PostgreSQL database and reference it as ${{Postgres.DATABASE_URL}}.',
  );
}

const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);

export const pool = new Pool({
  connectionString,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX ?? 10),
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as never[]);
}

/**
 * Creates every table from spec §22 and seeds the protected Admin role and
 * owner account. Safe to run on every boot.
 */
export async function initSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS roles (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      permissions JSONB NOT NULL,
      created_at  BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS staff (
      email      TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      access     JSONB,
      role_id    TEXT,
      is_admin   BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      email               TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      primary_brand       TEXT,
      brands              JSONB NOT NULL DEFAULT '[]'::jsonb,
      password_hash       TEXT,
      password_salt       TEXT,
      password_iterations INTEGER,
      must_set_password   BOOLEAN NOT NULL DEFAULT TRUE,
      created_at          BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      email      TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id             TEXT PRIMARY KEY,
      area           TEXT NOT NULL,
      brand          TEXT NOT NULL,
      title          TEXT NOT NULL,
      campaign_date  TEXT NOT NULL,
      status         TEXT NOT NULL,
      owner_email    TEXT,
      requester_email TEXT NOT NULL,
      requester_name TEXT NOT NULL,
      data           JSONB NOT NULL DEFAULT '{}'::jsonb,
      notes          TEXT NOT NULL DEFAULT '',
      decline_reason TEXT NOT NULL DEFAULT '',
      created_at     BIGINT NOT NULL,
      accepted_at    BIGINT,
      completed_at   BIGINT
    );

    CREATE TABLE IF NOT EXISTS form_settings (
      area       TEXT PRIMARY KEY,
      settings   JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ticket_counters (
      area        TEXT PRIMARY KEY,
      next_number INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_events (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL,
      title      TEXT NOT NULL,
      message    TEXT NOT NULL DEFAULT '',
      ticket_id  TEXT,
      area       TEXT,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ticket_audit (
      id          TEXT PRIMARY KEY,
      ticket_id   TEXT NOT NULL,
      action      TEXT NOT NULL,
      actor_name  TEXT NOT NULL DEFAULT '',
      actor_email TEXT NOT NULL DEFAULT '',
      details     JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at  BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS tickets_area_idx    ON tickets (area);
    CREATE INDEX IF NOT EXISTS tickets_brand_idx   ON tickets (brand);
    CREATE INDEX IF NOT EXISTS tickets_status_idx  ON tickets (status);
    CREATE INDEX IF NOT EXISTS audit_ticket_idx    ON ticket_audit (ticket_id);
    CREATE INDEX IF NOT EXISTS events_created_idx  ON activity_events (created_at);
    CREATE INDEX IF NOT EXISTS sessions_email_idx  ON sessions (email);
  `);

  const now = Date.now();

  // Protected Admin role (spec §5.7).
  await query(
    `INSERT INTO roles (id, name, permissions, created_at)
     VALUES ($1, 'Admin', $2, $3)
     ON CONFLICT (id) DO UPDATE SET name = 'Admin', permissions = EXCLUDED.permissions`,
    [ADMIN_ROLE_ID, JSON.stringify(adminPermissions()), now],
  );

  // Protected owner staff record — always admin, always on the Admin role.
  await query(
    `INSERT INTO staff (email, name, role_id, is_admin, created_at)
     VALUES ($1, 'Owner', $2, TRUE, $3)
     ON CONFLICT (email) DO UPDATE SET role_id = $2, is_admin = TRUE`,
    [OWNER_EMAIL, ADMIN_ROLE_ID, now],
  );

  // Pending owner account: the first login sets the password (spec §4.3).
  await query(
    `INSERT INTO accounts (email, name, brands, must_set_password, created_at)
     VALUES ($1, 'Owner', '[]'::jsonb, TRUE, $2)
     ON CONFLICT (email) DO NOTHING`,
    [OWNER_EMAIL, now],
  );
}

/**
 * Atomically reserves the next sequential number for a tab (spec §14).
 * The row stores the NEXT number to hand out, so the reserved value is
 * always `returned - 1`.
 */
export async function nextTicketNumber(area: string): Promise<number> {
  const result = await query<{ next_number: number }>(
    `INSERT INTO ticket_counters (area, next_number) VALUES ($1, 2)
     ON CONFLICT (area) DO UPDATE SET next_number = ticket_counters.next_number + 1
     RETURNING next_number`,
    [area],
  );
  return result.rows[0].next_number - 1;
}
