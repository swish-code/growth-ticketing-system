import { useMemo } from 'react';
import {
  ACCEPTANCE_SLA_MS,
  MENU_ISSUES,
  isClosed,
  toDateKey,
  todayKey,
  visibleTabs,
  type Ticket,
} from '../../shared/spec';
import type { AppUser } from '../api';
import { formatDuration } from '../lib/format';

interface Props {
  user: AppUser;
  tickets: Ticket[];
}

/** A request is late when its campaign date passed while it was still open. */
function isLate(ticket: Ticket, today: string): boolean {
  if (ticket.area === MENU_ISSUES) return false;
  if (ticket.status === 'Declined') return false;
  if (ticket.status === 'Done') {
    return ticket.completedAt ? toDateKey(ticket.completedAt) > ticket.campaignDate : false;
  }
  return ticket.campaignDate < today;
}

export function Dashboard({ user, tickets }: Props) {
  const today = todayKey();
  const now = Date.now();
  const tabs = visibleTabs(user);

  const stats = useMemo(() => {
    const open = tickets.filter((t) => !isClosed(t.status)).length;
    const finished = tickets.filter((t) => t.status === 'Done').length;
    const delayed = tickets.filter(
      (t) => t.status === 'New' && now - t.createdAt > ACCEPTANCE_SLA_MS,
    ).length;
    return { total: tickets.length, open, finished, delayed };
  }, [tickets, now]);

  const byTab = useMemo(
    () =>
      tabs.map((tab) => {
        const areaTickets = tickets.filter((t) => t.area === tab.id);
        const accepted = areaTickets.filter((t) => t.acceptedAt);
        const responseMs = accepted.length
          ? accepted.reduce((sum, t) => sum + ((t.acceptedAt as number) - t.createdAt), 0) /
            accepted.length
          : null;
        const overdue = areaTickets.filter(
          (t) =>
            (t.status === 'New' && now - t.createdAt > ACCEPTANCE_SLA_MS) || isLate(t, today),
        ).length;
        return { tab, count: areaTickets.length, responseMs, overdue };
      }),
    [tabs, tickets, today, now],
  );

  const workload = useMemo(() => {
    const map = new Map<string, number>();
    for (const ticket of tickets) {
      if (!ticket.ownerEmail || isClosed(ticket.status)) continue;
      map.set(ticket.ownerEmail, (map.get(ticket.ownerEmail) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [tickets]);

  const brands = useMemo(() => {
    const map = new Map<string, { total: number; done: number; late: number }>();
    for (const ticket of tickets) {
      const entry = map.get(ticket.brand) ?? { total: 0, done: 0, late: 0 };
      entry.total += 1;
      if (ticket.status === 'Done') entry.done += 1;
      if (isLate(ticket, today)) entry.late += 1;
      map.set(ticket.brand, entry);
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [tickets, today]);

  const maxTabCount = Math.max(1, ...byTab.map((row) => row.count));

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Live figures for every request you are permitted to see.</p>
        </div>
      </header>

      <div className="stat-grid">
        <Stat label="Total requests" value={stats.total} />
        <Stat label="Open" value={stats.open} />
        <Stat label="Finished" value={stats.finished} />
        <Stat label="Delayed over 24h" value={stats.delayed} tone={stats.delayed ? 'danger' : undefined} />
      </div>

      <div className="panel-grid">
        <div className="panel">
          <h2>Requests by tab</h2>
          {byTab.map(({ tab, count }) => (
            <div key={tab.id} className="bar-row">
              <span className="bar-label">{tab.name}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${(count / maxTabCount) * 100}%` }} />
              </span>
              <span className="bar-value">{count}</span>
            </div>
          ))}
          {!byTab.length && <p className="muted">No permitted tabs.</p>}
        </div>

        <div className="panel">
          <h2>Average response time</h2>
          <p className="muted small">Submission → acceptance.</p>
          <table className="mini-table">
            <tbody>
              {byTab.map(({ tab, responseMs }) => (
                <tr key={tab.id}>
                  <td>{tab.name}</td>
                  <td className="right">
                    {responseMs === null ? '—' : formatDuration(responseMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>Staff workload</h2>
          <p className="muted small">Active assigned requests.</p>
          <table className="mini-table">
            <tbody>
              {workload.map(([email, count]) => (
                <tr key={email}>
                  <td>{email}</td>
                  <td className="right">{count}</td>
                </tr>
              ))}
              {!workload.length && (
                <tr>
                  <td className="muted">Nothing assigned.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>Overdue by tab</h2>
          <table className="mini-table">
            <tbody>
              {byTab.map(({ tab, overdue }) => (
                <tr key={tab.id}>
                  <td>{tab.name}</td>
                  <td className={`right ${overdue ? 'text-danger' : ''}`}>{overdue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel panel-wide">
          <h2>Brand performance</h2>
          <table className="mini-table">
            <thead>
              <tr>
                <th>Brand</th>
                <th className="right">Volume</th>
                <th className="right">Completed</th>
                <th className="right">Late</th>
              </tr>
            </thead>
            <tbody>
              {brands.map(([brand, entry]) => (
                <tr key={brand}>
                  <td>{brand}</td>
                  <td className="right">{entry.total}</td>
                  <td className="right">{entry.done}</td>
                  <td className={`right ${entry.late ? 'text-danger' : ''}`}>{entry.late}</td>
                </tr>
              ))}
              {!brands.length && (
                <tr>
                  <td colSpan={4} className="muted">
                    No requests yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <div className={`stat ${tone === 'danger' ? 'stat-danger' : ''}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
