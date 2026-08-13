import { useState } from 'react';
import { COMPANY_DOMAIN } from '../../shared/spec';
import { ApiError, api, type AppUser } from '../api';

interface Props {
  onSignedIn: (user: AppUser) => void;
}

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
    <div className="auth-shell">
      <div className="auth-card">
        <h1>Growth Department</h1>
        <p className="muted">Campaign Requests</p>

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="auth-email">Company email</label>
            <input
              id="auth-email"
              type="email"
              required
              autoComplete="username"
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
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="muted small">
              Signing in for the first time? The password you type here becomes your password.
            </p>
          </div>

          {error && <p className="form-error">{error}</p>}

          <button className="btn btn-primary full" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : 'Log in'}
          </button>
        </form>

        <p className="muted small auth-note">
          Accounts are created by an administrator. If you do not have one yet, ask the Growth
          Department admin to add you in Admin panel → Staff access.
        </p>
      </div>
    </div>
  );
}
