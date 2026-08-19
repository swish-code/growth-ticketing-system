import { useMemo, useState } from 'react';
import {
  STATUSES,
  tabName,
  toDateKey,
  todayKey,
  visibleTabs,
  type Ticket,
} from '../../shared/spec';
import type { AppUser } from '../api';
import { formatDateKey } from '../lib/format';
import { IconChevronLeft, IconChevronRight } from './Icons';
import './calendar.css';

interface Props {
  user: AppUser;
  tickets: Ticket[];
  onOpen: (ticket: Ticket) => void;
}

type DateBasis = 'campaign' | 'submitted';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_CHIPS = 3;

const STATUS_CHIP: Record<string, string> = {
  New: 'chip-status-new',
  'In progress': 'chip-status-progress',
  Scheduled: 'chip-status-scheduled',
  Done: 'chip-status-done',
  Declined: 'chip-status-declined',
};

interface DayCell {
  key: string;
  dayOfMonth: number;
  inMonth: boolean;
}

/** Weeks start on Sunday; exactly as many rows as the month needs. */
function buildMonthCells(year: number, month: number): DayCell[] {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const rows = Math.ceil((first.getDay() + daysInMonth) / 7);

  const cells: DayCell[] = [];
  const cursor = new Date(year, month, 1 - first.getDay());
  for (let i = 0; i < rows * 7; i++) {
    cells.push({
      key: toDateKey(cursor),
      dayOfMonth: cursor.getDate(),
      inMonth: cursor.getMonth() === month,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return cells;
}

export function CalendarView({ user, tickets, onOpen }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [area, setArea] = useState('');
  const [brand, setBrand] = useState('');
  const [status, setStatus] = useState('');
  const [basis, setBasis] = useState<DateBasis>('campaign');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const tabs = visibleTabs(user);
  const today = todayKey();

  function moveMonth(delta: number) {
    const next = new Date(year, month + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
    setSelectedDay(null);
  }

  const filtered = useMemo(
    () =>
      tickets.filter((ticket) => {
        if (area && ticket.area !== area) return false;
        if (brand && ticket.brand !== brand) return false;
        if (status && ticket.status !== status) return false;
        return true;
      }),
    [tickets, area, brand, status],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, Ticket[]>();
    for (const ticket of filtered) {
      const key = basis === 'campaign' ? ticket.campaignDate : toDateKey(ticket.createdAt);
      const list = map.get(key);
      if (list) list.push(ticket);
      else map.set(key, [ticket]);
    }
    for (const list of map.values()) list.sort((a, b) => a.id.localeCompare(b.id));
    return map;
  }, [filtered, basis]);

  const cells = useMemo(() => buildMonthCells(year, month), [year, month]);

  const monthTotal = useMemo(
    () =>
      cells.reduce(
        (sum, cell) => (cell.inMonth ? sum + (byDay.get(cell.key)?.length ?? 0) : sum),
        0,
      ),
    [cells, byDay],
  );

  const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const selectedTickets = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Calendar</h1>
          <p>
            {monthTotal} request{monthTotal === 1 ? '' : 's'} in {monthLabel}, placed by{' '}
            {basis === 'campaign' ? 'campaign date' : 'submission date'}.
          </p>
        </div>
        <div className="head-actions">
          <button className="btn btn-ghost" onClick={() => moveMonth(-1)} aria-label="Previous month">
            <IconChevronLeft size={17} />
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setYear(now.getFullYear());
              setMonth(now.getMonth());
              setSelectedDay(null);
            }}
          >
            Today
          </button>
          <button className="btn btn-ghost" onClick={() => moveMonth(1)} aria-label="Next month">
            <IconChevronRight size={17} />
          </button>
        </div>
      </header>

      <div className="filters">
        <select value={basis} onChange={(e) => setBasis(e.target.value as DateBasis)}>
          <option value="campaign">By campaign date</option>
          <option value="submitted">By submission date</option>
        </select>
        <select value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">All tabs</option>
          {tabs.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.name}
            </option>
          ))}
        </select>
        <select value={brand} onChange={(e) => setBrand(e.target.value)}>
          <option value="">All brands</option>
          {user.allowedBrands.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="cal-scroll">
        <div className="cal">
          <div className="cal-week-head">
            {WEEKDAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="cal-grid">
            {cells.map((cell) => {
              const dayTickets = byDay.get(cell.key) ?? [];
              const extra = dayTickets.length - MAX_CHIPS;
              return (
                <div
                  key={cell.key}
                  className={`cal-day ${cell.inMonth ? '' : 'is-out'} ${
                    cell.key === today ? 'is-today' : ''
                  } ${cell.key === selectedDay ? 'is-selected' : ''}`}
                >
                  <span className="cal-day-num">{cell.dayOfMonth}</span>
                  {dayTickets.slice(0, MAX_CHIPS).map((ticket) => (
                    <button
                      key={ticket.id}
                      type="button"
                      className={`cal-chip ${STATUS_CHIP[ticket.status] ?? ''}`}
                      title={`${ticket.id} · ${ticket.title} · ${ticket.status}`}
                      onClick={() => onOpen(ticket)}
                    >
                      <i />
                      <span>{ticket.title || ticket.id}</span>
                    </button>
                  ))}
                  {extra > 0 && (
                    <button
                      type="button"
                      className="cal-more"
                      onClick={() => setSelectedDay(cell.key)}
                    >
                      +{extra} more
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selectedDay && (
        <div className="panel">
          <h2>{formatDateKey(selectedDay)}</h2>
          <p className="muted small">
            {selectedTickets.length} request{selectedTickets.length === 1 ? '' : 's'} on this day.
          </p>
          <div className="cal-day-rows">
            {selectedTickets.map((ticket) => (
              <button
                key={ticket.id}
                type="button"
                className="cal-day-row"
                onClick={() => onOpen(ticket)}
              >
                <span className="cell-id">{ticket.id}</span>
                <span className="cal-row-title">{ticket.title}</span>
                <span className="cal-row-meta">
                  {tabName(ticket.area)} · {ticket.brand}
                </span>
                <span className={`badge badge-${ticket.status === 'In progress' ? 'progress' : ticket.status.toLowerCase()}`}>
                  {ticket.status}
                </span>
              </button>
            ))}
            {!selectedTickets.length && <p className="empty-note">Nothing on this day.</p>}
          </div>
        </div>
      )}
    </section>
  );
}
