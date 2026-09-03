import { useEffect, useMemo, useState } from 'react';
import {
  earliestDateFor,
  fieldSetting,
  isFieldVisible,
  primaryDateField,
  type FieldDef,
  type FormSettings,
  type FormValues,
  type RequestEligibility,
  type TabDef,
  type Ticket,
} from '../../shared/spec';
import { ApiError, api, type AppUser } from '../api';
import { EligibilityBanner } from './EligibilityBanner';
import { IconAlert, IconClose } from './Icons';

interface Props {
  user: AppUser;
  tab: TabDef;
  formSettings: FormSettings;
  /** Pre-fills the tab's primary date field — set when opened from a calendar day. */
  initialDate?: string;
  /**
   * Editing an already-submitted request instead of creating one — an
   * administrator correcting a wrong name or a mistyped field. Only the
   * submitted field values change; status, assignment and timestamps are
   * untouched, and the minimum campaign-date lead time and the request-
   * frequency cooldown do not apply (this isn't a new submission).
   */
  ticket?: Ticket;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * A `customOption` field stores the free-text replacement in place of the
 * placeholder once submitted (see handleSubmit below), so re-opening it for
 * edit needs to reconstruct which tile that text belongs to — otherwise the
 * tile shows nothing selected and the custom text box never appears at all.
 */
function seedFromTicket(tab: TabDef, ticket: Ticket): { values: FormValues; customText: Record<string, string> } {
  const values: FormValues = { ...ticket.data };
  const customText: Record<string, string> = {};
  for (const field of tab.fields) {
    if (field.type !== 'multi' || !field.customOption) continue;
    const raw = values[field.label];
    if (!Array.isArray(raw)) continue;
    const unmatched = raw.find((v) => !(field.options ?? []).includes(String(v)));
    if (unmatched !== undefined) {
      customText[field.label] = String(unmatched);
      values[field.label] = raw.map((v) => (v === unmatched ? field.customOption : v));
    }
  }
  return { values, customText };
}

export function RequestForm({ user, tab, formSettings, initialDate, ticket, onClose, onSaved }: Props) {
  const isEditing = Boolean(ticket);
  const dateField = useMemo(() => primaryDateField(tab), [tab]);
  const seeded = useMemo(() => (ticket ? seedFromTicket(tab, ticket) : null), [tab, ticket]);
  const [values, setValues] = useState<FormValues>(
    () => seeded?.values ?? (initialDate && dateField ? { [dateField.label]: initialDate } : {}),
  );
  const [customText, setCustomText] = useState<Record<string, string>>(() => seeded?.customText ?? {});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [eligibility, setEligibility] = useState<RequestEligibility | null>(null);

  const fields = useMemo(
    () => tab.fields.filter((field) => fieldSetting(formSettings, tab.id, field).enabled),
    [tab, formSettings],
  );

  // Request-frequency cooldown (spec: request frequency rules). Re-checked
  // authoritatively by the server on submit — this is display only, and
  // doesn't apply at all when correcting an existing request.
  useEffect(() => {
    if (isEditing) return;
    let active = true;
    api
      .eligibility(tab.id)
      .then((res) => {
        if (active) setEligibility(res.eligibility);
      })
      .catch(() => {
        if (active) setEligibility(null);
      });
    return () => {
      active = false;
    };
  }, [tab.id, isEditing]);

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

  /**
   * Minimum selectable date — applies to everyone, no admin bypass. The lead
   * time is skipped while editing (correcting a date that's already in the
   * past shouldn't be blocked); `mustBeAfter` stays enforced either way,
   * since it's a data-integrity rule, not a submission-timing one.
   */
  function minDateFor(field: FieldDef): string | undefined {
    if (field.mustBeAfter) {
      const start = values[field.mustBeAfter];
      if (typeof start === 'string' && start) {
        const next = new Date(`${start}T00:00:00`);
        next.setDate(next.getDate() + 1);
        return next.toISOString().slice(0, 10);
      }
    }
    return isEditing ? undefined : earliestDateFor(field);
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

    if (!isEditing && eligibility && !eligibility.eligible) {
      setError("You can't submit yet — see the notice above.");
      return;
    }

    setSubmitting(true);
    try {
      if (isEditing && ticket) {
        await api.editTicket(ticket.id, payload);
      } else {
        await api.createTicket(tab.id, payload);
      }
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : `Could not ${isEditing ? 'save the changes' : 'submit the request'}.`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>{isEditing ? `Edit ${tab.name} request ${ticket!.id}` : `New ${tab.name} request`}</h2>
            <p className="muted">
              {isEditing
                ? 'Correcting the submitted details. Status, assignment and history are unaffected.'
                : 'All fields marked with * are required.'}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><IconClose size={17} /></button>
        </header>

        <div className="modal-body">
          {!isEditing && <EligibilityBanner eligibility={eligibility} tabLabel={tab.name} />}

          <form className="form-grid" onSubmit={handleSubmit}>
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
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || (!isEditing && eligibility ? !eligibility.eligible : false)}
              title={
                !isEditing && eligibility && !eligibility.eligible
                  ? 'You cannot submit until the waiting period has passed.'
                  : undefined
              }
            >
              {submitting ? 'Saving…' : isEditing ? 'Save changes' : 'Submit request'}
            </button>
          </div>
          </form>
        </div>
      </div>
    </div>
  );
}
