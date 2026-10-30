import { useEffect, useState } from 'react';
import { Layout, Menu, Dropdown, Space, Tooltip, App as AntApp } from 'antd';
import {
  DashboardOutlined,
  KeyOutlined,
  ApiOutlined,
  UserSwitchOutlined,
  PartitionOutlined,
  SettingOutlined,
  FileTextOutlined,
  BarChartOutlined,
  EditOutlined,
  BlockOutlined,
  FundOutlined,
  LogoutOutlined,
  GlobalOutlined,
  BulbOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert } from 'antd';
import { authApi } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { AuthState } from '../api/client';
import { currentLang, setLang } from '../i18n';
import { setTheme, applyTheme } from '../theme';

const { Header, Sider, Content } = Layout;

export default function PanelLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { setPhase } = useAuth();
  const { message } = AntApp.useApp();
  const [collapsed, setCollapsed] = useState(false);

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: t('nav.dashboard') },
    { key: '/auth-files', icon: <KeyOutlined />, label: t('nav.authFiles') },
    { key: '/oauth', icon: <UserSwitchOutlined />, label: t('nav.oauth') },
    { key: '/keys', icon: <ApiOutlined />, label: t('nav.apiKeys') },
    { key: '/models', icon: <PartitionOutlined />, label: t('nav.models') },
    { key: '/routing', icon: <FundOutlined />, label: t('nav.routing') },
    { key: '/server', icon: <SettingOutlined />, label: t('nav.server') },
    { key: '/logs', icon: <FileTextOutlined />, label: t('nav.logs') },
    { key: '/usage', icon: <BarChartOutlined />, label: t('nav.usage') },
    { key: '/config', icon: <EditOutlined />, label: t('nav.config') },
    { key: '/plugins', icon: <BlockOutlined />, label: t('nav.plugins') },
    { key: '/system', icon: <RocketOutlined />, label: t('nav.system') },
    { key: '/settings', icon: <SettingOutlined />, label: t('nav.settings') },
  ];

  const selected = menuItems
    .map((m) => m.key)
    .filter((k) => k !== '/' && location.pathname.startsWith(k))
    .sort((a, b) => b.length - a.length)[0] ?? '/';

  // Remember where the operator was, so re-login lands back here.
  useEffect(() => {
    try {
      sessionStorage.setItem('panel-last-route', location.pathname);
    } catch {
      /* ignore */
    }
  }, [location.pathname]);

  // Backend connectivity indicator + session keep-alive/expiry warning.
  // Polling /panel/api/auth/state (instead of bare /healthz) also slides the
  // session forward, so an open panel stays signed in while in use.
  const [online, setOnline] = useState<boolean>(true);
  const [sessionState, setSessionState] = useState<AuthState | null>(null);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch('/panel/api/auth/state');
        if (alive) {
          setOnline(res.ok);
          if (res.ok) {
            try {
              setSessionState((await res.json()) as AuthState);
            } catch {
              /* ignore body parse */
            }
          }
        }
      } catch {
        if (alive) setOnline(false);
      }
    };
    void check();
    const timer = setInterval(check, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const remaining = sessionState?.authenticated ? (sessionState.session_remaining_seconds ?? Infinity) : Infinity;
  const expiringSoon = remaining < 60 * 60;

  const doLogout = async () => {
    try {
      await authApi.logout();
    } finally {
      setPhase('login');
      message.success(t('auth.logoutSuccess'));
      navigate('/login');
    }
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} trigger={null} theme="light" style={{ borderRight: '1px solid rgba(128,128,128,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: collapsed ? '16px 12px' : '16px 16px', fontWeight: 700, fontSize: 15 }}>
          <img src="/panel/favicon.svg" alt="logo" style={{ width: 26, height: 26, flexShrink: 0 }} />
          {!collapsed && <span>CLIProxyAPI</span>}
        </div>
        <Menu mode="inline" selectedKeys={[selected]} items={menuItems} onClick={({ key }) => navigate(key)} style={{ borderInlineEnd: 'none' }} />
      </Sider>
      <Layout>
        <Header style={{ background: 'transparent', padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(128,128,128,0.2)' }}>
          <Space>
            {collapsed ? <MenuUnfoldOutlined onClick={() => setCollapsed(false)} /> : <MenuFoldOutlined onClick={() => setCollapsed(true)} />}
            <strong>{menuItems.find((m) => m.key === selected)?.label ?? t('app.title')}</strong>
          </Space>
          <Space size="middle">
            <Tooltip title={online ? t('layout.online') : t('layout.offline')}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  display: 'inline-block',
                  background: online ? '#52c41a' : '#ff4d4f',
                  boxShadow: online ? '0 0 4px rgba(82,196,26,0.6)' : '0 0 4px rgba(255,77,79,0.6)',
                }}
              />
            </Tooltip>
            <Dropdown
              menu={{
                items: [
                  { key: 'zh-CN', label: '中文' },
                  { key: 'en-US', label: 'English' },
                ],
                onClick: ({ key }) => setLang(key as string),
                selectable: true,
                defaultSelectedKeys: [currentLang()],
              }}
            >
              <span style={{ cursor: 'pointer' }}>
                <GlobalOutlined /> {t('common.language')}
              </span>
            </Dropdown>
            <span
              style={{ cursor: 'pointer' }}
              title={t('common.theme')}
              onClick={() => setTheme(applyTheme() === 'dark' ? 'light' : 'dark')}
            >
              <BulbOutlined />
            </span>
            <span style={{ cursor: 'pointer' }} onClick={doLogout}>
              <LogoutOutlined /> {t('common.logout')}
            </span>
          </Space>
        </Header>
        <Content style={{ padding: 20, overflow: 'auto' }}>
          {expiringSoon && (
            <Alert
              style={{ marginBottom: 16 }}
              type="warning"
              showIcon
              message={t('layout.sessionExpiring').replace('{{minutes}}', String(Math.max(1, Math.round(remaining / 60))))}
            />
          )}
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
