import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { App as AntApp, Button, Spin } from 'antd';
import { useEffect } from 'react';
import { lazy, Suspense, Component, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

const SetupWizard = lazy(() => import('./pages/SetupWizard'));
const Login = lazy(() => import('./pages/Login'));
const PanelLayout = lazy(() => import('./layouts/PanelLayout'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const AuthFiles = lazy(() => import('./pages/AuthFiles'));
const OAuthLogin = lazy(() => import('./pages/OAuthLogin'));
const ApiKeys = lazy(() => import('./pages/ApiKeys'));
const Models = lazy(() => import('./pages/Models'));
const Routing = lazy(() => import('./pages/Routing'));
const ServerSettings = lazy(() => import('./pages/ServerSettings'));
const Logs = lazy(() => import('./pages/Logs'));
const Usage = lazy(() => import('./pages/Usage'));
const ConfigEditor = lazy(() => import('./pages/ConfigEditor'));
const Plugins = lazy(() => import('./pages/Plugins'));
const Settings = lazy(() => import('./pages/Settings'));
const SystemUpdate = lazy(() => import('./pages/SystemUpdate'));

function Gate({ children }: { children: React.ReactNode }) {
  const { phase } = useAuth();
  if (phase === 'loading') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }
  if (phase === 'unavailable') return <PanelUnavailable />;
  if (phase === 'setup') return <Navigate to="/setup" replace />;
  if (phase === 'login') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { phase } = useAuth();
  if (phase === 'loading') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }
  if (phase === 'unavailable') return <PanelUnavailable />;
  if (phase === 'ready') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PanelUnavailable() {
  const { state } = useAuth();
  const { t } = useTranslation();
  const reason = state?.error === 'remote' || state?.remote_allowed === false ? t('auth.remoteDisabled') : t('auth.panelDisabled');
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', padding: 24 }}>
      <div style={{ maxWidth: 520, textAlign: 'center' }}>
        <h2>CLIProxyAPI Panel</h2>
        <p style={{ color: '#888' }}>{reason}</p>
      </div>
    </div>
  );
}

function UpdateToast() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  useEffect(() => {
    if (localStorage.getItem('panel-updated')) {
      localStorage.removeItem('panel-updated');
      message.success(t('system.updatedToast'), 6);
    }
  }, []);
  return null;
}

// ErrorBoundary keeps a crashing page from blanking the whole panel.
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', padding: 24 }}>
          <div style={{ maxWidth: 520, textAlign: 'center' }}>
            <h2>面板页面出错</h2>
            <p style={{ color: '#888', wordBreak: 'break-all', fontSize: 12 }}>{this.state.error.message}</p>
            <Button type="primary" onClick={() => window.location.reload()}>
              刷新页面
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <AuthProvider>
      <ErrorBoundary>
      <HashRouter>
        <UpdateToast />
        <Suspense
          fallback={
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
              <Spin size="large" />
            </div>
          }
        >
        <Routes>
          <Route
            path="/setup"
            element={
              <PublicOnly>
                <SetupWizard />
              </PublicOnly>
            }
          />
          <Route
            path="/login"
            element={
              <PublicOnly>
                <Login />
              </PublicOnly>
            }
          />
          <Route
            path="/"
            element={
              <Gate>
                <PanelLayout />
              </Gate>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="auth-files" element={<AuthFiles />} />
            <Route path="oauth" element={<OAuthLogin />} />
            <Route path="keys" element={<ApiKeys />} />
            <Route path="models" element={<Models />} />
            <Route path="routing" element={<Routing />} />
            <Route path="server" element={<ServerSettings />} />
            <Route path="logs" element={<Logs />} />
            <Route path="usage" element={<Usage />} />
            <Route path="config" element={<ConfigEditor />} />
            <Route path="plugins" element={<Plugins />} />
            <Route path="system" element={<SystemUpdate />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </HashRouter>
      </ErrorBoundary>
    </AuthProvider>
  );
}
