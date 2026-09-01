import { useEffect, useRef, useState } from 'react';
import type { Notification, Ticket } from '../../shared/spec';
import { formatDateTime } from '../lib/format';
import { IconAlert, IconBell, IconCheck } from './Icons';
import './notifications-center.css';

interface Props {
  notifications: Notification[];
  unread: number;
  tickets: Ticket[];
  loading: boolean;
  onOpen: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onOpenTicket: (ticketId: string) => void;
}

/**
 * Notification Center: a persistent, per-employee history — unlike the old
 * toast feed, it survives being logged out and lists everything relevant to
 * this employee until they mark it read.
 */
export function NotificationCenter({
  notifications,
  unread,
  tickets,
  loading,
  onOpen,
  onMarkRead,
  onMarkAllRead,
  onOpenTicket,
}: Props) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggle() {
    setOpen((v) => {
      const next = !v;
      if (next) onOpen();
      return next;
    });
  }

  function handleRowClick(n: Notification) {
    if (!n.readAt) onMarkRead(n.id);
    if (n.ticketId && tickets.some((t) => t.id === n.ticketId)) {
      onOpenTicket(n.ticketId);
      setOpen(false);
    }
  }

  return (
    <div className="notif-center" ref={panelRef}>
      <button
        className="icon-btn notif-bell"
        onClick={toggle}
        aria-label={unread ? `Notifications (${unread} unread)` : 'Notifications'}
      >
        <IconBell size={18} />
        {unread > 0 && <span className="notif-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-panel-head">
            <h2>Notifications</h2>
            {unread > 0 && (
              <button className="btn btn-ghost small-btn" onClick={onMarkAllRead}>
                Mark all as read
              </button>
            )}
          </div>

          <div className="notif-list">
            {loading && <p className="empty-note">Loading…</p>}

            {!loading &&
              notifications.map((n) => {
                const ticketGone = Boolean(n.ticketId) && !tickets.some((t) => t.id === n.ticketId);
                return (
                  <button
                    key={n.id}
                    type="button"
                    className={`notif-row ${n.readAt ? '' : 'is-unread'}`}
                    onClick={() => handleRowClick(n)}
                  >
                    <span className={`notif-row-icon ${n.type.startsWith('sla.') ? 'is-alert' : ''}`}>
                      {n.type.startsWith('sla.') ? <IconAlert size={15} /> : <IconCheck size={15} />}
                    </span>
                    <span className="notif-row-body">
                      <strong>{n.title}</strong>
                      <span className="notif-row-message">{n.message}</span>
                      <span className="notif-row-time">
                        {formatDateTime(n.createdAt)}
                        {ticketGone && ' · request no longer available'}
                      </span>
                    </span>
                    {!n.readAt && <span className="notif-row-dot" aria-hidden="true" />}
                  </button>
                );
              })}

            {!loading && !notifications.length && (
              <p className="empty-note">Nothing yet — you're all caught up.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
