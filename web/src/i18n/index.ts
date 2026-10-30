import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './zh-CN';
import enUS from './en-US';

const STORAGE_KEY = 'panel-lang';

// First visit follows the browser language; the choice persists afterwards.
function detectLang(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return stored;
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'zh-CN';
  return nav && nav.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

export function currentLang(): string {
  return detectLang();
}

export function setLang(lang: string): void {
  localStorage.setItem(STORAGE_KEY, lang);
  void i18n.changeLanguage(lang);
}

void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS },
  },
  lng: detectLang(),
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
});

export default i18n;
