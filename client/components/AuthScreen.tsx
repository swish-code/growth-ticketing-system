import { useState } from 'react';
import { BRANDS, COMPANY_DOMAIN, TABS } from '../../shared/spec';
import { ApiError, api, type AppUser } from '../api';
import { IconAlert, IconCheck, IconClock, IconShield } from './Icons';
import { ThemeToggle } from './ThemeToggle';

interface Props {
  onSignedIn: (user: AppUser) => void;
}

const POINTS = [
  {
    Icon: IconCheck,
    text: 'Tab-specific request forms with the rules each campaign type needs.',
  },
  {
    Icon: IconClock,
    text: 'A 24-hour acceptance clock, priority SLAs and automatic scheduling.',
  },
  {
    Icon: IconShield,
    text: 'Role-based access to every tab, brand and submission.',
  },
];

/**
 * Log in only. Accounts are created by administrators from
 * Admin panel → Staff access; there is no self-registration.
 */
export function AuthScreen({ onSignedIn }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await api.login({ email, password });
      onSignedIn(result.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign you in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <aside className="auth-brand">
        <div className="auth-brand-top">
          <span className="brand-mark">GD</span>
          <div>
            <strong>Growth Department</strong>
            <span>Campaign Requests</span>
          </div>
        </div>

        <div className="auth-pitch">
          <h2>Every campaign request, from brief to done.</h2>
          <p>
            One workspace for CRM, paid, influencer, menu and external activity work — with the
            deadlines, ownership and audit trail already built in.
          </p>

          <ul className="auth-points">
            {POINTS.map((point) => (
              <li className="auth-point" key={point.text}>
                <span className="auth-point-mark">
                  <point.Icon size={15} />
                </span>
                {point.text}
              </li>
            ))}
          </ul>
        </div>

        <div className="auth-stats">
          <div className="auth-stat">
            <strong>{TABS.length}</strong>
            <span>Request tabs</span>
          </div>
          <div className="auth-stat">
            <strong>{BRANDS.length}</strong>
            <span>Brands</span>
          </div>
          <div className="auth-stat">
            <strong>24h</strong>
            <span>Response SLA</span>
          </div>
        </div>
      </aside>

      <main className="auth-form-side">
        <ThemeToggle className="auth-theme" />
        <div className="auth-form">
          <div className="auth-mobile-brand">
            <span className="brand-mark">GD</span>
            <div className="brand-text">
              <strong>Growth Department</strong>
              <span>Campaign Requests</span>
            </div>
          </div>

          <h1>Sign in</h1>
          <p className="muted">Use your Swish company account to continue.</p>

          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="auth-email">Company email</label>
              <input
                id="auth-email"
                type="email"
                required
                autoComplete="username"
                autoFocus
                placeholder={`name${COMPANY_DOMAIN}`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="auth-password">Password</label>
              <input
                id="auth-password"
                type="password"
                required
                minLength={8}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="muted small">
                Signing in for the first time? The password you type here becomes your password.
              </p>
            </div>

            {error && (
              <p className="form-error">
                <IconAlert size={17} />
                <span>{error}</span>
              </p>
            )}

            <button className="btn btn-primary full" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="auth-note small">
            Accounts are created by an administrator. If you do not have one yet, ask the Growth
            Department admin to add you in Admin panel → Staff access.
          </p>
        </div>
      </main>
    </div>
  );
}
