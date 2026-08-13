import { useEffect, useState } from 'react';
import {
  MENU_ISSUES,
  canManage,
  dateReached,
  getTab,
  hasSubmissionAccess,
  tabName,
  type AuditEntry,
  type Ticket,
} from '../../shared/spec';
import { ApiError, api, type AppUser } from '../api';
import {
  displayValue,
  formatDateKey,
  formatDateTime,
  formatDuration,
  menuIssueSla,
  priorityClass,
  statusClass,
} from '../lib/format';

interface Props {
  user: AppUser;
  ticket: Ticket;
  onClose: () => void;
  onChanged: () => void;
}

export function RequestDetail({ user, ticket, onClose, onChanged }: Props) {
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [notes, setNotes] = useState(ticket.notes);
  const [declineReason, setDeclineReason] = useState('');
  const [showDecline, setShowDecline] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const tab = getTab(ticket.area);
  const sla = menuIssueSla(ticket);

  useEffect(() => {
    let active = true;
    api
      .audit(ticket.id)
      .then((res) => {
        if (active) setAudit(res.audit);
      })
      .catch(() => {
        if (active) setAudit([]);
      });
    return () => {
      active = false;
    };
  }, [ticket.id]);

  const manages = hasSubmissionAccess(user) && canManage(user, ticket.area);
  const lockedByOther =
    Boolean(ticket.ownerEmail) && ticket.ownerEmail !== user.email && !user.isAdmin;
  const canAct = manages && !lockedByOther;

  const campaignDateReached = dateReached(ticket.campaignDate);
  const doneAvailable =
    ticket.area === MENU_ISSUES || user.isAdmin || campaignDateReached;

  async function run(op: 'accept' | 'decline' | 'schedule' | 'done' | 'notes') {
    setError('');
    setBusy(true);
    try {
      await api.updateTicket({
        id: ticket.id,
        op,
        declineReason: op === 'decline' ? declineReason : undefined,
        notes: op === 'notes' ? notes : undefined,
      });
      setShowDecline(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the request.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete ${ticket.id}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.deleteTicket(ticket.id);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the request.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>
              {ticket.id} · {ticket.title}
            </h2>
            <p className="muted">
              {tabName(ticket.area)} · {ticket.brand}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="modal-body">
          <div className="detail-summary">
            <div>
              <span className="label">Status</span>
              <span className={statusClass(ticket.status)}>{ticket.status}</span>
            </div>
            <div>
              <span className="label">Requested by</span>
              <strong>{ticket.requesterName}</strong>
              <span className="muted small">{ticket.requesterEmail}</span>
            </div>
            <div>
              <span className="label">Submitted</span>
              <strong>{formatDateTime(ticket.createdAt)}</strong>
            </div>
            <div>
              <span className="label">Assignee</span>
              <strong>{ticket.ownerEmail ?? 'Unassigned'}</strong>
            </div>
            {sla ? (
              <>
                <div>
                  <span className="label">Priority</span>
                  <span className={priorityClass(sla.priority)}>{sla.priority}</span>
                </div>
                <div>
                  <span className="label">Response target</span>
                  <strong>{formatDuration(sla.targetMs)}</strong>
                  {sla.completedInMs === null ? (
                    <span className={`small ${sla.overdue ? 'text-danger' : 'muted'}`}>
                      {sla.overdue
                        ? `Overdue by ${formatDuration(sla.remainingMs)}`
                        : `${formatDuration(sla.remainingMs)} remaining`}
                    </span>
                  ) : (
                    <span className={`small ${sla.withinTarget ? 'text-ok' : 'text-danger'}`}>
                      {sla.withinTarget
                        ? `Completed within target (${formatDuration(sla.completedInMs)})`
                        : `Late by ${formatDuration(sla.completedInMs - sla.targetMs)}`}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div>
                <span className="label">Campaign date</span>
                <strong>{formatDateKey(ticket.campaignDate)}</strong>
              </div>
            )}
          </div>

          {ticket.status === 'Declined' && ticket.declineReason && (
            <div className="callout callout-danger">
              <strong>Decline reason:</strong> {ticket.declineReason}
            </div>
          )}

          <h3 className="section-title">Submitted details</h3>
          <dl className="detail-fields">
            {(tab?.fields ?? [])
              .filter((field) => ticket.data[field.label] !== undefined)
              .map((field) => (
                <div key={field.label}>
                  <dt>{field.label}</dt>
                  <dd>{displayValue(ticket.data[field.label])}</dd>
                </div>
              ))}
          </dl>

          <h3 className="section-title">Staff notes</h3>
          {canAct ? (
            <>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Internal notes for the Growth team…"
              />
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => run('notes')}
              >
                Save notes
              </button>
            </>
          ) : (
            <p className="muted">{ticket.notes || 'No staff notes.'}</p>
          )}

          {manages && lockedByOther && (
            <div className="callout">
              This request is assigned to <strong>{ticket.ownerEmail}</strong>. Only the assignee or
              an administrator can continue it.
            </div>
          )}
          {!manages && (
            <div className="callout">
              You have read-only access to this tab, so workflow actions are unavailable.
            </div>
          )}

          {canAct && (
            <div className="actions-row">
              {ticket.status === 'New' && (
                <button className="btn btn-primary" disabled={busy} onClick={() => run('accept')}>
                  Accept & assign to me
                </button>
              )}
              {ticket.status !== 'Done' && ticket.status !== 'Declined' && (
                <button
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => setShowDecline((v) => !v)}
                >
                  Decline
                </button>
              )}
              {ticket.status === 'In progress' &&
                ticket.area !== MENU_ISSUES &&
                !campaignDateReached && (
                  <button className="btn" disabled={busy} onClick={() => run('schedule')}>
                    Schedule for {formatDateKey(ticket.campaignDate)}
                  </button>
                )}
              {(ticket.status === 'In progress' || ticket.status === 'Scheduled') && (
                <button
                  className="btn btn-success"
                  disabled={busy || !doneAvailable}
                  title={
                    doneAvailable
                      ? undefined
                      : `Available from ${formatDateKey(ticket.campaignDate)}`
                  }
                  onClick={() => run('done')}
                >
                  Mark Done
                </button>
              )}
              {user.isAdmin && (
                <button className="btn btn-ghost" disabled={busy} onClick={remove}>
                  Delete request
                </button>
              )}
            </div>
          )}

          {showDecline && canAct && (
            <div className="decline-box">
              <label htmlFor="decline-reason">Decline reason *</label>
              <textarea
                id="decline-reason"
                rows={2}
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                placeholder="Explain why this request is declined…"
              />
              <button
                className="btn btn-danger"
                disabled={busy || !declineReason.trim()}
                onClick={() => run('decline')}
              >
                Confirm decline
              </button>
            </div>
          )}

          {error && <p className="form-error">{error}</p>}

          <h3 className="section-title">Audit history</h3>
          <ol className="audit">
            {audit.map((entry) => (
              <li key={entry.id}>
                <div className="audit-head">
                  <strong>{entry.action}</strong>
                  <span className="muted small">{formatDateTime(entry.createdAt)}</span>
                </div>
                <div className="muted small">
                  {entry.actorName}
                  {entry.actorEmail && entry.actorEmail !== 'system' ? ` · ${entry.actorEmail}` : ''}
                </div>
                <AuditDetails details={entry.details} />
              </li>
            ))}
            {!audit.length && <li className="muted">No history recorded.</li>}
          </ol>
        </div>
      </div>
    </div>
  );
}

function AuditDetails({ details }: { details: Record<string, unknown> }) {
  const entries = Object.entries(details).filter(([key]) => key !== 'fields');
  if (!entries.length) return null;
  return (
    <ul className="audit-details">
      {entries.map(([key, value]) => (
        <li key={key}>
          <span className="muted">{key}:</span> {displayValue(value)}
        </li>
      ))}
    </ul>
  );
}
