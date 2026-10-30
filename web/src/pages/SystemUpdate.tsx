import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Descriptions,
  Modal,
  Result,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  CloudDownloadOutlined,
  ReloadOutlined,
  RocketOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { api, PANEL_API } from '../api/client';

const { Text } = Typography;

interface UpdateStatus {
  current_version: string;
  current_commit: string;
  current_build_date: string;
  latest_version: string;
  latest_published_at: string;
  update_available: boolean;
  goos: string;
  goarch: string;
  executable_path: string;
  in_docker: boolean;
  asset_name?: string;
  asset_size?: number;
  checksum_sha256?: string;
  note?: string;
}

type Phase = 'idle' | 'applying' | 'restarting' | 'done' | 'failed';

export default function SystemUpdate() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<UpdateStatus>(`${PANEL_API}/system/update/status`);
      setStatus(data);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  // After the server restarts, poll the state endpoint until it answers again,
  // then reload so the SPA picks up the new session (login) and build.
  const watchRestart = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${PANEL_API}/auth/state`);
        if (res.ok) {
          if (pollRef.current) clearInterval(pollRef.current);
          setPhase('done');
          setTimeout(() => window.location.reload(), 1500);
        }
      } catch {
        /* still down */
      }
    }, 2000);
  }, []);

  const applyUpdate = () => {
    setPhase('applying');
    setError(null);
    api
      .post<{ status: string; restarting: boolean; message?: string }>(`${PANEL_API}/system/update/apply`)
      .then((res) => {
        if (res.restarting) {
          try { localStorage.setItem('panel-updated', res.status === 'updated' ? '1' : '1'); } catch { /* ignore */ }
          setPhase('restarting');
          watchRestart();
        } else {
          setPhase('done');
          message.info(res.message ?? t('system.updateManualRestart'));
        }
      })
      .catch((e) => {
        setError((e as Error).message);
        setPhase('failed');
      });
  };

  const restartNow = () => {
    setPhase('restarting');
    setError(null);
    api
      .post<{ status: string }>(`${PANEL_API}/system/restart`)
      .then(() => watchRestart())
      .catch((e) => {
        setError((e as Error).message);
        setPhase('failed');
      });
  };

  const fmtSize = (n?: number) => (n ? `${(n / 1024 / 1024).toFixed(1)} MB` : '—');

  return (
    <div>
      {status?.in_docker && (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message={t('system.dockerWarning')}
        />
      )}
      <Card
        title={t('system.title')}
        style={{ marginBottom: 16 }}
        extra={
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
            {t('common.refresh')}
          </Button>
        }
      >
        <Space size="large" wrap align="start">
          <Card size="small" style={{ minWidth: 220 }}>
            <Statistic title={t('dashboard.currentVersion')} value={status?.current_version || '—'} />
            <div style={{ marginTop: 8 }}>
              {status?.latest_version && (
                <a
                  href={`https://github.com/router-for-me/CLIProxyAPI/releases/tag/${status.latest_version}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12 }}
                >
                  {t('system.releaseNotes')}
                </a>
              )}
              <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                {t('system.commit')}: {status?.current_commit || '—'}
              </Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('system.buildDate')}: {status?.current_build_date || '—'}
              </Text>
            </div>
          </Card>
          <Card size="small" style={{ minWidth: 220 }}>
            <Statistic title={t('system.latestVersion')} value={status?.latest_version || '—'} />
            {status?.latest_published_at && (
              <div style={{ marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {new Date(status.latest_published_at).toLocaleString()}
                </Text>
              </div>
            )}
          </Card>
          <Card size="small" style={{ minWidth: 260 }}>
            {loading ? (
              <Text type="secondary">{t('common.loading')}</Text>
            ) : status?.update_available ? (
              <Space direction="vertical" size={4}>
                <Tag color="orange" style={{ fontSize: 13 }}>
                  {t('system.updateAvailable')}
                </Tag>
                {status.asset_name && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {status.asset_name} ({fmtSize(status.asset_size)})
                  </Text>
                )}
                <Button
                  type="primary"
                  icon={<CloudDownloadOutlined />}
                  loading={phase === 'applying'}
                  disabled={phase === 'restarting'}
                  onClick={() => {
                    Modal.confirm({
                      title: t('system.confirmUpdateTitle'),
                      content: t('system.confirmUpdateBody', {
                        version: status?.latest_version ?? '',
                      }),
                      okText: t('common.confirm'),
                      cancelText: t('common.cancel'),
                      onOk: applyUpdate,
                    });
                  }}
                >
                  {t('system.updateNow')}
                </Button>
              </Space>
            ) : (
              <Space direction="vertical" size={4}>
                <Tag color="green" icon={<CheckCircleOutlined />} style={{ fontSize: 13 }}>
                  {t('dashboard.upToDate')}
                </Tag>
                <Button icon={<RocketOutlined />} onClick={() => void restartNow()} disabled={phase === 'restarting'}>
                  {t('system.restartServer')}
                </Button>
              </Space>
            )}
          </Card>
        </Space>
        {status?.note && (
          <p style={{ color: '#999', fontSize: 12, marginTop: 12 }}>{status.note}</p>
        )}
      </Card>

      <Card title={t('system.detailsTitle')} style={{ marginBottom: 16 }}>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label={t('system.platform')}>
            {status ? `${status.goos}/${status.goarch}` : '—'}
          </Descriptions.Item>
          <Descriptions.Item label={t('system.executablePath')}>
            <Text code style={{ fontSize: 12, wordBreak: 'break-all' }}>
              {status?.executable_path || '—'}
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label={t('system.checksum')}>
            <Text code style={{ fontSize: 12, wordBreak: 'break-all' }}>
              {status?.checksum_sha256 || '—'}
            </Text>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <ModelsViewer />

      {phase === 'restarting' && (
        <Card>
          <Result
            icon={<RocketOutlined spin />}
            title={t('system.restartingTitle')}
            subTitle={t('system.restartingDesc')}
          />
        </Card>
      )}
      {phase === 'done' && (
        <Card>
          <Result status="success" title={t('system.doneTitle')} subTitle={t('system.doneDesc')} />
        </Card>
      )}
      {phase === 'failed' && error && (
        <Card>
          <Result status="error" title={t('common.failed')} subTitle={error} />
        </Card>
      )}
    </div>
  );
}

interface ModelEntry {
  id: string;
  owned_by?: string;
  display_name?: string;
  context_length?: number;
  providers?: string[];
}

// ModelsViewer lists the models the proxy currently exposes through /v1/models,
// called with the first configured client API key (same approach as the
// upstream management center).
function ModelsViewer() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [models, setModels] = useState<ModelEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setHint(null);
    try {
      const keys = await api.get<{ 'api-keys'?: string[] }>(`${PANEL_API.replace('/api', '')}/api/v0/management/api-keys`);
      const first = (keys['api-keys'] ?? [])[0];
      if (!first) {
        setHint(t('system.modelsNeedKey'));
        setModels([]);
        return;
      }
      const res = await fetch('/v1/models', { headers: { Authorization: `Bearer ${first}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { data?: ModelEntry[] };
      setModels((data.data ?? []).sort((a, b) => a.id.localeCompare(b.id)));
    } catch (e) {
      setHint((e as Error).message);
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = new Map<string, ModelEntry[]>();
  for (const m of models ?? []) {
    const owner = m.owned_by || m.providers?.[0] || '—';
    if (!grouped.has(owner)) grouped.set(owner, []);
    grouped.get(owner)!.push(m);
  }

  return (
    <Card
      title={t('system.modelsTitle')}
      style={{ marginBottom: 16 }}
      extra={
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
          {t('common.refresh')}
        </Button>
      }
    >
      {hint && <Alert style={{ marginBottom: 12 }} type="info" showIcon message={hint} />}
      {models && models.length > 0 && (
        <p style={{ color: '#888', marginTop: 0 }}>
          {t('system.modelsCount').replace('{{count}}', String(models.length))}
        </p>
      )}
      {grouped.size === 0 && !hint ? (
        <Text type="secondary">—</Text>
      ) : (
        [...grouped.entries()].map(([owner, entries]) => (
          <Card key={owner} type="inner" size="small" title={<Tag color="geekblue">{owner}</Tag>} style={{ marginBottom: 10 }}>
            <Table
              rowKey="id"
              size="small"
              dataSource={entries}
              pagination={entries.length > 20 ? { pageSize: 20 } : false}
              columns={[
                { title: 'Model ID', dataIndex: 'id', render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
                { title: 'Name', dataIndex: 'display_name', render: (v: string) => v || '—' },
              ]}
            />
          </Card>
        ))
      )}
    </Card>
  );
}
