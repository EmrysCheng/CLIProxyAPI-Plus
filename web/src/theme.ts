const THEME_KEY = 'panel-theme';

export type ThemeMode = 'light' | 'dark';

// First visit follows the OS preference; an explicit choice persists.
export function applyTheme(): ThemeMode {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function setTheme(value: ThemeMode): void {
  localStorage.setItem(THEME_KEY, value);
  window.dispatchEvent(new CustomEvent('panel:theme-changed'));
}
