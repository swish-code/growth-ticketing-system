import { useMemo, useState } from 'react';
import {
  MENU_ISSUES,
  STATUSES,
  hasFormAccess,
  hasSubmissionAccess,
  toDateKey,
  type TabDef,
  type Ticket,
} from '../../shared/spec';
import type { AppUser } from '../api';
import {
  displayValue,
  exportCsv,
  formatDateKey,
  formatDateTime,
  formatDuration,
  menuIssueSla,
  priorityClass,
  statusClass,
} from '../lib/format';

interface Props {
  user: AppUser;
  tab: TabDef;
  tickets: Ticket[];
  onOpen: (ticket: Ticket) => void;
  onNew: () => void;
}

const EMPTY = '';

export function TabView({ user, tab, tickets, onOpen, onNew }: Props) {
  const [search, setSearch] = useState(EMPTY);
  const [status, setStatus] = useState(EMPTY);
  const [brand, setBrand] = useState(EMPTY);
  const [from, setFrom] = useState(EMPTY);
  const [to, setTo] = useState(EMPTY);
  const [aggregator, setAggregator] = useState(EMPTY);

  const aggregatorField = tab.fields.find((f) => f.label === 'Aggregator');
  const isMenuIssues = tab.id === MENU_ISSUES;
  const canSubmit = hasFormAccess(user);
  const canRead = hasSubmissionAccess(user);

  const areaTickets = useMemo(
    () => tickets.filter((t) => t.area === tab.id),
    [tickets, tab.id],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return areaTickets.filter((ticket) => {
      if (term && !`${ticket.id} ${ticket.title}`.toLowerCase().includes(term)) return false;
      if (status && ticket.status !== status) return false;
      if (brand && ticket.brand !== brand) return false;
      const submitted = toDateKey(ticket.createdAt);
      if (from && submitted < from) return false;
      if (to && submitted > to) return false;
      if (aggregator) {
        const value = ticket.data.Aggregator;
        const list = Array.isArray(value) ? value.map(String) : [String(value ?? '')];
        if (!list.includes(aggregator)) return false;
      }
      return true;
    });
  }, [areaTickets, search, status, brand, from, to, aggregator]);

  /** Menu Issues tab summary: average submission → Done (spec §12.1). */
  const averageResponse = useMemo(() => {
    const completed = filtered.filter((t) => t.completedAt);
    if (!completed.length) return null;
    const total = completed.reduce((sum, t) => sum + ((t.completedAt as number) - t.createdAt), 0);
    return total / completed.length;
  }, [filtered]);

  if (!canRead) {
    return (
      <section className="page">
        <header className="page-head">
          <h1>{tab.name}</h1>
          {canSubmit && (
            <button className="btn btn-primary" onClick={onNew}>
              New request
            </button>
          )}
        </header>
        <div className="callout">
          Your role has form access only. You can submit {tab.name} requests, but existing
          submissions are not visible to you.
        </div>
      </section>
    );
  }

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>{tab.name}</h1>
          <p className="muted">
            {filtered.length} of {areaTickets.length} requests
            {isMenuIssues && averageResponse !== null && (
              <> · average response {formatDuration(averageResponse)}</>
            )}
          </p>
        </div>
        <div className="head-actions">
          <button className="btn btn-ghost" onClick={() => exportCsv(tab, filtered)}>
            Export CSV
          </button>
          {canSubmit && (
            <button className="btn btn-primary" onClick={onNew}>
              New request
            </button>
          )}
        </div>
      </header>

      <div className="filters">
        <input
          placeholder="Search by title or ID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
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
        {aggregatorField && (
          <select value={aggregator} onChange={(e) => setAggregator(e.target.value)}>
            <option value="">All aggregators</option>
            {(aggregatorField.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        )}
        <label className="date-filter">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="date-filter">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Request</th>
              <th>Brand</th>
              <th>Requested by</th>
              <th>Submitted</th>
              <th>{isMenuIssues ? 'Priority / SLA' : 'Campaign date'}</th>
              <th>Status</th>
              <th>Assignee</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((ticket) => {
              const sla = menuIssueSla(ticket);
              return (
                <tr key={ticket.id} className="clickable" onClick={() => onOpen(ticket)}>
                  <td>
                    <strong>{ticket.id}</strong>
                    <div className="muted small">{ticket.title}</div>
                  </td>
                  <td>{ticket.brand}</td>
                  <td>
                    {ticket.requesterName}
                    <div className="muted small">{ticket.requesterEmail}</div>
                  </td>
                  <td>{formatDateTime(ticket.createdAt)}</td>
                  <td>
                    {sla ? (
                      <>
                        <span className={priorityClass(sla.priority)}>{sla.priority}</span>
                        <div className={`small ${sla.overdue ? 'text-danger' : 'muted'}`}>
                          {sla.completedInMs !== null
                            ? `Completed in ${formatDuration(sla.completedInMs)}`
                            : sla.overdue
                              ? `Overdue ${formatDuration(sla.remainingMs)}`
                              : `${formatDuration(sla.remainingMs)} left`}
                        </div>
                      </>
                    ) : (
                      formatDateKey(ticket.campaignDate)
                    )}
                  </td>
                  <td>
                    <span className={statusClass(ticket.status)}>{ticket.status}</span>
                  </td>
                  <td>{displayValue(ticket.ownerEmail)}</td>
                </tr>
              );
            })}
            {!filtered.length && (
              <tr>
                <td colSpan={7} className="muted center">
                  No requests match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
