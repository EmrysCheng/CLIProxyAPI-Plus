import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Card, Modal, Popconfirm, Space, Table, Tabs, Typography, Input } from 'antd';
import { DeleteOutlined, ReloadOutlined, CloudDownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { mgmt } from '../api/client';

const { Text } = Typography;

interface PluginInfo {
  id: string;
  name?: string;
  version?: string;
  enabled?: boolean;
  [key: string]: unknown;
}

interface StoreEntry {
  id?: string;
  name?: string;
  description?: string;
  [key: string]: unknown;
}

function InstalledPlugins() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [list, setList] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [configTarget, setConfigTarget] = useState<string | null>(null);
  const [configText, setConfigText] = useState('');
  const [quota, setQuota] = useState<{ id: string; text: string } | null>(null);

  const jsonError = useMemo(() => {
    if (!configText.trim()) return null;
    try {
      JSON.parse(configText);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, [configText]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mgmt.get<{ plugins?: PluginInfo[] } | PluginInfo[]>('/plugins');
      setList(Array.isArray(data) ? data : (data.plugins ?? []));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: string) => {
    try {
      await mgmt.del(`/plugins/${encodeURIComponent(id)}`);
      message.success(t('common.success'));
      void load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const openConfig = async (id: string) => {
    setConfigTarget(id);
    setConfigText('');
    try {
      const data = await mgmt.get<unknown>(`/plugins/${encodeURIComponent(id)}/config`);
      setConfigText(JSON.stringify(data, null, 2));
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const saveConfig = async () => {
    if (!configTarget) return;
    try {
      const parsed = JSON.parse(configText);
      await mgmt.put(`/plugins/${encodeURIComponent(configTarget)}/config`, parsed);
      message.success(t('common.success'));
      setConfigTarget(null);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const toggleEnabled = async (id: string, enabled: boolean) => {
    try {
      await mgmt.patch(`/plugins/${encodeURIComponent(id)}/enabled`, { enabled });
      message.success(t('common.success'));
      void load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const showQuota = async (id: string) => {
    try {
      const data = await mgmt.get<unknown>(`/plugins/${encodeURIComponent(id)}/quota`);
      setQuota({ id, text: JSON.stringify(data, null, 2) });
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <Card
      title={t('plugins.installed')}
      extra={
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
          {t('common.refresh')}
        </Button>
      }
    >
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={list}
        pagination={false}
        locale={{ emptyText: <Text type="secondary">{t('plugins.empty')}</Text> }}
        columns={[
          { title: t('plugins.id'), dataIndex: 'id', render: (v: string) => <Text strong>{v}</Text> },
          { title: 'Version', dataIndex: 'version', width: 100, render: (v?: string) => v || '—' },
          {
            title: t('common.status'),
            dataIndex: 'enabled',
            width: 110,
            render: (v?: boolean, r?: PluginInfo) => (
              <Button size="small" type="link" onClick={() => r && void toggleEnabled(r.id, !v)}>
                {v ? t('common.enabled') : t('common.disabled')}
              </Button>
            ),
          },
          {
            title: t('common.actions'),
            key: 'actions',
            width: 260,
            render: (_v: unknown, r: PluginInfo | undefined) => (
              <Space>
                <Button size="small" onClick={() => void openConfig(r!.id)}>
                  {t('plugins.config')}
                </Button>
                <Button size="small" onClick={() => void showQuota(r!.id)}>
                  {t('plugins.quota')}
                </Button>
                <Popconfirm title={t('plugins.deleteConfirm', { id: r!.id })} onConfirm={() => void remove(r!.id)} okButtonProps={{ danger: true }}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title={`${t('plugins.config')} — ${configTarget ?? ''}`}
        open={!!configTarget}
        onOk={() => void saveConfig()}
        onCancel={() => setConfigTarget(null)}
        okText={t('common.save')}
        okButtonProps={{ disabled: !!jsonError || !configText.trim() }}
        width={680}
      >
        <Input.TextArea rows={14} value={configText} onChange={(e) => setConfigText(e.target.value)} style={{ fontFamily: 'monospace' }} />
        {jsonError && <Alert style={{ marginTop: 8 }} type="error" showIcon message={`JSON: ${jsonError}`} />}
      </Modal>
      <Modal title={`${t('plugins.quota')} — ${quota?.id ?? ''}`} open={!!quota} onCancel={() => setQuota(null)} footer={null} width={680}>
        <pre style={{ maxHeight: 400, overflow: 'auto', fontSize: 12 }}>{quota?.text}</pre>
      </Modal>
    </Card>
  );
}

function PluginStore() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [list, setList] = useState<StoreEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mgmt.get<{ plugins?: StoreEntry[] } | StoreEntry[]>('/plugin-store');
      setList(Array.isArray(data) ? data : (data.plugins ?? []));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const install = async (id: string) => {
    setInstalling(id);
    try {
      await mgmt.post(`/plugin-store/${encodeURIComponent(id)}/install`);
      message.success(t('plugins.installedOk'));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setInstalling(null);
    }
  };

  return (
    <Card
      title={t('plugins.store')}
      extra={
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
          {t('common.refresh')}
        </Button>
      }
    >
      <Table
        rowKey={(r) => String(r?.id ?? r?.name)}
        size="small"
        loading={loading}
        dataSource={list}
        pagination={{ pageSize: 10 }}
        locale={{ emptyText: <Text type="secondary">{t('plugins.storeEmpty')}</Text> }}
        columns={[
          { title: t('plugins.id'), key: 'id', render: (_v: unknown, r: StoreEntry | undefined) => <Text strong>{String(r?.id ?? r?.name ?? '—')}</Text> },
          { title: 'Description', key: 'desc', render: (_v: unknown, r: StoreEntry | undefined) => <Text style={{ fontSize: 12 }}>{String(r?.description ?? '—')}</Text> },
          {
            title: t('common.actions'),
            key: 'actions',
            width: 130,
            render: (_v: unknown, r: StoreEntry | undefined) => (
              <Button
                size="small"
                type="primary"
                ghost
                icon={<CloudDownloadOutlined />}
                loading={installing === String(r?.id ?? r?.name)}
                onClick={() => void install(String(r?.id ?? r?.name))}
              >
                {t('plugins.install')}
              </Button>
            ),
          },
        ]}
      />
    </Card>
  );
}

export default function Plugins() {
  const { t } = useTranslation();
  return (
    <Tabs
      items={[
        { key: 'installed', label: t('plugins.installed'), children: <InstalledPlugins /> },
        { key: 'store', label: t('plugins.store'), children: <PluginStore /> },
      ]}
    />
  );
}
