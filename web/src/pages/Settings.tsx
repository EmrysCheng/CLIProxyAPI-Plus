import { useCallback, useEffect, useState } from 'react';
import { App as AntApp, Button, Card, Form, Input, Space, Switch, Table, Tabs, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { api, authApi, PANEL_API } from '../api/client';
import { setTheme, applyTheme } from '../theme';
import { setLang, currentLang } from '../i18n';

const { Text } = Typography;

const MGMT_TREE = '/panel/api/v8/management/config/management';

interface AuditEntry {
  time: string;
  ip: string;
  method: string;
  path: string;
  status?: number;
  event?: string;
}

function AuditLog() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ entries: AuditEntry[] }>(`${PANEL_API}/system/audit?limit=200`);
      setEntries(data.entries ?? []);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card
      title={t('settings.auditTitle')}
      extra={
        <Button onClick={() => void load()} loading={loading}>
          {t('common.refresh')}
        </Button>
      }
    >
      <p style={{ color: '#888', marginTop: 0 }}>{t('settings.auditDesc')}</p>
      <Table
        rowKey={(r) => `${r.time}-${r.method}-${r.path}-${r.status ?? ''}`}
        size="small"
        loading={loading}
        dataSource={entries}
        pagination={{ pageSize: 15 }}
        locale={{ emptyText: <Text type="secondary">{t('settings.auditEmpty')}</Text> }}
        columns={[
          { title: t('settings.auditTime'), dataIndex: 'time', width: 190, render: (v: string) => new Date(v).toLocaleString() },
          { title: 'IP', dataIndex: 'ip', width: 130, render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
          { title: t('settings.auditAction'), key: 'action', width: 260, render: (_, r: AuditEntry) => (
            <Space size={6}>
              {r.event ? (
                <Text style={{ fontSize: 12 }} code>{r.event}</Text>
              ) : (
                <>
                  <Text style={{ fontSize: 12 }} code>{r.method}</Text>
                  <Text style={{ fontSize: 12, wordBreak: 'break-all' }}>{r.path}</Text>
                </>
              )}
            </Space>
          ) },
          { title: t('common.status'), dataIndex: 'status', width: 90, render: (v?: number) => (v ? <Text style={{ fontSize: 12, color: v >= 400 ? '#cf1322' : undefined }}>{v}</Text> : '—') },
        ]}
      />
    </Card>
  );
}

interface MgmtSection {
  'secret-key'?: string;
  'allow-remote'?: boolean;
  [key: string]: unknown;
}

async function fetchMgmtSection(): Promise<{ data: MgmtSection; etag: string } | null> {
  const res = await fetch(MGMT_TREE);
  if (!res.ok) return null;
  const etag = res.headers.get('ETag') ?? '';
  const data = (await res.json()) as MgmtSection;
  return { data, etag };
}

async function patchMgmtSection(next: MgmtSection, etag: string): Promise<void> {
  const res = await fetch(MGMT_TREE, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) },
    body: JSON.stringify(next),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
}

function ChangePassword() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);

  const submit = async (values: { old_password: string; new_password: string; confirm: string }) => {
    if (values.new_password !== values.confirm) {
      message.error(t('auth.setupMismatch'));
      return;
    }
    setBusy(true);
    try {
      await authApi.changePassword(values.old_password, values.new_password);
      message.success(t('auth.changePasswordOk'));
      form.resetFields();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('auth.changePassword')} style={{ marginBottom: 16 }}>
      <Form form={form} layout="vertical" onFinish={submit} style={{ maxWidth: 420 }}>
        <Form.Item name="old_password" label={t('auth.oldPassword')} rules={[{ required: true }]}>
          <Input.Password />
        </Form.Item>
        <Form.Item name="new_password" label={t('auth.newPassword')} rules={[{ required: true, min: 8, message: t('auth.setupTooShort') }]}>
          <Input.Password />
        </Form.Item>
        <Form.Item name="confirm" label={t('auth.setupConfirm')} rules={[{ required: true }]}>
          <Input.Password />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={busy}>
          {t('common.save')}
        </Button>
      </Form>
    </Card>
  );
}

function ManagementSettings() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [secretKey, setSecretKey] = useState('');
  const [allowRemote, setAllowRemote] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const section = await fetchMgmtSection();
      if (section) setAllowRemote(Boolean(section.data['allow-remote']));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSecretKey = async () => {
    setBusy(true);
    try {
      const section = await fetchMgmtSection();
      if (!section) throw new Error('config unavailable');
      await patchMgmtSection({ ...section.data, 'secret-key': secretKey.trim() }, section.etag);
      message.success(t('settings.saved'));
      setSecretKey('');
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveAllowRemote = async (v: boolean) => {
    const prev = allowRemote;
    setAllowRemote(v);
    setBusy(true);
    try {
      const section = await fetchMgmtSection();
      if (!section) throw new Error('config unavailable');
      await patchMgmtSection({ ...section.data, 'allow-remote': v }, section.etag);
      message.success(t('settings.saved'));
    } catch (e) {
      setAllowRemote(prev);
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('settings.mgmtSection')} style={{ marginBottom: 16 }}>
      <p style={{ color: '#888', marginTop: 0 }}>{t('settings.secretKeyDesc')}</p>
      <Space.Compact style={{ width: '100%', maxWidth: 560, marginBottom: 16 }}>
        <Input.Password
          value={secretKey}
          placeholder={t('settings.secretKeyNew')}
          onChange={(e) => setSecretKey(e.target.value)}
          onPressEnter={() => secretKey.trim() && void saveSecretKey()}
        />
        <Button type="primary" loading={busy} onClick={() => void saveSecretKey()} disabled={!secretKey.trim()}>
          {t('common.save')}
        </Button>
      </Space.Compact>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Text strong>{t('settings.allowRemote')}</Text>
        <Switch checked={!!allowRemote} loading={busy && allowRemote === null} onChange={(v) => void saveAllowRemote(v)} />
      </div>
      <p style={{ color: '#888', fontSize: 12 }}>{t('settings.allowRemoteDesc')}</p>
    </Card>
  );
}

function Appearance() {
  const { t } = useTranslation();
  return (
    <Card title={t('common.theme')} style={{ marginBottom: 16 }}>
      <Space size="large">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text>{t('common.theme')}</Text>
          <Button size="small" onClick={() => setTheme(applyTheme() === 'dark' ? 'light' : 'dark')}>
            {applyTheme() === 'dark' ? t('common.light') : t('common.dark')}
          </Button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text>{t('common.language')}</Text>
          <Button size="small" onClick={() => setLang(currentLang() === 'zh-CN' ? 'en-US' : 'zh-CN')}>
            {currentLang() === 'zh-CN' ? 'English' : '中文'}
          </Button>
        </div>
      </Space>
    </Card>
  );
}

export default function Settings() {
  const { t } = useTranslation();
  return (
    <div>
      <Tabs
        items={[
          {
            key: 'general',
            label: t('settings.title'),
            children: (
              <div>
                <ChangePassword />
                <ManagementSettings />
                <Appearance />
                <Card title={t('settings.about')}>
                  <Text type="secondary">{t('settings.aboutDesc')}</Text>
                </Card>
              </div>
            ),
          },
          { key: 'audit', label: t('settings.auditTab'), children: <AuditLog /> },
        ]}
      />
    </div>
  );
}
