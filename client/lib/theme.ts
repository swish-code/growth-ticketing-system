/**
 * Theme handling.
 *
 * The resolved mode ('light' | 'dark') is always stamped on
 * `<html data-theme>`; CSS only ever looks at that attribute. "system" is a
 * stored *preference* that resolves against `prefers-color-scheme` here in JS,
 * so the stylesheet needs no media-query duplication of the dark tokens.
 *
 * An inline script in index.html applies the same logic before first paint to
 * avoid a light flash on dark machines.
 */

export type ThemePref = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'gts-theme';

const media = window.matchMedia('(prefers-color-scheme: dark)');

const CHROME_COLOR = { light: '#f4f4f1', dark: '#0d0d0d' } as const;

export function getThemePref(): ThemePref {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    /* storage unavailable */
  }
  return 'system';
}

export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'system') return media.matches ? 'dark' : 'light';
  return pref;
}

export function applyTheme(pref: ThemePref): void {
  const mode = resolveTheme(pref);
  document.documentElement.dataset.theme = mode;
  // Keep the browser UI (mobile address bar) in step with the page.
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = CHROME_COLOR[mode];
}

export function setThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    /* storage unavailable — the stamp below still applies for this session */
  }
  applyTheme(pref);
}

/** Re-resolve when the OS theme flips while the preference is "system". */
export function watchSystemTheme(): () => void {
  const handler = () => {
    if (getThemePref() === 'system') applyTheme('system');
  };
  media.addEventListener('change', handler);
  return () => media.removeEventListener('change', handler);
}
