import { useMemo, useState } from 'react';
import {
  addDaysKey,
  fieldSetting,
  isFieldVisible,
  type FieldDef,
  type FormSettings,
  type FormValues,
  type TabDef,
} from '../../shared/spec';
import { ApiError, api, type AppUser } from '../api';
import { IconAlert, IconClose } from './Icons';

interface Props {
  user: AppUser;
  tab: TabDef;
  formSettings: FormSettings;
  onClose: () => void;
  onCreated: () => void;
}

export function RequestForm({ user, tab, formSettings, onClose, onCreated }: Props) {
  const [values, setValues] = useState<FormValues>({});
  const [customText, setCustomText] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fields = useMemo(
    () => tab.fields.filter((field) => fieldSetting(formSettings, tab.id, field).enabled),
    [tab, formSettings],
  );

  function setValue(label: string, value: unknown) {
    setValues((prev) => ({ ...prev, [label]: value }));
  }

  function toggleMulti(field: FieldDef, option: string) {
    const current = Array.isArray(values[field.label]) ? (values[field.label] as string[]) : [];
    const next = current.includes(option)
      ? current.filter((v) => v !== option)
      : [...current, option];
    setValue(field.label, next);
  }

  /** Minimum selectable date. Administrators bypass it (spec §6.3). */
  function minDateFor(field: FieldDef): string | undefined {
    if (field.mustBeAfter) {
      const start = values[field.mustBeAfter];
      if (typeof start === 'string' && start) {
        const next = new Date(`${start}T00:00:00`);
        next.setDate(next.getDate() + 1);
        return next.toISOString().slice(0, 10);
      }
    }
    if (user.isAdmin || field.minDaysFromToday === undefined) return undefined;
    return addDaysKey(field.minDaysFromToday);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');

    const payload: FormValues = {};
    for (const field of fields) {
      if (!isFieldVisible(tab, field, values)) continue;
      const setting = fieldSetting(formSettings, tab.id, field);
      let value = values[field.label];

      if (field.type === 'multi') {
        const selected = Array.isArray(value) ? (value as string[]) : [];
        if (field.customOption && selected.includes(field.customOption)) {
          const text = (customText[field.label] ?? '').trim();
          if (!text) {
            setError(`Enter a value for "${field.customOption}" in ${field.label}.`);
            return;
          }
          value = selected.map((v) => (v === field.customOption ? text : v));
        } else {
          value = selected;
        }
      }

      const empty =
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === '') ||
        (Array.isArray(value) && value.length === 0);

      if (setting.required && empty) {
        setError(`${field.label} is required.`);
        return;
      }
      if (!empty) payload[field.label] = value;
    }

    setSubmitting(true);
    try {
      await api.createTicket(tab.id, payload);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit the request.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>New {tab.name} request</h2>
            <p className="muted">All fields marked with * are required.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><IconClose size={17} /></button>
        </header>

        <form className="modal-body form-grid" onSubmit={handleSubmit}>
          {fields.map((field) => {
            if (!isFieldVisible(tab, field, values)) return null;
            const setting = fieldSetting(formSettings, tab.id, field);
            const options =
              field.label === 'Brand' ? user.allowedBrands : (field.options ?? []);

            return (
              <div
                key={field.label}
                className={`field ${field.wide || field.type === 'multi' ? 'field-wide' : ''}`}
              >
                <label htmlFor={`f-${field.label}`}>
                  {field.label}
                  {setting.required && <span className="req"> *</span>}
                </label>

                {field.type === 'textarea' && (
                  <textarea
                    id={`f-${field.label}`}
                    rows={3}
                    value={String(values[field.label] ?? '')}
                    required={setting.required}
                    onChange={(e) => setValue(field.label, e.target.value)}
                  />
                )}

                {field.type === 'select' && (
                  <select
                    id={`f-${field.label}`}
                    value={String(values[field.label] ?? '')}
                    required={setting.required}
                    onChange={(e) => setValue(field.label, e.target.value)}
                  >
                    <option value="">Select…</option>
                    {options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                )}

                {field.type === 'multi' && (
                  <>
                    <div className="tiles">
                      {options.map((option) => {
                        const selected =
                          Array.isArray(values[field.label]) &&
                          (values[field.label] as string[]).includes(option);
                        return (
                          <button
                            type="button"
                            key={option}
                            className={`tile ${selected ? 'tile-on' : ''}`}
                            onClick={() => toggleMulti(field, option)}
                          >
                            <span className="tile-box">{selected ? '✓' : ''}</span>
                            {option}
                          </button>
                        );
                      })}
                    </div>
                    {field.customOption &&
                      Array.isArray(values[field.label]) &&
                      (values[field.label] as string[]).includes(field.customOption) && (
                        <input
                          className="custom-input"
                          placeholder={`Describe "${field.customOption}"`}
                          value={customText[field.label] ?? ''}
                          onChange={(e) =>
                            setCustomText((prev) => ({ ...prev, [field.label]: e.target.value }))
                          }
                        />
                      )}
                  </>
                )}

                {(field.type === 'text' ||
                  field.type === 'number' ||
                  field.type === 'url' ||
                  field.type === 'date') && (
                  <input
                    id={`f-${field.label}`}
                    type={field.type === 'text' ? 'text' : field.type}
                    value={String(values[field.label] ?? '')}
                    required={setting.required}
                    min={field.type === 'date' ? minDateFor(field) : undefined}
                    onChange={(e) => setValue(field.label, e.target.value)}
                  />
                )}
              </div>
            );
          })}

          {error && (
            <p className="form-error field-wide">
              <IconAlert size={17} />
              <span>{error}</span>
            </p>
          )}

          <div className="modal-actions field-wide">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
