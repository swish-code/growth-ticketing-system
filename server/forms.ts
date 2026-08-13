import { TAB_IDS, type AreaFormSettings, type FormSettings } from '../shared/spec';
import { query } from './db';

/** Reads every tab's Form Builder overrides (spec §20.4). */
export async function loadFormSettings(): Promise<FormSettings> {
  const result = await query<{ area: string; settings: AreaFormSettings | null }>(
    `SELECT area, settings FROM form_settings`,
  );
  const settings: FormSettings = {};
  for (const row of result.rows) {
    if (TAB_IDS.includes(row.area)) settings[row.area] = row.settings ?? {};
  }
  return settings;
}

export async function saveFormSettings(area: string, settings: AreaFormSettings): Promise<void> {
  await query(
    `INSERT INTO form_settings (area, settings, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (area) DO UPDATE SET settings = EXCLUDED.settings, updated_at = EXCLUDED.updated_at`,
    [area, JSON.stringify(settings), Date.now()],
  );
}
