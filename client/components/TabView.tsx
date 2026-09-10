import { useEffect, useMemo, useState } from 'react';
import {
  MENU_ISSUES,
  STATUSES,
  canManage,
  hasFormAccess,
  hasSubmissionAccess,
  toDateKey,
  type BulkActionResult,
  type RequestEligibility,
  type TabDef,
  type Ticket,
} from '../../shared/spec';
import { ApiError, api, type AppUser } from '../api';
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
import { EligibilityBanner } from './EligibilityBanner';
import { IconCalendar, IconDownload, IconPlus, IconTasks } from './Icons';
import { TabCalendar } from './TabCalendar';

interface Props {
  user: AppUser;
  tab: TabDef;
  tickets: Ticket[];
  onOpen: (ticket: Ticket) => void;
  onNew: (date?: string) => void;
  onChanged: () => void;
}

const EMPTY = '';

type SubView = 'list' | 'calendar';

export function TabView({ user, tab, tickets, onOpen, onNew, onChanged }: Props) {
  const [subView, setSubView] = useState<SubView>('list');
  const [search, setSearch] = useState(EMPTY);
  const [status, setStatus] = useState(EMPTY);
  const [brand, setBrand] = useState(EMPTY);
  const [from, setFrom] = useState(EMPTY);
  const [to, setTo] = useState(EMPTY);
  const [aggregator, setAggregator] = useState(EMPTY);
  const [eligibility, setEligibility] = useState<RequestEligibility | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkActionResult | null>(null);
  const [bulkError, setBulkError] = useState('');

  const aggregatorField = tab.fields.find((f) => f.label === 'Aggregator');
  const isMenuIssues = tab.id === MENU_ISSUES;
  const canSubmit = hasFormAccess(user);
  const canRead = hasSubmissionAccess(user);
  const canBulkDone = hasSubmissionAccess(user) && canManage(user, tab.id);
  const canBulkDelete = user.isAdmin;
  const canBulkSelect = canBulkDone || canBulkDelete;

  // A new tab, or the underlying ticket list changing shape, invalidates any
  // in-progress selection — safer than risking a stale id in a bulk request.
  useEffect(() => {
    setSelected(new Set());
    setBulkResult(null);
    setBulkError('');
  }, [tab.id]);

  // Request-frequency cooldown for this tab (spec: request frequency rules).
  useEffect(() => {
    if (!canSubmit) return;
    let active = true;
    api
      .eligibility(tab.id)
      .then((res) => {
        if (active) setEligibility(res.eligibility);
      })
      .catch(() => {
        if (active) setEligibility(null);
      });
    return () => {
      active = false;
    };
  }, [tab.id, canSubmit, tickets]);

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

  const filteredIds = useMemo(() => filtered.map((t) => t.id), [filtered]);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllFiltered() {
    setSelected((prev) => {
      if (allFilteredSelected) return new Set();
      return new Set(filteredIds);
    });
  }

  async function runBulk(op: 'done' | 'delete') {
    const ids = [...selected];
    if (!ids.length) return;
    if (op === 'delete' && !window.confirm(`Delete ${ids.length} selected request(s)? This cannot be undone.`)) {
      return;
    }
    setBulkBusy(true);
    setBulkError('');
    setBulkResult(null);
    try {
      const result = await api.bulkTickets(op, ids);
      setBulkResult(result);
      setSelected(new Set(result.failed.map((f) => f.id)));
      onChanged();
    } catch (err) {
      setBulkError(err instanceof ApiError ? err.message : 'The bulk action failed. Please try again.');
    } finally {
      setBulkBusy(false);
    }
  }

  if (!canRead) {
    return (
      <section className="page">
        <header className="page-head">
          <h1>{tab.name}</h1>
          {canSubmit && (
            <button className="btn btn-primary btn-new-request" onClick={() => onNew()}>
              <IconPlus size={17} />
              New request
            </button>
          )}
        </header>
        <div className="callout">
          Your role has form access only. You can submit {tab.name} requests, but existing
          submissions are not visible to you.
        </div>
        {canSubmit && <EligibilityBanner eligibility={eligibility} tabLabel={tab.name} compact />}
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
          {canSubmit && <EligibilityBanner eligibility={eligibility} tabLabel={tab.name} compact />}
        </div>
        <div className="head-actions">
          <button className="btn btn-ghost" onClick={() => exportCsv(tab, filtered)}>
            <IconDownload size={17} />
            Export CSV
          </button>
          {canSubmit && (
            <button className="btn btn-primary btn-new-request" onClick={() => onNew()}>
              <IconPlus size={17} />
              New request
            </button>
          )}
        </div>
      </header>

      <nav className="subnav">
        <button
          className={`subnav-item ${subView === 'list' ? 'active' : ''}`}
          onClick={() => setSubView('list')}
        >
          <IconTasks size={15} /> List
        </button>
        <button
          className={`subnav-item ${subView === 'calendar' ? 'active' : ''}`}
          onClick={() => setSubView('calendar')}
        >
          <IconCalendar size={15} /> Calendar
        </button>
      </nav>

      {subView === 'calendar' ? (
        <TabCalendar
          user={user}
          tab={tab}
          tickets={tickets}
          eligibility={eligibility}
          onOpen={onOpen}
          onCreateForDate={(date) => onNew(date)}
        />
      ) : (
        <>
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

      {canBulkSelect && selected.size > 0 && (
        <div className="actions-row" style={{ alignItems: 'center', margin: '0.7rem 0' }}>
          <span>{selected.size} selected</span>
          {canBulkDone && (
            <button className="btn btn-success" disabled={bulkBusy} onClick={() => runBulk('done')}>
              Mark Done
            </button>
          )}
          {canBulkDelete && (
            <button className="btn btn-danger" disabled={bulkBusy} onClick={() => runBulk('delete')}>
              Delete
            </button>
          )}
          <button className="btn btn-ghost" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      {bulkError && <p className="form-error">{bulkError}</p>}

      {bulkResult && (
        <div className={`callout ${bulkResult.failed.length ? 'callout-danger' : ''}`}>
          <strong>
            {bulkResult.succeeded.length} succeeded
            {bulkResult.failed.length ? `, ${bulkResult.failed.length} failed` : ''}.
          </strong>
          {bulkResult.failed.length > 0 && (
            <ul className="audit-details">
              {bulkResult.failed.map((f) => (
                <li key={f.id}>
                  {f.id}: {f.reason}
                </li>
              ))}
            </ul>
          )}
          <button className="btn btn-ghost" onClick={() => setBulkResult(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {canBulkSelect && (
                <th style={{ width: '2.2rem', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleAllFiltered}
                    aria-label="Select all filtered requests"
                  />
                </th>
              )}
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
                  {canBulkSelect && (
                    <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(ticket.id)}
                        onChange={() => toggleOne(ticket.id)}
                        aria-label={`Select ${ticket.id}`}
                      />
                    </td>
                  )}
                  <td>
                    <div className="cell-id">{ticket.id}</div>
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
                <td colSpan={canBulkSelect ? 8 : 7} className="muted center">
                  No requests match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
        </>
      )}
    </section>
  );
}
