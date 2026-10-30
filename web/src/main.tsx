import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './i18n';
import { App as AntApp, ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { currentLang } from './i18n';
import { useState } from 'react';
import { applyTheme } from './theme';

function Root() {
  const [theme, setThemeState] = useState<'light' | 'dark'>(applyTheme());
  const lang = currentLang();
  React.useEffect(() => {
    const handler = () => setThemeState(applyTheme());
    window.addEventListener('panel:theme-changed', handler);
    return () => window.removeEventListener('panel:theme-changed', handler);
  }, []);
  return (
    <ConfigProvider
      locale={lang === 'zh-CN' ? zhCN : enUS}
      theme={{
        algorithm: theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: { colorPrimary: '#1677ff', borderRadius: 6 },
      }}
    >
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
