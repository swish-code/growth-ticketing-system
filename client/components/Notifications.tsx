import type { ActivityEvent } from '../../shared/spec';

interface Props {
  events: ActivityEvent[];
  onDismiss: (id: string) => void;
}

/** Up to four toasts at the top of the app (spec §18.3). */
export function Notifications({ events, onDismiss }: Props) {
  if (!events.length) return null;
  return (
    <div className="toasts">
      {events.slice(-4).map((event) => (
        <div key={event.id} className={`toast ${event.type === 'sla.escalation' ? 'toast-alert' : ''}`}>
          <div>
            <strong>{event.title}</strong>
            <div className="small">{event.message}</div>
          </div>
          <button className="icon-btn" onClick={() => onDismiss(event.id)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
