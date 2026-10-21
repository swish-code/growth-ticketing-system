import { useMemo } from 'react';
import { getTab, ticketDateSpan, toDateKey, type Ticket } from '../../shared/spec';
import './calendar.css';

export type DateBasis = 'campaign' | 'submitted';

export interface DayCell {
  key: string;
  dayOfMonth: number;
  inMonth: boolean;
}

/** Weeks start on Sunday; exactly as many rows as the month needs. */
export function buildMonthCells(year: number, month: number): DayCell[] {
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

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_LANES = 3;

const STATUS_CHIP: Record<string, string> = {
  New: 'chip-status-new',
  'In progress': 'chip-status-progress',
  Scheduled: 'chip-status-scheduled',
  Live: 'chip-status-live',
  Done: 'chip-status-done',
  Declined: 'chip-status-declined',
};

/** One ticket's piece of one week: columns 0-6, and whether it carries on past either edge. */
interface Segment {
  ticket: Ticket;
  startCol: number;
  endCol: number;
  continuesLeft: boolean;
  continuesRight: boolean;
  lane: number;
}

function ticketRange(ticket: Ticket, basis: DateBasis): { start: string; end: string } {
  if (basis === 'submitted') {
    const day = toDateKey(ticket.createdAt);
    return { start: day, end: day };
  }
  const span = ticketDateSpan(ticket);
  return { start: span[0], end: span[span.length - 1] };
}

/**
 * Lays one week out Google-Calendar style: a multi-day request is a single
 * bar across its days (split only at the week edge), and bars are stacked
 * into lanes so none overlap. Longer and earlier bars take the top lanes.
 */
function layoutWeek(week: DayCell[], tickets: Ticket[], basis: DateBasis): Segment[] {
  const weekStart = week[0].key;
  const weekEnd = week[6].key;
  const colOf = new Map(week.map((cell, i) => [cell.key, i]));

  const segments: Omit<Segment, 'lane'>[] = [];
  for (const ticket of tickets) {
    const { start, end } = ticketRange(ticket, basis);
    if (start > weekEnd || end < weekStart) continue;
    segments.push({
      ticket,
      startCol: colOf.get(start < weekStart ? weekStart : start) ?? 0,
      endCol: colOf.get(end > weekEnd ? weekEnd : end) ?? 6,
      continuesLeft: start < weekStart,
      continuesRight: end > weekEnd,
    });
  }

  segments.sort(
    (a, b) =>
      a.startCol - b.startCol ||
      b.endCol - b.startCol - (a.endCol - a.startCol) ||
      a.ticket.id.localeCompare(b.ticket.id),
  );

  const laneEnds: number[] = [];
  return segments.map((segment) => {
    let lane = laneEnds.findIndex((end) => end < segment.startCol);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = segment.endCol;
    return { ...segment, lane };
  });
}

interface Props {
  cells: DayCell[];
  tickets: Ticket[];
  basis: DateBasis;
  today: string;
  selectedDay: string | null;
  onSelectDay: (key: string) => void;
  onOpen: (ticket: Ticket) => void;
  /** Days that cannot be targeted (per-tab calendar's lead-time window). */
  isLocked?: (key: string) => boolean;
  /** Show the tab prefix on each bar — only useful with every tab mixed together. */
  showTabPrefix?: boolean;
  barTitle: (ticket: Ticket) => string;
}

export function MonthGrid({
  cells,
  tickets,
  basis,
  today,
  selectedDay,
  onSelectDay,
  onOpen,
  isLocked,
  showTabPrefix = false,
  barTitle,
}: Props) {
  const weeks = useMemo(() => {
    const rows: DayCell[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows.map((week) => ({ week, segments: layoutWeek(week, tickets, basis) }));
  }, [cells, tickets, basis]);

  return (
    <div className="cal-scroll">
      <div className="cal">
        <div className="cal-week-head">
          {WEEKDAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>

        {weeks.map(({ week, segments }) => {
          const shown = segments.filter((s) => s.lane < MAX_LANES);
          const hiddenPerCol = new Array<number>(7).fill(0);
          for (const s of segments) {
            if (s.lane < MAX_LANES) continue;
            for (let c = s.startCol; c <= s.endCol; c++) hiddenPerCol[c] += 1;
          }
          const anyHidden = hiddenPerCol.some((n) => n > 0);
          const lanes = Math.min(MAX_LANES, segments.reduce((m, s) => Math.max(m, s.lane + 1), 0));
          const rows = lanes + (anyHidden ? 1 : 0);

          return (
            <div key={week[0].key} className="cal-week">
              <div
                className="cal-week-bg"
                style={{ minHeight: `calc(2.1rem + ${rows} * 1.6rem + 0.5rem)` }}
              >
                {week.map((cell) => {
                  const locked = isLocked?.(cell.key) ?? false;
                  return (
                    // A day cell stays a <div> so it can host the "+N more" button.
                    <div
                      key={cell.key}
                      role="button"
                      tabIndex={0}
                      className={`cal-day ${cell.inMonth ? '' : 'is-out'} ${
                        cell.key === today ? 'is-today' : ''
                      } ${cell.key === selectedDay ? 'is-selected' : ''} ${locked ? 'is-locked' : ''}`}
                      onClick={() => onSelectDay(cell.key)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectDay(cell.key);
                        }
                      }}
                    >
                      <span className="cal-day-num">{cell.dayOfMonth}</span>
                    </div>
                  );
                })}
              </div>

              <div className="cal-week-bars" style={{ gridTemplateRows: `2.1rem repeat(${rows}, 1.6rem)` }}>
                {shown.map((s) => (
                  <button
                    key={`${s.ticket.id}-${week[0].key}`}
                    type="button"
                    className={`cal-bar ${STATUS_CHIP[s.ticket.status] ?? ''} ${
                      s.continuesLeft ? 'cont-left' : ''
                    } ${s.continuesRight ? 'cont-right' : ''}`}
                    style={{ gridColumn: `${s.startCol + 1} / ${s.endCol + 2}`, gridRow: s.lane + 2 }}
                    title={`${s.ticket.id} · ${barTitle(s.ticket)} · ${s.ticket.status}`}
                    onClick={() => onOpen(s.ticket)}
                  >
                    {!s.continuesLeft && <i />}
                    {showTabPrefix && !s.continuesLeft && (
                      <span className="cal-chip-tab">{getTab(s.ticket.area)?.prefix ?? ''}</span>
                    )}
                    <span>{s.ticket.title || s.ticket.id}</span>
                  </button>
                ))}
                {hiddenPerCol.map((count, col) =>
                  count > 0 ? (
                    <button
                      key={`more-${week[col].key}`}
                      type="button"
                      className="cal-more"
                      style={{ gridColumn: col + 1, gridRow: lanes + 2 }}
                      onClick={() => onSelectDay(week[col].key)}
                    >
                      +{count} more
                    </button>
                  ) : null,
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
