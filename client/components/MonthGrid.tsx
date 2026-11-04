import { useMemo } from 'react';
import { getTab, shiftDateKey, ticketDateSpan, toDateKey, type Ticket } from '../../shared/spec';
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
// Every week is the same height however busy it is: day number + MAX_LANES bars
// + one line for "+N more". Cells never grow or shrink with their content.
const ROW_COUNT = MAX_LANES + 1;
const WEEK_HEIGHT = `calc(2.1rem + ${ROW_COUNT} * 1.6rem + 0.5rem)`;

const STATUS_CHIP: Record<string, string> = {
  Hold: 'chip-status-hold',
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

/** Every day a request is on the calendar (a recurring one skips the days it doesn't run). */
function ticketDays(ticket: Ticket, basis: DateBasis): Set<string> {
  return new Set(basis === 'submitted' ? [toDateKey(ticket.createdAt)] : ticketDateSpan(ticket));
}

/**
 * Lays one week out Google-Calendar style: a run of consecutive days is a single
 * bar (split only at the week edge), and a request that skips days — "only Tuesday
 * and Wednesday" — is a separate bar for each run. Bars are stacked into lanes so
 * none overlap; longer and earlier bars take the top lanes.
 */
function layoutWeek(week: DayCell[], tickets: Ticket[], basis: DateBasis): Segment[] {
  const dayBefore = shiftDateKey(week[0].key, -1);
  const dayAfter = shiftDateKey(week[6].key, 1);

  const segments: Omit<Segment, 'lane'>[] = [];
  for (const ticket of tickets) {
    const days = ticketDays(ticket, basis);
    let col = 0;
    while (col < 7) {
      if (!days.has(week[col].key)) {
        col += 1;
        continue;
      }
      const startCol = col;
      while (col + 1 < 7 && days.has(week[col + 1].key)) col += 1;
      segments.push({
        ticket,
        startCol,
        endCol: col,
        continuesLeft: startCol === 0 && days.has(dayBefore),
        continuesRight: col === 6 && days.has(dayAfter),
      });
      col += 1;
    }
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

          return (
            <div key={week[0].key} className="cal-week">
              <div
                className="cal-week-bg"
                style={{ height: WEEK_HEIGHT }}
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

              <div className="cal-week-bars" style={{ gridTemplateRows: `2.1rem repeat(${ROW_COUNT}, 1.6rem)` }}>
                {shown.map((s) => (
                  <button
                    key={`${s.ticket.id}-${week[0].key}-${s.startCol}`}
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
                      style={{ gridColumn: col + 1, gridRow: ROW_COUNT + 1 }}
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
