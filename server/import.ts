import {
  MENU_ISSUES,
  STATUSES,
  csvColumnsFor,
  deriveCampaignDate,
  deriveTitle,
  todayKey,
  type FormSettings,
  type FormValues,
  type ImportResult,
  type TabDef,
  type TicketStatus,
} from '../shared/spec';
import { parseCsv, unescapeCsvValue } from './csv';
import { query } from './db';
import type { Actor } from './tickets';
import { writeAudit } from './tickets';
import { validateSubmission } from './validate';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const ID_NUMBER_RE = /-(\d{6})$/;

/**
 * Bulk-imports historical/external tickets from a CSV whose columns match
 * `csvColumnsFor(tab)` exactly (spec: import must offer the same fields as
 * export). Column order is irrelevant — matched by header name.
 *
 * Deliberate differences from live ticket creation, all backfill-specific:
 *   - The Request ID is whatever the admin wrote, not auto-generated — old
 *     records already have ids, not necessarily in the live sequence.
 *   - No minimum campaign-date lead time (spec: importing the past is the
 *     whole point) and no request-frequency cooldown check.
 *   - Status is taken as given (New/In progress/Declined/Scheduled/Done) —
 *     history isn't replayed through the workflow.
 *   - No email or Notification Center fan-out: importing hundreds of old
 *     tickets must not flood every manager with stale "new request" alerts.
 *   - Each row still gets a single audit entry, so who imported it and when
 *     is on the record.
 *   - Rows are independent: one bad row is skipped and reported, the rest
 *     of the file still imports.
 */
export async function importTickets(
  tab: TabDef,
  csvText: string,
  settings: FormSettings,
  actor: Actor,
): Promise<ImportResult> {
  const table = parseCsv(csvText);
  if (!table.length) return { inserted: 0, errors: [{ row: 0, message: 'The file is empty.' }] };

  const header = table[0].map((h) => h.trim());
  const expected = csvColumnsFor(tab);
  const missing = expected.filter((c) => !header.includes(c));
  if (missing.length) {
    return {
      inserted: 0,
      errors: [{ row: 0, message: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.` }],
    };
  }

  const dataRows = table.slice(1);
  const result: ImportResult = { inserted: 0, errors: [] };
  const idsSeenThisFile = new Set<string>();

  for (let i = 0; i < dataRows.length; i++) {
    const rowNumber = i + 1; // 1 = first row after the header, matching what a human counts in the sheet
    const cells = dataRows[i];
    if (cells.every((c) => c.trim() === '')) continue; // a genuinely blank row — not an error, just skip

    const get = (column: string): string => {
      const idx = header.indexOf(column);
      return idx === -1 ? '' : unescapeCsvValue((cells[idx] ?? '').trim());
    };

    const error = await importRow(tab, get, settings, actor, idsSeenThisFile);
    if (error) {
      result.errors.push({ row: rowNumber, message: error });
    } else {
      result.inserted += 1;
    }
  }

  return result;
}

async function importRow(
  tab: TabDef,
  get: (column: string) => string,
  settings: FormSettings,
  actor: Actor,
  idsSeenThisFile: Set<string>,
): Promise<string | null> {
  const id = get('Request ID');
  if (!id) return 'Request ID is required.';
  if (idsSeenThisFile.has(id)) return `Request ID "${id}" is repeated earlier in this file.`;

  const tabColumn = get('Tab');
  if (tabColumn && tabColumn !== tab.name) {
    return `Tab column says "${tabColumn}", but you're importing into ${tab.name}.`;
  }

  const requesterName = get('Requested by');
  const requesterEmail = get('Requester email');
  if (!requesterName) return 'Requested by is required.';
  if (!requesterEmail || !requesterEmail.includes('@')) return 'Requester email is required.';

  const statusRaw = get('Status');
  const status = STATUSES.find((s) => s.toLowerCase() === statusRaw.toLowerCase());
  if (!status) return `Status must be one of: ${STATUSES.join(', ')}.`;
  if (status === 'Scheduled' && tab.id === MENU_ISSUES) {
    return 'Menu Issues requests cannot have a Scheduled status.';
  }

  const submittedDate = get('Submitted date');
  const submittedTime = get('Submitted time') || '00:00';
  let createdAt = Date.now();
  if (submittedDate) {
    if (!DATE_RE.test(submittedDate)) return 'Submitted date must be formatted YYYY-MM-DD.';
    if (!TIME_RE.test(submittedTime)) return 'Submitted time must be formatted HH:MM (24-hour).';
    const parsed = new Date(`${submittedDate}T${submittedTime}:00`).getTime();
    if (Number.isNaN(parsed)) return 'Submitted date/time could not be parsed.';
    createdAt = parsed;
  }

  const ownerEmail = get('Assignee') || null;
  const notes = get('Staff notes');

  const values: FormValues = {};
  for (const field of tab.fields) {
    const raw = get(field.label);
    if (raw === '') continue; // leave unset — validateSubmission applies required/visibility rules
    values[field.label] =
      field.type === 'multi'
        ? raw
            .split('|')
            .map((v) => v.trim())
            .filter(Boolean)
        : raw;
  }

  const validated = validateSubmission(tab, values, settings, createdAt, { enforceMinDate: false });
  if ('error' in validated) return validated.error;

  const brand = String(validated.values.Brand ?? '');
  const title = deriveTitle(validated.values);
  const campaignDate = deriveCampaignDate(validated.values, todayKey(createdAt));

  const existing = await query(`SELECT 1 FROM tickets WHERE id = $1`, [id]);
  if (existing.rowCount) return `Request ID "${id}" already exists.`;

  await query(
    `INSERT INTO tickets
       (id, area, brand, title, campaign_date, status, owner_email, requester_email,
        requester_name, data, notes, decline_reason, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, '', $12)`,
    [
      id,
      tab.id,
      brand,
      title,
      campaignDate,
      status as TicketStatus,
      ownerEmail,
      requesterEmail,
      requesterName,
      JSON.stringify(validated.values),
      notes,
      createdAt,
    ],
  );

  idsSeenThisFile.add(id);
  await writeAudit(id, 'Imported by admin', actor, { fields: validated.values, brand, campaignDate, status });
  await bumpCounterPast(tab, id);

  return null;
}

/**
 * If the imported id matches this tab's own PREFIX-NNNNNN pattern, advance
 * the tab's auto-numbering counter past it — otherwise a future live
 * request could collide with an id a human typed in by hand.
 */
async function bumpCounterPast(tab: TabDef, id: string): Promise<void> {
  if (!id.startsWith(`${tab.prefix}-`)) return;
  const match = id.match(ID_NUMBER_RE);
  if (!match) return;
  const imported = Number(match[1]);
  if (!Number.isFinite(imported)) return;

  await query(
    `INSERT INTO ticket_counters (area, next_number) VALUES ($1, $2)
     ON CONFLICT (area) DO UPDATE SET next_number = GREATEST(ticket_counters.next_number, $2)`,
    [tab.id, imported + 1],
  );
}
