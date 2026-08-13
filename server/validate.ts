import {
  addDaysKey,
  fieldSetting,
  isFieldVisible,
  type FieldDef,
  type FormSettings,
  type FormValues,
  type TabDef,
} from '../shared/spec';

/**
 * Server-side re-validation of a submitted form. The browser enforces the same
 * rules, but spec §23 requires the backend to repeat every check.
 */
export function validateSubmission(
  tab: TabDef,
  raw: FormValues,
  settings: FormSettings,
  isAdmin: boolean,
  now = Date.now(),
): { values: FormValues } | { error: string } {
  const values: FormValues = {};

  // Only keep values for fields that exist and are enabled.
  for (const field of tab.fields) {
    if (!fieldSetting(settings, tab.id, field).enabled) continue;
    if (Object.prototype.hasOwnProperty.call(raw, field.label)) {
      values[field.label] = normalizeValue(field, raw[field.label]);
    }
  }

  for (const field of tab.fields) {
    const setting = fieldSetting(settings, tab.id, field);
    if (!setting.enabled) continue;

    // Conditional fields only apply while visible (spec §6.2).
    if (!isFieldVisible(tab, field, values)) {
      delete values[field.label];
      continue;
    }

    const value = values[field.label];
    const empty =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '') ||
      (Array.isArray(value) && value.length === 0);

    if (setting.required && empty) {
      return { error: `${field.label} is required.` };
    }
    if (empty) continue;

    const optionError = checkOptions(field, value);
    if (optionError) return { error: optionError };

    if (field.type === 'number' && Number.isNaN(Number(value))) {
      return { error: `${field.label} must be a number.` };
    }

    if (field.type === 'url' && !/^https?:\/\/\S+$/i.test(String(value))) {
      return { error: `${field.label} must be a valid link starting with http:// or https://.` };
    }

    if (field.type === 'date') {
      const date = String(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return { error: `${field.label} must be a valid date.` };
      }
      // Administrators bypass minimum-date restrictions (spec §6.3).
      if (!isAdmin && field.minDaysFromToday !== undefined) {
        const earliest = addDaysKey(field.minDaysFromToday, now);
        if (date < earliest) {
          return { error: `${field.label} must be ${earliest} or later.` };
        }
      }
      if (field.mustBeAfter) {
        const other = values[field.mustBeAfter];
        if (typeof other === 'string' && other && date <= other) {
          return { error: `${field.label} must be after ${field.mustBeAfter}.` };
        }
      }
    }
  }

  return { values };
}

function normalizeValue(field: FieldDef, value: unknown): unknown {
  if (field.type === 'multi') {
    if (!Array.isArray(value)) return value === undefined || value === null ? [] : [String(value)];
    return value.map(String).filter((v) => v.trim() !== '');
  }
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

/**
 * Select/multi values must come from the option list. A field with a
 * `customOption` also accepts free text, which is how "Other customer group"
 * and the custom objective/platform inputs are stored.
 */
function checkOptions(field: FieldDef, value: unknown): string | null {
  if (!field.options) return null;
  if (field.customOption) return null;

  const provided = Array.isArray(value) ? value.map(String) : [String(value)];
  for (const item of provided) {
    if (!field.options.includes(item)) {
      return `${field.label} has an unsupported value.`;
    }
  }
  return null;
}
