import { useState } from 'react';
import { ApiError, api, type AppUser } from '../api';
import { IconClose } from './Icons';

interface Props {
  user: AppUser;
  onClose: () => void;
  onUpdated: (user: AppUser) => void;
}

export function AccountPanel({ user, onClose, onUpdated }: Props) {
  const [name, setName] = useState(user.name);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function saveName() {
    setError('');
    setMessage('');
    try {
      const res = await api.updateName(name);
      if (res.user) onUpdated(res.user);
      setMessage('Name updated.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update your name.');
    }
  }

  async function savePassword() {
    setError('');
    setMessage('');
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage('Password changed.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change your password.');
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>My account</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><IconClose size={17} /></button>
        </header>

        <div className="modal-body">
          <div className="field">
            <label htmlFor="acc-name">Display name</label>
            <input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button className="btn btn-ghost" onClick={saveName}>
            Save name
          </button>

          <div className="field">
            <label>Email</label>
            <input value={user.email} readOnly />
          </div>
          <div className="field">
            <label>Brands</label>
            <input value={user.allowedBrands.join(', ')} readOnly />
          </div>
          <div className="field">
            <label>Role</label>
            <input value={user.roleName ?? '—'} readOnly />
          </div>
          <p className="muted small">
            Email, brands and role are managed by administrators.
          </p>

          <h3 className="section-title">Change password</h3>
          <div className="field">
            <label htmlFor="acc-current">Current password</label>
            <input
              id="acc-current"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="acc-new">New password</label>
            <input
              id="acc-new"
              type="password"
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="acc-confirm">Confirm new password</label>
            <input
              id="acc-confirm"
              type="password"
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" onClick={savePassword}>
            Change password
          </button>

          {message && <p className="text-ok">{message}</p>}
          {error && <p className="form-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
