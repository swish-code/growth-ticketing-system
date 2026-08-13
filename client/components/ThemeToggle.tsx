import { useEffect, useState } from 'react';
import { getThemePref, setThemePref, watchSystemTheme, type ThemePref } from '../lib/theme';
import { IconMonitor, IconMoon, IconSun } from './Icons';

const ORDER: ThemePref[] = ['light', 'dark', 'system'];

const LABEL: Record<ThemePref, string> = {
  light: 'Light theme',
  dark: 'Dark theme',
  system: 'Follow system theme',
};

const ICONS: Record<ThemePref, (p: { size?: number }) => React.ReactElement> = {
  light: IconSun,
  dark: IconMoon,
  system: IconMonitor,
};

/** Cycles light → dark → system; the choice persists across sessions. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [pref, setPref] = useState<ThemePref>(() => getThemePref());

  useEffect(() => watchSystemTheme(), []);

  const next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
  const Icon = ICONS[pref];

  return (
    <button
      type="button"
      className={`icon-btn theme-toggle ${className}`}
      title={`${LABEL[pref]} — click for ${LABEL[next].toLowerCase()}`}
      aria-label={`${LABEL[pref]}. Switch to ${LABEL[next].toLowerCase()}.`}
      onClick={() => {
        setThemePref(next);
        setPref(next);
      }}
    >
      <Icon size={18} />
    </button>
  );
}
