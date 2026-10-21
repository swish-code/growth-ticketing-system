import { useMemo, useState } from 'react';
import {
  STATUSES,
  addDaysKey,
  minLeadDaysFor,
  primaryDateField,
  ticketDateSpan,
  toDateKey,
  todayKey,
  type TabDef,
  type Ticket,
} from '../../shared/spec';
import type { AppUser } from '../api';
import { formatDateKey, statusClass } from '../lib/format';
import { IconAlert, IconCheck, IconChevronLeft, IconChevronRight, IconPlus } from './Icons';
import { MonthGrid, buildMonthCells, type DateBasis } from './MonthGrid';
import './calendar.css';
import './eligibility.css';

interface Props {
  user: AppUser;
  tab: TabDef;
  tickets: Ticket[];
  onOpen: (ticket: Ticket) => void;
  onCreateForDate: (dateKey: string) => void;
}

/**
 * Per-tab calendar: shows this tab's requests day by day and — per spec's
 * calendar requirement — makes it obvious whether a NEW request can be
 * created for whichever day the user selects, then lets them create it
 * pre-filled with that day.
 */
export function TabCalendar({ user, tab, tickets, onOpen, onCreateForDate }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [brand, setBrand] = useState('');
  const [status, setStatus] = useState('');
  const [basis, setBasis] = useState<DateBasis>('campaign');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const today = todayKey();
  const hasDateField = Boolean(primaryDateField(tab));
  // Menu Issues has no forward-looking date field, so "create for this day"
  // only makes sense for today — every other tab follows its own lead time.
  const earliestKey = hasDateField ? addDaysKey(minLeadDaysFor(tab)) : today;

  function dateEligible(dayKey: string): boolean {
    return hasDateField ? dayKey >= earliestKey : dayKey === today;
  }

  function moveMonth(delta: number) {
    const next = new Date(year, month + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
    setSelectedDay(null);
  }

  const areaTickets = useMemo(() => tickets.filter((t) => t.area === tab.id), [tickets, tab.id]);

  const filtered = useMemo(
    () =>
      areaTickets.filter((ticket) => {
        if (brand && !ticket.brands.includes(brand)) return false;
        if (status && ticket.status !== status) return false;
        return true;
      }),
    [areaTickets, brand, status],
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
  const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const selectedTickets = selectedDay ? (byDay.get(selectedDay) ?? []) : [];
  const selectedDateOk = selectedDay ? dateEligible(selectedDay) : false;
  const canCreateSelected = selectedDateOk;

  return (
    <div>
      <div className="filters">
        <button className="btn btn-ghost" onClick={() => moveMonth(-1)} aria-label="Previous month">
          <IconChevronLeft size={17} />
        </button>
        <strong style={{ minWidth: '9rem', textAlign: 'center' }}>{monthLabel}</strong>
        <button className="btn btn-ghost" onClick={() => moveMonth(1)} aria-label="Next month">
          <IconChevronRight size={17} />
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
        <select value={basis} onChange={(e) => setBasis(e.target.value as DateBasis)}>
          <option value="campaign">By campaign date</option>
          <option value="submitted">By submission date</option>
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

      <p className="cal-date-note">
        {hasDateField
          ? `New requests may target ${formatDateKey(earliestKey)} or later.`
          : 'Menu Issues are reported for today only — no future scheduling.'}
      </p>

      <MonthGrid
        cells={cells}
        tickets={filtered}
        basis={basis}
        today={today}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        onOpen={onOpen}
        isLocked={(key) => !dateEligible(key)}
        barTitle={(ticket) => ticket.title}
      />

      {selectedDay && (
        <div className="panel">
          <div className="cal-day-detail">
            <h2>{formatDateKey(selectedDay)}</h2>

            <span className={`cal-day-detail-status ${selectedDateOk ? 'ok' : 'blocked'}`}>
              {selectedDateOk ? <IconCheck size={16} /> : <IconAlert size={16} />}
              {hasDateField
                ? selectedDateOk
                  ? 'A valid date for a new request.'
                  : `Too soon — new requests must target ${formatDateKey(earliestKey)} or later.`
                : selectedDateOk
                  ? 'Today — Menu Issues can be reported now.'
                  : 'Menu Issues can only be reported for today.'}
            </span>

            <div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canCreateSelected}
                title={!selectedDateOk ? 'This day is not a valid target date.' : undefined}
                onClick={() => onCreateForDate(selectedDay)}
              >
                <IconPlus size={17} />
                Create request for this day
              </button>
            </div>

            {selectedTickets.length > 0 && (
              <>
                <h3 className="section-title">
                  {selectedTickets.length} request{selectedTickets.length === 1 ? '' : 's'} on this
                  day
                </h3>
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
                      <span
                        className={statusClass(ticket.status)}
                      >
                        {ticket.status}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
