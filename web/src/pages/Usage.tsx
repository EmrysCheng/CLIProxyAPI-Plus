import { useCallback, useEffect, useMemo, useState } from 'react';
import { App as AntApp, Button, Card, Empty, Space, Statistic, Table, Tabs, Typography } from 'antd';
import { ReloadOutlined, DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { mgmt } from '../api/client';
import { mergeRequestBuckets } from '../lib/panel';

const { Text } = Typography;

interface UsageEntry {
  Success: number;
  Failed: number;
  RecentRequests?: Array<{ timestamp?: string; model?: string; status?: string }>;
}

interface AuthFileUsage {
  id: string;
  name: string;
  provider: string;
  success?: number;
  failed?: number;
  recent_requests?: Array<{ time: string; success: number; failed: number }>;
}

function Tag({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      style={{
        background: color ?? 'rgba(22,119,255,0.12)',
        color: color ?? '#1677ff',
        borderRadius: 4,
        padding: '1px 8px',
        fontSize: 12,
      }}
    >
      {children}
    </span>
  );
}

// StackedTimeline renders success/failed buckets as a lightweight bar chart.
function StackedTimeline({
  buckets,
  height,
}: {
  buckets: Array<{ time: string; success: number; failed: number }>;
  height: number;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.success + b.failed));
  if (buckets.length === 0) return <Empty description="—" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <div>
      <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height }}>
        {buckets.map((b, i) => {
          const total = b.success + b.failed;
          return (
            <div
              key={i}
              title={`${b.time}  +${b.success} / -${b.failed}`}
              style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', minWidth: 6 }}
            >
              {total > 0 && (
                <div
                  style={{
                    width: '100%',
                    height: `${(total / max) * 100}%`,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-end',
                  }}
                >
                  {b.failed > 0 && (
                    <div style={{ background: '#ff7875', height: `${(b.failed / total) * 100}%`, minHeight: 2 }} />
                  )}
                  {b.success > 0 && (
                    <div style={{ background: '#52c41a', height: `${(b.success / total) * 100}%`, minHeight: 2 }} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
        {buckets.map((b, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: '#999', overflow: 'hidden', whiteSpace: 'nowrap' }}>
            {i % 4 === 0 ? b.time.split('-')[0] : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

// Timeline aggregate: sum recent_requests buckets across all credentials.
function RequestTimeline() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [files, setFiles] = useState<AuthFileUsage[]>([]);
  const [loading, setLoading] = useState(false);
  const [perProvider, setPerProvider] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mgmt.get<{ files?: AuthFileUsage[] }>('/auth-files');
      setFiles(data.files ?? []);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const aggregate = useMemo(
    () => mergeRequestBuckets(files, perProvider),
    [files, perProvider],
  );

  const totalSuccess = files.reduce((a, f) => a + (f.success ?? 0), 0);
  const totalFailed = files.reduce((a, f) => a + (f.failed ?? 0), 0);

  return (
    <div>
      <Row>
        <Col>
          <Card size="small" style={{ marginBottom: 12, marginRight: 12, display: 'inline-block' }}>
            <Statistic title={t('dashboard.reqSuccess')} value={totalSuccess} valueStyle={{ color: '#3f8600', fontSize: 22 }} />
          </Card>
          <Card size="small" style={{ marginBottom: 12, marginRight: 12, display: 'inline-block' }}>
            <Statistic title={t('dashboard.reqFailed')} value={totalFailed} valueStyle={{ color: totalFailed > 0 ? '#cf1322' : undefined, fontSize: 22 }} />
          </Card>
        </Col>
      </Row>
      {aggregate.map(({ key: provider, buckets }) => (
        <Card
          key={provider || 'all'}
          size="small"
          title={provider ? <Tag color="geekblue">{provider}</Tag> : t('usage.timelineAll')}
          style={{ marginBottom: 12 }}
        >
          <StackedTimeline buckets={buckets} height={perProvider ? 90 : 140} />
        </Card>
      ))}
      <Space style={{ marginBottom: 8 }}>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
          {t('common.refresh')}
        </Button>
        <Button type={perProvider ? 'primary' : 'default'} ghost={perProvider} onClick={() => setPerProvider(!perProvider)}>
          {t('usage.perProvider')}
        </Button>
      </Space>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap' }}>{children}</div>;
}
function Col({ children }: { children: React.ReactNode }) {
  return <div style={{ marginRight: 0 }}>{children}</div>;
}

function ApiKeyUsage() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [data, setData] = useState<Record<string, Record<string, UsageEntry>>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await mgmt.get<Record<string, Record<string, UsageEntry>>>('/api-key-usage'));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = Object.entries(data).flatMap(([provider, entries]) =>
    Object.entries(entries).map(([composite, entry]) => ({
      key: `${provider}-${composite}`,
      provider,
      composite,
      success: entry.Success,
      failed: entry.Failed,
    })),
  );

  return (
    <Card
      title={t('usage.apiKeyUsage')}
      extra={
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
          {t('common.refresh')}
        </Button>
      }
    >
      <Table
        rowKey="key"
        size="small"
        dataSource={rows}
        pagination={{ pageSize: 15 }}
        columns={[
          { title: 'Provider', dataIndex: 'provider', width: 120, render: (v: string) => <Tag>{v}</Tag> },
          { title: 'Key', dataIndex: 'composite', render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
          { title: 'Success', dataIndex: 'success', width: 110, render: (v: number) => <Statistic value={v} valueStyle={{ fontSize: 16 }} /> },
          { title: 'Failed', dataIndex: 'failed', width: 110, render: (v: number) => <Statistic value={v} valueStyle={{ fontSize: 16, color: v > 0 ? '#cf1322' : undefined }} /> },
        ]}
      />
    </Card>
  );
}

function UsageQueue() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [raw, setRaw] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mgmt.get<unknown>('/usage-queue?count=100');
      setRaw(JSON.stringify(data, null, 2));
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
      title={t('usage.usageQueue')}
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
            {t('common.refresh')}
          </Button>
          <Button
            icon={<DownloadOutlined />}
            onClick={() => {
              const blob = new Blob([raw], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'usage-queue.json';
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            {t('usage.export')}
          </Button>
        </Space>
      }
    >
      <pre style={{ maxHeight: 420, overflow: 'auto', border: '1px solid rgba(128,128,128,0.25)', padding: 12, borderRadius: 8, fontSize: 12 }}>{raw || '—'}</pre>
    </Card>
  );
}

export default function Usage() {
  const { t } = useTranslation();
  return (
    <Tabs
      items={[
        { key: 'timeline', label: t('usage.timeline'), children: <RequestTimeline /> },
        { key: 'keys', label: t('usage.apiKeyUsage'), children: <ApiKeyUsage /> },
        { key: 'queue', label: t('usage.usageQueue'), children: <UsageQueue /> },
      ]}
    />
  );
}
