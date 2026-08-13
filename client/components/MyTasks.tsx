import { useMemo, useState } from 'react';
import { MENU_ISSUES, canManage, tabName, type Ticket } from '../../shared/spec';
import type { AppUser } from '../api';
import {
  formatDateKey,
  formatDateTime,
  formatDuration,
  menuIssueSla,
  priorityClass,
  statusClass,
} from '../lib/format';

interface Props {
  user: AppUser;
  tickets: Ticket[];
  onOpen: (ticket: Ticket) => void;
}

const AGGREGATORS = [
  'All Aggregator',
  'Talabat',
  'Keeta',
  'Ordable',
  'Deliveroo',
  'Snoonu',
  'V-thru',
  'Jahez',
];

export function MyTasks({ user, tickets, onOpen }: Props) {
  const [brand, setBrand] = useState('');
  const [aggregator, setAggregator] = useState('');

  const managed = useMemo(
    () => tickets.filter((t) => canManage(user, t.area)),
    [tickets, user],
  );

  const filtered = useMemo(
    () =>
      managed.filter((ticket) => {
        if (brand && ticket.brand !== brand) return false;
        if (aggregator) {
          if (ticket.area !== MENU_ISSUES) return false;
          if (String(ticket.data.Aggregator ?? '') !== aggregator) return false;
        }
        return true;
      }),
    [managed, brand, aggregator],
  );

  const unassigned = filtered.filter((t) => t.status === 'New' && !t.ownerEmail);
  const mine = filtered.filter((t) => t.ownerEmail === user.email);

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>My Tasks</h1>
          <p className="muted">
            {unassigned.length} awaiting acceptance · {mine.length} assigned to you
          </p>
        </div>
      </header>

      <div className="filters">
        <select value={brand} onChange={(e) => setBrand(e.target.value)}>
          <option value="">All brands</option>
          {user.allowedBrands.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <select value={aggregator} onChange={(e) => setAggregator(e.target.value)}>
          <option value="">All aggregators (Menu Issues)</option>
          {AGGREGATORS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      <TaskTable
        title="Awaiting acceptance"
        empty="Nothing is waiting for you right now."
        tickets={unassigned}
        onOpen={onOpen}
      />
      <TaskTable
        title="Assigned to me"
        empty="You have no assigned requests."
        tickets={mine}
        onOpen={onOpen}
      />
    </section>
  );
}

function TaskTable({
  title,
  empty,
  tickets,
  onOpen,
}: {
  title: string;
  empty: string;
  tickets: Ticket[];
  onOpen: (ticket: Ticket) => void;
}) {
  return (
    <>
      <h2 className="section-title">{title}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Request</th>
              <th>Tab</th>
              <th>Brand</th>
              <th>Requested by</th>
              <th>Submitted</th>
              <th>Campaign / SLA</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => {
              const sla = menuIssueSla(ticket);
              return (
                <tr key={ticket.id} className="clickable" onClick={() => onOpen(ticket)}>
                  <td>
                    <strong>{ticket.id}</strong>
                    <div className="muted small">{ticket.title}</div>
                  </td>
                  <td>{tabName(ticket.area)}</td>
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
                </tr>
              );
            })}
            {!tickets.length && (
              <tr>
                <td colSpan={7} className="muted center">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
