import { useCallback, useEffect, useState } from 'react';
import { Table } from 'antd';
import {
  Alert,
  App as AntApp,
  Button,
  Collapse,
  Descriptions,
  Drawer,
  Input,
  Popconfirm,
  Space,
  Spin,
  Statistic,
  Tag,
  theme as antdTheme,
  Typography,
} from 'antd';
import { ExportOutlined, ThunderboltOutlined, UserSwitchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { mgmt, mgmtV8 } from '../api/client';

const { Text } = Typography;

export interface AuthFileEntry {
  id: string;
  auth_index?: string;
  name: string;
  provider: string;
  type?: string;
  label?: string;
  status: string;
  status_message?: string;
  disabled: boolean;
  unavailable: boolean;
  email?: string;
  account?: string;
  project_id?: string;
  account_type?: string;
  updated_at?: string;
  created_at?: string;
  last_refresh?: string;
  next_retry_after?: string;
  size?: number;
  source?: string;
  priority?: number;
  success?: number;
  failed?: number;
  recent_requests?: Array<{ time: string; success: number; failed: number }>;
  quota?: unknown;
  model_quotas?: unknown;
  id_token?: unknown;
  supports_quota?: boolean;
  quota_plugin_id?: string;
  cooldowns?: Array<{ scope: string; model_key?: string; reason: string; retry_at: string; remaining_seconds: number; backoff_level?: number; http_status?: number }>;
  [key: string]: unknown;
}

interface QuotaBucket {
  label?: string;
  used?: number;
  limit?: number;
  unit?: string;
  remaining?: number;
  [key: string]: unknown;
}

interface QuotaMetric {
  key: string;
  label?: string;
  value: number;
  unit?: string;
  currency?: string;
}

interface QuotaFetchResult {
  subscription?: { plan?: string; tierName?: string };
  summary?: QuotaMetric[];
  groups?: Array<{ displayName?: string; buckets?: unknown }>;
}

export default function CredentialDetail({
  entry,
  onClose,
  onChanged,
}: {
  entry: AuthFileEntry | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const { token } = antdTheme.useToken();
  const [quota, setQuota] = useState<QuotaFetchResult | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [siwcStatus, setSiwcStatus] = useState<string | null>(null);
  const [siwcBusy, setSiwcBusy] = useState(false);
  const [siwcUrl, setSiwcUrl] = useState<string | null>(null);
  const [siwcState, setSiwcState] = useState<string | null>(null);
  const [callbackUrl, setCallbackUrl] = useState('');

  useEffect(() => {
    setQuota(null);
    setSiwcStatus(null);
    setSiwcUrl(null);
    setSiwcState(null);
    setCallbackUrl('');
  }, [entry?.id]);

  const fetchQuota = useCallback(async () => {
    if (!entry) return;
    setQuotaLoading(true);
    try {
      const body: Record<string, unknown> = { auth_index: entry.auth_index ?? entry.id };
      if (entry.quota_plugin_id) body.plugin_id = entry.quota_plugin_id;
      const data = await mgmt.post<QuotaFetchResult>('/quota/fetch', body);
      setQuota(data);
      message.success(t('common.success'));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setQuotaLoading(false);
    }
  }, [entry, message, t]);

  const resetQuota = useCallback(async () => {
    if (!entry) return;
    try {
      const body: Record<string, unknown> = { auth_index: entry.auth_index ?? entry.id };
      if (entry.quota_plugin_id) body.plugin_id = entry.quota_plugin_id;
      await mgmt.post('/quota/reset', body);
      message.success(t('common.success'));
      onChanged();
    } catch (e) {
      message.error((e as Error).message);
    }
  }, [entry, message, t, onChanged]);

  const checkSiwc = useCallback(async () => {
    if (!entry) return;
    try {
      const data = await mgmtV8.get<{ status: string }>(
        `/credentials/siwc/status?name=${encodeURIComponent(entry.name)}&auth_index=${encodeURIComponent(entry.auth_index ?? '')}`,
      );
      setSiwcStatus(data.status);
    } catch (e) {
      message.error((e as Error).message);
    }
  }, [entry, message]);

  const startSiwc = useCallback(async () => {
    if (!entry) return;
    setSiwcBusy(true);
    try {
      const data = await mgmtV8.post<{ status: string; url: string; state: string }>(
        '/oauth/siwc/bind',
        { name: entry.name },
      );
      setSiwcUrl(data.url);
      setSiwcState(data.state);
      window.open(data.url, '_blank', 'noopener');
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSiwcBusy(false);
    }
  }, [entry, message]);

  const submitSiwcCallback = useCallback(async () => {
    if (!siwcState || !callbackUrl.trim()) return;
    try {
      await mgmtV8.post('/oauth/callback', { redirect_url: callbackUrl.trim(), state: siwcState });
      message.success(t('common.success'));
      setSiwcUrl(null);
      setCallbackUrl('');
      void checkSiwc();
      onChanged();
    } catch (e) {
      message.error((e as Error).message);
    }
  }, [siwcState, callbackUrl, message, t, checkSiwc, onChanged]);

  if (!entry) return null;

  const buckets = entry.recent_requests ?? [];
  const cooldowns = (entry.cooldowns ?? []) as NonNullable<AuthFileEntry['cooldowns']>;
  const modelQuotas = (entry.model_quotas ?? null) as Record<string, Record<string, unknown>> | null;
  const idToken = (entry.id_token ?? null) as Record<string, unknown> | null;
  const maxBucket = Math.max(1, ...buckets.map((b) => b.success + b.failed));

  return (
    <Drawer title={`${t('credDetail.title')} — ${entry.name}`} open={!!entry} onClose={onClose} width={640}>
      <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
        <Descriptions.Item label={t('authFiles.provider')}>
          <Space>
            <Tag color="geekblue">{entry.provider || entry.type}</Tag>
            {entry.label && <Text type="secondary">{entry.label}</Text>}
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label={t('common.status')}>
          <Space wrap>
            <Tag color={entry.disabled ? 'default' : entry.unavailable || entry.status === 'error' ? 'error' : 'success'}>
              {entry.disabled ? t('authFiles.statusDisabled') : entry.unavailable || entry.status === 'error' ? t('authFiles.statusError') : t('authFiles.statusActive')}
            </Tag>
            {entry.status_message && <Text type="secondary" style={{ fontSize: 12 }}>{entry.status_message}</Text>}
          </Space>
        </Descriptions.Item>
        {entry.email && <Descriptions.Item label={t('authFiles.email')}>{entry.email}</Descriptions.Item>}
        {entry.account && <Descriptions.Item label={t('authFiles.account')}>{entry.account}</Descriptions.Item>}
        {entry.project_id && <Descriptions.Item label="Project ID">{entry.project_id}</Descriptions.Item>}
        {entry.priority !== undefined && <Descriptions.Item label={t('authFiles.priority')}>{entry.priority}</Descriptions.Item>}
        <Descriptions.Item label={t('authFiles.source')}>
          {entry.source === 'file' ? `${t('authFiles.file')} (${fmtSize(entry.size)})` : t('authFiles.memory')}
        </Descriptions.Item>
        {entry.updated_at && (
          <Descriptions.Item label={t('authFiles.updatedAt')}>{new Date(entry.updated_at).toLocaleString()}</Descriptions.Item>
        )}
        {entry.last_refresh && (
          <Descriptions.Item label={t('authFiles.lastRefresh')}>{new Date(entry.last_refresh).toLocaleString()}</Descriptions.Item>
        )}
      </Descriptions>

      <Cardish title={t('credDetail.runtime')}>
        <Space size="large" wrap>
          <Statistic title={t('credDetail.successTotal')} value={entry.success ?? 0} valueStyle={{ fontSize: 20 }} />
          <Statistic title={t('credDetail.failedTotal')} value={entry.failed ?? 0} valueStyle={{ fontSize: 20, color: (entry.failed ?? 0) > 0 ? '#cf1322' : undefined }} />
          {entry.next_retry_after && (
            <Statistic title={t('credDetail.nextRetry')} value={new Date(entry.next_retry_after).toLocaleTimeString()} valueStyle={{ fontSize: 14 }} />
          )}
        </Space>
        {buckets.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>{t('credDetail.recentRequests')}</Text>
            <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 56, marginTop: 6 }}>
              {buckets.map((b, i) => {
                const total = b.success + b.failed;
                return (
                  <div key={i} title={`${b.time}: +${b.success} / -${b.failed}`} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                    {total > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: `${(total / maxBucket) * 100}%` }}>
                        {b.failed > 0 && <div style={{ background: '#ff7875', height: `${(b.failed / total) * 100}%`, minHeight: 2 }} />}
                        {b.success > 0 && <div style={{ background: '#95de64', height: `${(b.success / total) * 100}%`, minHeight: 2 }} />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {cooldowns.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>{t('credDetail.cooldowns')}</Text>
            <Table
              size="small"
              style={{ marginTop: 6 }}
              rowKey={(r, i) => String(i)}
              dataSource={cooldowns}
              pagination={false}
              columns={[
                { title: t('credDetail.cooldownScope'), dataIndex: 'scope', width: 100, render: (v: string, r: any) => <Tag color="orange" style={{ fontSize: 11 }}>{v === 'credential' ? t('credDetail.cooldownCredential') : r.model_key || v}</Tag> },
                { title: t('credDetail.cooldownReason'), dataIndex: 'reason', render: (v: string) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
                { title: t('credDetail.cooldownRetry'), dataIndex: 'remaining_seconds', width: 110, render: (v: number) => <Text style={{ fontSize: 12 }}>{v > 0 ? `${Math.ceil(v / 60)} min` : '—'}</Text> },
                { title: 'HTTP', dataIndex: 'http_status', width: 70, render: (v: number) => (v ? <Text style={{ fontSize: 12 }} code>{v}</Text> : '—') },
              ]}
            />
          </div>
        )}
      </Cardish>

      {(!!entry.supports_quota || !!entry.quota || !!entry.model_quotas) && (
        <Cardish title={t('credDetail.quotaSection')}>
          <Space wrap style={{ marginBottom: 12 }}>
            {entry.supports_quota && (
              <>
                <Button size="small" icon={<ThunderboltOutlined />} loading={quotaLoading} onClick={() => void fetchQuota()}>
                  {t('credDetail.fetchQuota')}
                </Button>
                <Popconfirm title={t('common.confirm')} onConfirm={() => void resetQuota()} okButtonProps={{ danger: true }}>
                  <Button size="small" danger>
                    {t('authFiles.resetQuota')}
                  </Button>
                </Popconfirm>
              </>
            )}
          </Space>
          {quota && (
            <div>
              {quota.subscription && (
                <p style={{ marginBottom: 6 }}>
                  <Text strong>{quota.subscription.plan ?? '—'}</Text>
                  {quota.subscription.tierName && <Tag style={{ marginLeft: 8 }}>{quota.subscription.tierName}</Tag>}
                </p>
              )}
              {quota.summary?.map((m) => (
                <div key={m.key} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px dashed ${token.colorBorderSecondary}`, padding: '4px 0' }}>
                  <Text type="secondary">{m.label ?? m.key}</Text>
                  <Text strong>
                    {m.value}
                    {m.unit ? ` ${m.unit}` : ''}
                    {m.currency ? ` ${m.currency}` : ''}
                  </Text>
                </div>
              ))}
              {quota.groups && quota.groups.length > 0 && (
                <Collapse
                  size="small"
                  style={{ marginTop: 8 }}
                  items={quota.groups.map((g, i) => ({
                    key: String(i),
                    label: g.displayName ?? `Group ${i + 1}`,
                    children: <pre style={{ fontSize: 11, maxHeight: 220, overflow: 'auto' }}>{JSON.stringify(g.buckets ?? {}, null, 2)}</pre>,
                  }))}
                />
              )}
            </div>
          )}
          {modelQuotas && Object.keys(modelQuotas).length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>{t('credDetail.modelQuotas')}</Text>
              <Table
                size="small"
                style={{ marginTop: 6 }}
                rowKey="model"
                dataSource={Object.entries(modelQuotas).map(([model, q]) => ({ model, ...(q as object) }))}
                pagination={false}
                columns={[
                  { title: t('keys.modelName'), dataIndex: 'model', render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
                  { title: t('credDetail.quotaState'), dataIndex: 'state', render: (v: string) => (v ? <Tag style={{ fontSize: 11 }}>{v}</Tag> : '—') },
                  { title: t('credDetail.quotaDetail'), key: 'detail', render: (_, r: any) => (
                    <Text style={{ fontSize: 11, wordBreak: 'break-all' }}>
                      {JSON.stringify(r.signals ?? r.quota ?? r)}
                    </Text>
                  ) },
                ]}
              />
            </div>
          )}
          {!!entry.quota && (
            <Collapse
              size="small"
              style={{ marginTop: 8 }}
              items={[
                { key: 'q', label: t('authFiles.quota'), children: <pre style={{ fontSize: 11, maxHeight: 200, overflow: 'auto' }}>{JSON.stringify(entry.quota, null, 2)}</pre> },
              ]}
            />
          )}
        </Cardish>
      )}

      {(entry.provider || entry.type || '').toLowerCase() === 'codex' && (
        <Cardish title={t('credDetail.siwc')}>
          <Space wrap style={{ marginBottom: 8 }}>
            <Button size="small" onClick={() => void checkSiwc()}>
              {t('credDetail.siwcCheck')}
            </Button>
            <Button size="small" icon={<UserSwitchOutlined />} loading={siwcBusy} onClick={() => void startSiwc()} disabled={!!siwcUrl}>
              {t('credDetail.siwcBind')}
            </Button>
            {siwcStatus && <Tag color="blue">{t('credDetail.siwcStatus')}: {siwcStatus}</Tag>}
          </Space>
          {siwcUrl && (
            <Alert
              type="info"
              showIcon={false}
              message={t('credDetail.siwcFlow')}
              description={
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Space wrap>
                    <Button size="small" icon={<ExportOutlined />} href={siwcUrl} target="_blank">
                      {t('oauth.openAuthUrl')}
                    </Button>
                    <Text copyable={{ text: siwcUrl }} style={{ fontSize: 12, wordBreak: 'break-all' }}>
                      {siwcUrl.slice(0, 80)}…
                    </Text>
                  </Space>
                  <Input
                    value={callbackUrl}
                    onChange={(e) => setCallbackUrl(e.target.value)}
                    placeholder={t('credDetail.siwcCallbackPlaceholder')}
                  />
                  <Button type="primary" size="small" onClick={() => void submitSiwcCallback()} disabled={!callbackUrl.trim()}>
                    {t('credDetail.siwcSubmit')}
                  </Button>
                </Space>
              }
            />
          )}
        </Cardish>
      )}

      {idToken && Object.keys(idToken).length > 0 && (
        <Cardish title={t('credDetail.idToken')}>
          <Descriptions column={1} size="small" bordered>
            {Object.entries(idToken).map(([k, v]) => (
              <Descriptions.Item key={k} label={k}>
                <Text style={{ fontSize: 12, wordBreak: 'break-all' }}>{String(v ?? '')}</Text>
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Cardish>
      )}

      <Collapse
        size="small"
        style={{ marginTop: 12 }}
        items={[
          {
            key: 'raw',
            label: t('credDetail.rawJson'),
            children: (
              <pre style={{ fontSize: 11, maxHeight: 320, overflow: 'auto' }}>
                {JSON.stringify(redact(entry), null, 2)}
              </pre>
            ),
          },
        ]}
      />
    </Drawer>
  );
}

function Cardish({ title, children }: { title: string; children: React.ReactNode }) {
  const { token } = antdTheme.useToken();
  return (
    <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 8, padding: '12px 16px', marginBottom: 12 }}>
      <Text strong style={{ display: 'block', marginBottom: 8 }}>{title}</Text>
      {children}
    </div>
  );
}

function fmtSize(n?: number): string {
  return n ? `${(n / 1024).toFixed(1)} KB` : '—';
}

// redact removes obvious secrets from the raw JSON view.
function redact(entry: AuthFileEntry): unknown {
  const clone: Record<string, unknown> = { ...entry };
  for (const key of Object.keys(clone)) {
    if (/token|secret|api[-_]?key|cookie|password/i.test(key)) {
      clone[key] = '***';
    }
  }
  return clone;
}
