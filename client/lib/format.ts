import {
  MENU_ISSUES,
  priorityTargetMs,
  toDateKey,
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

export function exportCsv(tab: TabDef, tickets: Ticket[]): void {
  const fieldLabels = tab.fields.map((f) => f.label);
  const header = [
    'Request ID',
    'Tab',
    'Submitted date',
    'Submitted time',
    'Requested by',
    'Requester email',
    'Status',
    'Assignee',
    'Staff notes',
    ...fieldLabels,
  ];

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

  const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');

  // UTF-8 BOM keeps Arabic captions readable in Excel.
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${tab.name.toLowerCase().replace(/\s+/g, '-')}-${toDateKey(Date.now())}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ------------------------------- values ------------------------------- */

export function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value === undefined || value === null || value === '') return '—';
  return String(value);
}
