import {
  MENU_ISSUES,
  csvColumnsFor,
  priorityTargetMs,
  todayKey,
  toDateKey,
  type RequestEligibility,
  type TabDef,
  type Ticket,
} from '../../shared/spec';

/* ------------------------------- dates -------------------------------- */

export function formatDate(ms: number | null | undefined): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatTime(ms: number | null | undefined): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return '—';
  return `${formatDate(ms)} · ${formatTime(ms)}`;
}

export function formatDateKey(key: string | null | undefined): string {
  if (!key) return '—';
  const parsed = new Date(`${key}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? key : formatDate(parsed.getTime());
}

/** "2h 15m" / "3d 4h" — used for response times and SLA countdowns. */
export function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  const minutes = Math.floor(abs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days >= 1) return `${days}d ${hours % 24}h`;
  if (hours >= 1) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

/* ------------------------------ statuses ------------------------------ */

export function statusClass(status: string): string {
  switch (status) {
    case 'New':
      return 'badge badge-new';
    case 'In progress':
      return 'badge badge-progress';
    case 'Scheduled':
      return 'badge badge-scheduled';
    case 'Done':
      return 'badge badge-done';
    case 'Declined':
      return 'badge badge-declined';
    default:
      return 'badge';
  }
}

export function priorityClass(priority: string): string {
  switch (priority) {
    case 'High':
      return 'badge badge-high';
    case 'Medium':
      return 'badge badge-medium';
    case 'Low':
      return 'badge badge-low';
    default:
      return 'badge';
  }
}

/* -------------------------- Menu Issues SLA --------------------------- */

export interface MenuIssueSla {
  priority: string;
  targetMs: number;
  /** Milliseconds left before the target (negative when overdue). */
  remainingMs: number;
  overdue: boolean;
  /** Set once the request is Done. */
  completedInMs: number | null;
  withinTarget: boolean | null;
}

export function menuIssueSla(ticket: Ticket, now = Date.now()): MenuIssueSla | null {
  if (ticket.area !== MENU_ISSUES) return null;
  const priority = String(ticket.data.Priority ?? '');
  const targetMs = priorityTargetMs(priority);
  if (targetMs === null) return null;

  const deadline = ticket.createdAt + targetMs;

  if (ticket.completedAt) {
    const completedInMs = ticket.completedAt - ticket.createdAt;
    return {
      priority,
      targetMs,
      remainingMs: deadline - ticket.completedAt,
      overdue: completedInMs > targetMs,
      completedInMs,
      withinTarget: completedInMs <= targetMs,
    };
  }

  return {
    priority,
    targetMs,
    remainingMs: deadline - now,
    overdue: now > deadline,
    completedInMs: null,
    withinTarget: null,
  };
}

/* ------------------------------ CSV export ---------------------------- */

/** Blocks spreadsheet formula injection (spec §19.2). */
function csvCell(value: unknown): string {
  let text = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Triggers a browser download of a UTF-8 CSV (BOM'd so Arabic reads correctly in Excel). */
function downloadCsv(rows: unknown[][], filename: string): void {
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportCsv(tab: TabDef, tickets: Ticket[]): void {
  const fieldLabels = tab.fields.map((f) => f.label);
  const header = csvColumnsFor(tab);

  const rows = tickets.map((ticket) => [
    ticket.id,
    tab.name,
    toDateKey(ticket.createdAt),
    formatTime(ticket.createdAt),
    ticket.requesterName,
    ticket.requesterEmail,
    ticket.status,
    ticket.ownerEmail ?? '',
    ticket.notes,
    ...fieldLabels.map((label) => ticket.data[label] ?? ''),
  ]);

  downloadCsv(
    [header, ...rows],
    `${tab.name.toLowerCase().replace(/\s+/g, '-')}-${toDateKey(Date.now())}.csv`,
  );
}

/** One plausible example value per field, so a downloaded template shows the expected format. */
function exampleValueFor(field: TabDef['fields'][number]): string {
  if (field.type === 'multi') return (field.options ?? []).slice(0, 2).join(' | ') || 'Example';
  if (field.type === 'select') return field.options?.[0] ?? 'Example';
  if (field.type === 'date') return todayKey();
  if (field.type === 'number') return '100';
  if (field.type === 'url') return 'https://example.com/image.jpg';
  return `Example ${field.label}`;
}

/**
 * Downloadable CSV template for bulk import: the exact same columns as
 * export (spec: import must offer every field export offers, nothing
 * extra), plus one filled-in example row so the format is unambiguous.
 * Request ID is left blank on the example row — the admin fills in their
 * own id, it is never auto-generated on import.
 */
export function downloadImportTemplate(tab: TabDef): void {
  const header = csvColumnsFor(tab);
  const example = [
    '',
    tab.name,
    todayKey(),
    '09:00',
    'Jane Doe',
    'jane@swishhh.net',
    'Done',
    'jane@swishhh.net',
    'Optional staff note',
    ...tab.fields.map(exampleValueFor),
  ];

  downloadCsv(
    [header, example],
    `${tab.name.toLowerCase().replace(/\s+/g, '-')}-import-template.csv`,
  );
}

/* --------------------------- request frequency -------------------------- */

/** Short line for banners: "Last request: … · Next allowed: …" or eligible. */
export function eligibilitySummary(e: RequestEligibility): string {
  if (e.lastRequestAt === null) return 'No previous request in this tab yet — you can submit now.';
  if (e.eligible) return `Last request: ${formatDateTime(e.lastRequestAt)} · You can submit now.`;
  return `Last request: ${formatDateTime(e.lastRequestAt)} · Next allowed: ${formatDateTime(e.nextEligibleAt)}`;
}

/** Full explanatory sentence for the blocking case, used inside the form. */
export function eligibilityBlockedMessage(e: RequestEligibility, tabLabel: string): string {
  return (
    `You can submit your next ${tabLabel} request on ${formatDateTime(e.nextEligibleAt)}. ` +
    `Your previous request was on ${formatDateTime(e.lastRequestAt)} ` +
    `(${e.cooldownDays}-day waiting period).`
  );
}

/* ------------------------------- values ------------------------------- */

export function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value === undefined || value === null || value === '') return '—';
  return String(value);
}
