import { useEffect, useMemo, useState } from 'react';
import {
  ACCEPTANCE_SLA_MS,
  MENU_ISSUES,
  STATUSES,
  isClosed,
  toDateKey,
  todayKey,
  visibleTabs,
  type Ticket,
  type TicketStatus,
} from '../../shared/spec';
import type { AppUser } from '../api';
import { formatDateKey, formatDateTime, formatDuration, statusClass } from '../lib/format';
import { IconAlert, IconCheck, IconClock, IconClose, IconInbox } from './Icons';
import './dashboard.css';

interface Props {
  user: AppUser;
  tickets: Ticket[];
  onOpen: (ticket: Ticket) => void;
}

type Period = '7' | '30' | '90' | 'all';

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIODS: { id: Period; label: string }[] = [
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
  { id: 'all', label: 'All time' },
];

const STATUS_COLOR: Record<TicketStatus, string> = {
  Hold: 'var(--ink-muted)',
  New: 'var(--accent)',
  'In progress': 'var(--warning)',
  Declined: 'var(--critical)',
  Scheduled: 'var(--violet)',
  Live: '#ec835a',
  Done: 'var(--good)',
};

/** A request is late when its campaign date passed while it was still open. */
function isLate(ticket: Ticket, today: string): boolean {
  if (ticket.area === MENU_ISSUES) return false;
  if (ticket.status === 'Declined') return false;
  if (ticket.status === 'Done') {
    return ticket.completedAt ? toDateKey(ticket.completedAt) > ticket.campaignDate : false;
  }
  return ticket.campaignDate < today;
}

interface Drill {
  title: string;
  subtitle: string;
  tickets: Ticket[];
  /** Show how long each request has been waiting (for the SLA lists). */
  showWaiting?: boolean;
}

function initials(email: string): string {
  const name = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
  const parts = name.split(' ').filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function Dashboard({ user, tickets, onOpen }: Props) {
  const [period, setPeriod] = useState<Period>('all');
  const [brand, setBrand] = useState('');
  const [tabId, setTabId] = useState('');
  const [drill, setDrill] = useState<Drill | null>(null);
  const [hoverDay, setHoverDay] = useState<number | null>(null);

  const today = todayKey();
  const now = Date.now();
  const tabs = visibleTabs(user);

  // The 24h acceptance clock starts when the request reaches the team, so a
  // request that waited for approval is not already late the moment it's approved.
  const readyAt = (t: Ticket) => t.approvedAt ?? t.createdAt;
  const isDelayed = (t: Ticket) => t.status === 'New' && now - readyAt(t) > ACCEPTANCE_SLA_MS;
  const isOverdue = (t: Ticket) => !isClosed(t.status) && isLate(t, today);

  // Filters: tab + brand first, then the period.
  const base = useMemo(
    () =>
      tickets.filter(
        (t) => (!tabId || t.area === tabId) && (!brand || t.brands.includes(brand)),
      ),
    [tickets, tabId, brand],
  );
  const days = period === 'all' ? 0 : Number(period);
  const scoped = useMemo(
    () => (days ? base.filter((t) => t.createdAt >= now - days * DAY_MS) : base),
    [base, days, now],
  );
  const previous = useMemo(
    () =>
      days
        ? base.filter((t) => t.createdAt >= now - 2 * days * DAY_MS && t.createdAt < now - days * DAY_MS)
        : null,
    [base, days, now],
  );

  const kpi = useMemo(() => {
    const open = scoped.filter((t) => !isClosed(t.status));
    const done = scoped.filter((t) => t.status === 'Done');
    const delayed = scoped.filter(isDelayed);
    return { open, done, delayed };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped]);

  // Daily submissions for the chart and the sparklines.
  const chartDays = period === 'all' ? 90 : Math.max(7, Number(period));
  const series = useMemo(() => {
    const keys: string[] = [];
    for (let i = chartDays - 1; i >= 0; i--) keys.push(toDateKey(now - i * DAY_MS));
    const created = new Map<string, number>(keys.map((k) => [k, 0]));
    const finished = new Map<string, number>(keys.map((k) => [k, 0]));
    for (const t of base) {
      const c = toDateKey(t.createdAt);
      if (created.has(c)) created.set(c, (created.get(c) ?? 0) + 1);
      if (t.completedAt) {
        const d = toDateKey(t.completedAt);
        if (finished.has(d)) finished.set(d, (finished.get(d) ?? 0) + 1);
      }
    }
    return {
      keys,
      created: keys.map((k) => created.get(k) ?? 0),
      finished: keys.map((k) => finished.get(k) ?? 0),
    };
  }, [base, chartDays, now]);

  const statusCounts = useMemo(
    () =>
      STATUSES.map((status) => ({
        status,
        list: scoped.filter((t) => t.status === status),
      })).filter((row) => row.list.length),
    [scoped],
  );

  const attention = useMemo(() => {
    const rows = scoped
      .filter((t) => isDelayed(t) || isOverdue(t))
      .map((t) => ({
        ticket: t,
        reason: isDelayed(t) ? ('sla' as const) : ('date' as const),
        age: isDelayed(t) ? now - readyAt(t) : now - new Date(`${t.campaignDate}T00:00:00`).getTime(),
      }))
      .sort((a, b) => b.age - a.age);
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, today]);

  const byTab = useMemo(
    () =>
      tabs.map((tab) => {
        const list = scoped.filter((t) => t.area === tab.id);
        const accepted = list.filter((t) => t.acceptedAt);
        const responseMs = accepted.length
          ? accepted.reduce((sum, t) => sum + ((t.acceptedAt as number) - t.createdAt), 0) /
            accepted.length
          : null;
        return {
          tab,
          list,
          open: list.filter((t) => !isClosed(t.status)).length,
          overdue: list.filter((t) => isDelayed(t) || isOverdue(t)),
          responseMs,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabs, scoped, today],
  );

  const workload = useMemo(() => {
    const map = new Map<string, Ticket[]>();
    for (const ticket of scoped) {
      if (!ticket.ownerEmail || isClosed(ticket.status)) continue;
      map.set(ticket.ownerEmail, [...(map.get(ticket.ownerEmail) ?? []), ticket]);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [scoped]);

  const brands = useMemo(() => {
    const map = new Map<string, { list: Ticket[]; done: number; open: number; late: number }>();
    for (const ticket of scoped) {
      // A request covering several brands counts once toward each of them.
      for (const name of ticket.brands) {
        const entry = map.get(name) ?? { list: [], done: 0, open: 0, late: 0 };
        entry.list.push(ticket);
        if (ticket.status === 'Done') entry.done += 1;
        else if (!isClosed(ticket.status)) entry.open += 1;
        if (isLate(ticket, today)) entry.late += 1;
        map.set(name, entry);
      }
    }
    return [...map.entries()].sort((a, b) => b[1].list.length - a[1].list.length);
  }, [scoped, today]);

  useEffect(() => {
    if (!drill) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrill(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drill]);

  const delta =
    previous && previous.length
      ? Math.round(((scoped.length - previous.length) / previous.length) * 100)
      : null;
  const completion = scoped.length ? Math.round((kpi.done.length / scoped.length) * 100) : null;
  const maxTab = Math.max(1, ...byTab.map((r) => r.list.length));
  const maxWork = Math.max(1, ...workload.map(([, l]) => l.length));
  const periodLabel = PERIODS.find((p) => p.id === period)?.label.toLowerCase() ?? '';
  const filtered = Boolean(tabId || brand || days);

  function show(next: Drill) {
    setDrill({ ...next, tickets: [...next.tickets] });
  }

  const hover = hoverDay ?? series.keys.length - 1;
  const maxY = Math.max(1, ...series.created, ...series.finished);

  return (
    <section className="page dash">
      <header className="dash-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
            {' · '}live figures for every request you are permitted to see
          </p>
        </div>
        <div className="dash-filters">
          <div className="seg" role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={period === p.id ? 'is-on' : ''}
                aria-pressed={period === p.id}
                onClick={() => setPeriod(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <select value={tabId} onChange={(e) => setTabId(e.target.value)} aria-label="Tab">
            <option value="">All tabs</option>
            {tabs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Brand">
            <option value="">All brands</option>
            {user.allowedBrands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          {filtered && (
            <button
              type="button"
              className="dash-reset"
              onClick={() => {
                setPeriod('all');
                setTabId('');
                setBrand('');
              }}
            >
              Reset
            </button>
          )}
        </div>
      </header>

      {!tickets.length ? (
        <div className="dash-empty">
          <IconInbox size={30} />
          <h2>No requests yet</h2>
          <p>Once requests are submitted, their volume, speed and delays show up here.</p>
        </div>
      ) : (
        <>
          <div className="kpis">
            <Kpi
              index={0}
              Icon={IconInbox}
              label="Total requests"
              value={scoped.length}
              note={
                delta === null
                  ? `Across ${tabId ? 'this tab' : `${tabs.length} permitted ${tabs.length === 1 ? 'tab' : 'tabs'}`}`
                  : `${delta >= 0 ? '+' : ''}${delta}% vs the previous ${days} days`
              }
              noteTone={delta === null ? undefined : delta >= 0 ? 'up' : 'down'}
              spark={series.created}
              onClick={() =>
                show({
                  title: 'All requests',
                  subtitle: filtered ? `Created in the selected view (${periodLabel})` : 'Every request you can see',
                  tickets: scoped,
                })
              }
            />
            <Kpi
              index={1}
              Icon={IconClock}
              label="Open"
              value={kpi.open.length}
              note={scoped.length ? `${Math.round((kpi.open.length / scoped.length) * 100)}% of all requests` : '—'}
              onClick={() => show({ title: 'Open requests', subtitle: 'Still being worked on', tickets: kpi.open })}
            />
            <Kpi
              index={2}
              Icon={IconCheck}
              label="Finished"
              value={kpi.done.length}
              note={completion === null ? '—' : `${completion}% completion rate`}
              spark={series.finished}
              tone="good"
              onClick={() => show({ title: 'Finished requests', subtitle: 'Marked Done', tickets: kpi.done })}
            />
            <Kpi
              index={3}
              Icon={IconAlert}
              label="Delayed over 24h"
              value={kpi.delayed.length}
              note={kpi.delayed.length ? 'Awaiting acceptance past the SLA' : 'Every request accepted in time'}
              tone={kpi.delayed.length ? 'danger' : undefined}
              onClick={() =>
                show({
                  title: 'Delayed over 24h',
                  subtitle: 'Not accepted within 24 hours of submission — oldest first',
                  tickets: [...kpi.delayed].sort((a, b) => readyAt(a) - readyAt(b)),
                  showWaiting: true,
                })
              }
            />
          </div>

          <div className="dash-row dash-row-a">
            <article className="card" style={{ ['--i' as string]: 4 }}>
              <header className="card-head">
                <div>
                  <h2>Submissions over time</h2>
                  <p className="muted small">New requests and finished requests per day, last {chartDays} days.</p>
                </div>
                <div className="legend">
                  <span><i style={{ background: 'var(--accent)' }} />Created</span>
                  <span><i style={{ background: 'var(--good)' }} />Finished</span>
                </div>
              </header>
              <AreaChart
                keys={series.keys}
                created={series.created}
                finished={series.finished}
                maxY={maxY}
                hover={hover}
                onHover={setHoverDay}
              />
              <p className="chart-readout" aria-live="polite">
                <strong>{formatDateKey(series.keys[hover])}</strong>
                <span><i style={{ background: 'var(--accent)' }} />{series.created[hover]} created</span>
                <span><i style={{ background: 'var(--good)' }} />{series.finished[hover]} finished</span>
              </p>
            </article>

            <article className="card" style={{ ['--i' as string]: 5 }}>
              <header className="card-head">
                <div>
                  <h2>Status mix</h2>
                  <p className="muted small">Where every request stands right now.</p>
                </div>
              </header>
              <Donut
                total={scoped.length}
                slices={statusCounts.map((r) => ({
                  label: r.status,
                  value: r.list.length,
                  color: STATUS_COLOR[r.status],
                }))}
                onPick={(label) => {
                  const row = statusCounts.find((r) => r.status === label);
                  if (row) show({ title: `${label} requests`, subtitle: 'Filtered by status', tickets: row.list });
                }}
              />
            </article>
          </div>

          <div className="dash-row dash-row-b">
            <article className="card" style={{ ['--i' as string]: 6 }}>
              <header className="card-head">
                <div>
                  <h2>Needs attention</h2>
                  <p className="muted small">
                    {attention.length
                      ? `${attention.length} request${attention.length === 1 ? '' : 's'} waiting too long or past their date.`
                      : 'Nothing is past an SLA or a campaign date.'}
                  </p>
                </div>
                {attention.length > 6 && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() =>
                      show({
                        title: 'Needs attention',
                        subtitle: 'Delayed acceptance or past the campaign date — longest waiting first',
                        tickets: attention.map((a) => a.ticket),
                        showWaiting: true,
                      })
                    }
                  >
                    View all {attention.length}
                  </button>
                )}
              </header>
              {attention.length ? (
                <ul className="attention">
                  {attention.slice(0, 6).map(({ ticket, reason, age }) => (
                    <li key={ticket.id}>
                      <button type="button" onClick={() => onOpen(ticket)}>
                        <span className={`dot ${reason === 'sla' ? 'dot-danger' : 'dot-warn'}`} aria-hidden />
                        <span className="att-main">
                          <strong>{ticket.id}</strong>
                          <span className="att-title">{ticket.title}</span>
                        </span>
                        <span className="att-meta">
                          {reason === 'sla' ? 'Not accepted' : 'Past campaign date'}
                          <em>{formatDuration(age)}</em>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="all-clear">
                  <IconCheck size={22} />
                  <span>All clear. Every open request is inside its SLA and date.</span>
                </div>
              )}
            </article>

            <article className="card" style={{ ['--i' as string]: 7 }}>
              <header className="card-head">
                <div>
                  <h2>Requests by tab</h2>
                  <p className="muted small">Volume, open work, delays and how fast each tab accepts.</p>
                </div>
              </header>
              <div className="table-scroll">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Tab</th>
                    <th className="bar-col" aria-label="Volume" />
                    <th className="num">Open</th>
                    <th className="num">Delayed</th>
                    <th className="num">Avg. response</th>
                  </tr>
                </thead>
                <tbody>
                  {byTab.map(({ tab, list, open, overdue, responseMs }) => (
                    <tr
                      key={tab.id}
                      tabIndex={0}
                      onClick={() => show({ title: tab.name, subtitle: 'Requests in this tab', tickets: list })}
                      onKeyDown={(e) =>
                        e.key === 'Enter' && show({ title: tab.name, subtitle: 'Requests in this tab', tickets: list })
                      }
                    >
                      <td className="name">{tab.name}</td>
                      <td className="bar-col">
                        <span className="track">
                          <span className="fill" style={{ transform: `scaleX(${list.length / maxTab})` }} />
                        </span>
                        <span className="count">{list.length}</span>
                      </td>
                      <td className="num">{open}</td>
                      <td className={`num ${overdue.length ? 'text-danger' : ''}`}>{overdue.length}</td>
                      <td className="num">{responseMs === null ? '—' : formatDuration(responseMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </article>
          </div>

          <div className="dash-row dash-row-c">
            <article className="card" style={{ ['--i' as string]: 8 }}>
              <header className="card-head">
                <div>
                  <h2>Brand performance</h2>
                  <p className="muted small">Completed, open and late work per brand.</p>
                </div>
                <div className="legend">
                  <span><i style={{ background: 'var(--good)' }} />Done</span>
                  <span><i style={{ background: 'var(--accent)' }} />Open</span>
                  <span><i style={{ background: 'var(--critical)' }} />Late</span>
                </div>
              </header>
              {brands.length ? (
                <ul className="brand-list">
                  {brands.map(([name, entry]) => {
                    const total = entry.list.length;
                    return (
                      <li key={name}>
                        <button
                          type="button"
                          onClick={() =>
                            show({ title: name, subtitle: 'Every request that includes this brand', tickets: entry.list })
                          }
                        >
                          <span className="b-name">{name}</span>
                          <span className="stack" aria-hidden>
                            <span style={{ width: `${(entry.done / total) * 100}%`, background: 'var(--good)' }} />
                            <span style={{ width: `${(entry.open / total) * 100}%`, background: 'var(--accent)' }} />
                          </span>
                          <span className="b-nums">
                            <strong>{total}</strong>
                            <span>{entry.done} done</span>
                            <span className={entry.late ? 'text-danger' : ''}>{entry.late} late</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="empty-note">No requests in this view.</p>
              )}
            </article>

            <article className="card" style={{ ['--i' as string]: 9 }}>
              <header className="card-head">
                <div>
                  <h2>Staff workload</h2>
                  <p className="muted small">Active requests assigned to each person.</p>
                </div>
              </header>
              {workload.length ? (
                <ul className="people">
                  {workload.map(([email, list]) => (
                    <li key={email}>
                      <button
                        type="button"
                        onClick={() => show({ title: email, subtitle: 'Active assigned requests', tickets: list })}
                      >
                        <span className="avatar" aria-hidden>{initials(email)}</span>
                        <span className="p-main">
                          <span className="p-name">{email}</span>
                          <span className="track">
                            <span className="fill" style={{ transform: `scaleX(${list.length / maxWork})` }} />
                          </span>
                        </span>
                        <strong>{list.length}</strong>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-note">Nothing is assigned right now.</p>
              )}
            </article>
          </div>
        </>
      )}

      {drill && (
        <div className="drill-backdrop" onClick={() => setDrill(null)}>
          <aside
            className="drill"
            role="dialog"
            aria-modal="true"
            aria-label={drill.title}
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <h2>{drill.title}</h2>
                <p className="muted small">
                  {drill.tickets.length} request{drill.tickets.length === 1 ? '' : 's'} · {drill.subtitle}
                </p>
              </div>
              <button type="button" className="icon-btn" onClick={() => setDrill(null)} aria-label="Close" autoFocus>
                <IconClose size={17} />
              </button>
            </header>
            <div className="drill-body">
              {drill.tickets.length ? (
                <ul>
                  {drill.tickets.slice(0, 200).map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setDrill(null);
                          onOpen(t);
                        }}
                      >
                        <span className="d-top">
                          <strong>{t.id}</strong>
                          <span className={statusClass(t.status)}>{t.status}</span>
                          {drill.showWaiting && (
                            <span className="d-wait">waiting {formatDuration(now - (t.approvedAt ?? t.createdAt))}</span>
                          )}
                        </span>
                        <span className="d-title">{t.title}</span>
                        <span className="d-meta">
                          {t.brand} · {t.requesterName} · submitted {formatDateTime(t.createdAt)}
                          {t.area !== MENU_ISSUES && <> · campaign {formatDateKey(t.campaignDate)}</>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-note">Nothing here.</p>
              )}
              {drill.tickets.length > 200 && (
                <p className="muted small drill-more">
                  Showing the first 200 of {drill.tickets.length}. Narrow the view with the filters above.
                </p>
              )}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------------- */

function Kpi({
  index,
  Icon,
  label,
  value,
  note,
  noteTone,
  tone,
  spark,
  onClick,
}: {
  index: number;
  Icon: (p: { size?: number }) => React.ReactElement;
  label: string;
  value: number;
  note?: string;
  noteTone?: 'up' | 'down';
  tone?: 'danger' | 'good';
  spark?: number[];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`kpi ${tone ? `kpi-${tone}` : ''}`}
      style={{ ['--i' as string]: index }}
      onClick={onClick}
    >
      <span className="kpi-head">
        <span className="kpi-icon">
          <Icon size={16} />
        </span>
        {label}
      </span>
      <span className="kpi-value">{value.toLocaleString()}</span>
      <span className={`kpi-note ${noteTone ? `is-${noteTone}` : ''}`}>{note}</span>
      {spark && <Sparkline values={spark} />}
      <span className="kpi-go" aria-hidden>View →</span>
    </button>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 120;
  const h = 34;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => [i * step, h - 3 - (v / max) * (h - 8)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} className="spark-area" />
      <path d={line} className="spark-line" />
    </svg>
  );
}

function AreaChart({
  keys,
  created,
  finished,
  maxY,
  hover,
  onHover,
}: {
  keys: string[];
  created: number[];
  finished: number[];
  maxY: number;
  hover: number;
  onHover: (i: number | null) => void;
}) {
  const W = 720;
  const H = 230;
  const pad = { l: 30, r: 10, t: 12, b: 22 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const n = keys.length;
  const x = (i: number) => pad.l + (n > 1 ? (i / (n - 1)) * iw : iw / 2);
  const y = (v: number) => pad.t + ih - (v / maxY) * ih;
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const ticks = [0, 0.5, 1].map((f) => Math.round(maxY * f));
  const labelEvery = Math.ceil(n / 6);

  return (
    <svg
      className="area-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Requests created and finished per day"
      onMouseLeave={() => onHover(null)}
      onMouseMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const px = ((e.clientX - box.left) / box.width) * W;
        const i = Math.round(((px - pad.l) / iw) * (n - 1));
        onHover(Math.max(0, Math.min(n - 1, i)));
      }}
    >
      <defs>
        <linearGradient id="dash-created" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid-line" />
          <text x={pad.l - 6} y={y(t) + 3.5} textAnchor="end" className="axis">{t}</text>
        </g>
      ))}
      {keys.map((k, i) =>
        i % labelEvery === 0 ? (
          <text key={k} x={x(i)} y={H - 5} textAnchor="middle" className="axis">
            {k.slice(5).replace('-', '/')}
          </text>
        ) : null,
      )}
      <path d={`${path(created)} L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)} Z`} fill="url(#dash-created)" />
      <path d={path(created)} className="line line-created" />
      <path d={path(finished)} className="line line-finished" />
      <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="cursor-line" />
      <circle cx={x(hover)} cy={y(created[hover])} r="4" className="pt pt-created" />
      <circle cx={x(hover)} cy={y(finished[hover])} r="4" className="pt pt-finished" />
    </svg>
  );
}

function Donut({
  total,
  slices,
  onPick,
}: {
  total: number;
  slices: { label: string; value: number; color: string }[];
  onPick: (label: string) => void;
}) {
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <svg className="donut" viewBox="0 0 140 140" role="img" aria-label="Requests by status">
        <circle cx="70" cy="70" r={r} className="donut-bg" />
        {slices.map((s) => {
          const len = total ? (s.value / total) * c : 0;
          const el = (
            <circle
              key={s.label}
              cx="70"
              cy="70"
              r={r}
              className="donut-seg"
              stroke={s.color}
              strokeDasharray={`${Math.max(0, len - 2)} ${c - Math.max(0, len - 2)}`}
              strokeDashoffset={-offset}
              onClick={() => onPick(s.label)}
            >
              <title>{`${s.label}: ${s.value}`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
        <text x="70" y="68" textAnchor="middle" className="donut-total">{total.toLocaleString()}</text>
        <text x="70" y="85" textAnchor="middle" className="donut-cap">requests</text>
      </svg>
      <ul className="donut-legend">
        {slices.map((s) => (
          <li key={s.label}>
            <button type="button" onClick={() => onPick(s.label)}>
              <i style={{ background: s.color }} />
              <span>{s.label}</span>
              <strong>{s.value}</strong>
              <em>{total ? Math.round((s.value / total) * 100) : 0}%</em>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
