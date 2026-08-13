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
import { IconAlert, IconCheck, IconClock, IconInbox } from './Icons';

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

function percent(part: number, whole: number): string {
  if (!whole) return '—';
  return `${Math.round((part / whole) * 100)}% of all requests`;
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
          (t) => (t.status === 'New' && now - t.createdAt > ACCEPTANCE_SLA_MS) || isLate(t, today),
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
  const totalOverdue = byTab.reduce((sum, row) => sum + row.overdue, 0);

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Live figures for every request you are permitted to see.</p>
        </div>
      </header>

      <div className="stat-grid">
        <Stat
          Icon={IconInbox}
          label="Total requests"
          value={stats.total}
          note={`Across ${tabs.length} permitted ${tabs.length === 1 ? 'tab' : 'tabs'}`}
        />
        <Stat
          Icon={IconClock}
          label="Open"
          value={stats.open}
          note={percent(stats.open, stats.total)}
        />
        <Stat
          Icon={IconCheck}
          label="Finished"
          value={stats.finished}
          note={percent(stats.finished, stats.total)}
        />
        <Stat
          Icon={IconAlert}
          label="Delayed over 24h"
          value={stats.delayed}
          note={stats.delayed ? 'Awaiting acceptance past SLA' : 'Every request accepted in time'}
          tone={stats.delayed ? 'danger' : undefined}
        />
      </div>

      <div className="panel-grid">
        <div className="panel">
          <h2>Requests by tab</h2>
          <p className="muted small">Volume of submissions in each permitted tab.</p>
          {byTab.map(({ tab, count }) => (
            <div key={tab.id} className="bar-row">
              <span className="bar-label" title={tab.name}>
                {tab.name}
              </span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${(count / maxTabCount) * 100}%` }} />
              </span>
              <span className="bar-value">{count}</span>
            </div>
          ))}
          {!byTab.length && <p className="empty-note">No permitted tabs.</p>}
        </div>

        <div className="panel">
          <h2>Average response time</h2>
          <p className="muted small">Submission → acceptance.</p>
          <table className="mini-table">
            <tbody>
              {byTab.map(({ tab, responseMs }) => (
                <tr key={tab.id}>
                  <td>{tab.name}</td>
                  <td className="right">{responseMs === null ? '—' : formatDuration(responseMs)}</td>
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
            </tbody>
          </table>
          {!workload.length && <p className="empty-note">Nothing assigned.</p>}
        </div>

        <div className="panel">
          <h2>Overdue by tab</h2>
          <p className="muted small">
            {totalOverdue
              ? `${totalOverdue} request${totalOverdue === 1 ? '' : 's'} past an SLA or campaign date.`
              : 'Nothing is past an SLA or campaign date.'}
          </p>
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
          <p className="muted small">Volume, completed work and late requests per brand.</p>
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
            </tbody>
          </table>
          {!brands.length && <p className="empty-note">No requests yet.</p>}
        </div>
      </div>
    </section>
  );
}

function Stat({
  Icon,
  label,
  value,
  note,
  tone,
}: {
  Icon: (p: { size?: number }) => React.ReactElement;
  label: string;
  value: number;
  note?: string;
  tone?: 'danger';
}) {
  return (
    <div className={`stat ${tone === 'danger' ? 'stat-danger' : ''}`}>
      <span className="stat-head">
        <Icon size={17} />
        {label}
      </span>
      <span className="stat-value">{value.toLocaleString()}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}
