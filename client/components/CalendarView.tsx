import { useMemo, useState } from 'react';
import {
  STATUSES,
  tabName,
  ticketDateSpan,
  toDateKey,
  todayKey,
  visibleTabs,
  type Ticket,
} from '../../shared/spec';
import type { AppUser } from '../api';
import { formatDateKey, statusClass } from '../lib/format';
import { IconChevronLeft, IconChevronRight } from './Icons';
import { MonthGrid, buildMonthCells, type DateBasis } from './MonthGrid';
import './calendar.css';

interface Props {
  user: AppUser;
  tickets: Ticket[];
  onOpen: (ticket: Ticket) => void;
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
        if (brand && !ticket.brands.includes(brand)) return false;
        if (status && ticket.status !== status) return false;
        return true;
      }),
    [tickets, area, brand, status],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, Ticket[]>();
    for (const ticket of filtered) {
      // A multi-day campaign (Start/End Date) keeps appearing on every day
      // it runs, not just the first — see ticketDateSpan().
      const keys = basis === 'campaign' ? ticketDateSpan(ticket) : [toDateKey(ticket.createdAt)];
      for (const key of keys) {
        const list = map.get(key);
        if (list) list.push(ticket);
        else map.set(key, [ticket]);
      }
    }
    for (const list of map.values()) list.sort((a, b) => a.id.localeCompare(b.id));
    return map;
  }, [filtered, basis]);

  const cells = useMemo(() => buildMonthCells(year, month), [year, month]);

  // Each request counts once, however many days of the month it runs for.
  const monthTotal = useMemo(() => {
    const ids = new Set<string>();
    for (const cell of cells) {
      if (!cell.inMonth) continue;
      for (const ticket of byDay.get(cell.key) ?? []) ids.add(ticket.id);
    }
    return ids.size;
  }, [cells, byDay]);

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

      <MonthGrid
        cells={cells}
        tickets={filtered}
        basis={basis}
        today={today}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        onOpen={onOpen}
        showTabPrefix={!area}
        barTitle={(ticket) => `${tabName(ticket.area)} · ${ticket.title}`}
      />

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
                <span className={statusClass(ticket.status)}>
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
