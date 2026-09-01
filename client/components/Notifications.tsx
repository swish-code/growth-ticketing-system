import type { Notification } from '../../shared/spec';
import { IconClose } from './Icons';

interface Props {
  events: Notification[];
  onDismiss: (id: string) => void;
}

/** Up to four toasts at the top of the app for freshly-arrived notifications. */
export function Notifications({ events, onDismiss }: Props) {
  if (!events.length) return null;
  return (
    <div className="toasts">
      {events.slice(-4).map((event) => (
        <div
          key={event.id}
          className={`toast ${event.type.startsWith('sla.') ? 'toast-alert' : ''}`}
        >
          <div>
            <strong>{event.title}</strong>
            <div className="small">{event.message}</div>
          </div>
          <button className="icon-btn" onClick={() => onDismiss(event.id)} aria-label="Dismiss">
            <IconClose size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
