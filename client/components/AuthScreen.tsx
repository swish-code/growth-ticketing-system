import { useState } from 'react';
import { BRANDS, COMPANY_DOMAIN } from '../../shared/spec';
import { ApiError, api, type AppUser } from '../api';

interface Props {
  onSignedIn: (user: AppUser) => void;
}

type Mode = 'login' | 'register';

export function AuthScreen({ onSignedIn }: Props) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [brands, setBrands] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function toggleBrand(brand: string) {
    setBrands((prev) =>
      prev.includes(brand) ? prev.filter((b) => b !== brand) : [...prev, brand],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result =
        mode === 'login'
          ? await api.login({ email, password })
          : await api.register({ email, name, brands, password });
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

        <div className="auth-tabs">
          <button
            className={mode === 'login' ? 'active' : ''}
            onClick={() => {
              setMode('login');
              setError('');
            }}
          >
            Log in
          </button>
          <button
            className={mode === 'register' ? 'active' : ''}
            onClick={() => {
              setMode('register');
              setError('');
            }}
          >
            Create account
          </button>
        </div>

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="auth-email">Company email</label>
            <input
              id="auth-email"
              type="email"
              required
              placeholder={`name${COMPANY_DOMAIN}`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {mode === 'register' && (
            <>
              <div className="field">
                <label htmlFor="auth-name">Full name</label>
                <input
                  id="auth-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Brands</label>
                <div className="tiles">
                  {BRANDS.map((brand) => {
                    const on = brands.includes(brand);
                    return (
                      <button
                        type="button"
                        key={brand}
                        className={`tile ${on ? 'tile-on' : ''}`}
                        onClick={() => toggleBrand(brand)}
                      >
                        <span className="tile-box">{on ? '✓' : ''}</span>
                        {brand}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          <div className="field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="muted small">
              {mode === 'login'
                ? 'If an administrator created your account, the password you type here becomes your password.'
                : 'At least 8 characters.'}
            </p>
          </div>

          {error && <p className="form-error">{error}</p>}

          <button className="btn btn-primary full" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}
