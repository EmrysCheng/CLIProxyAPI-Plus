import { useEffect, useState } from 'react';
import { App as AntApp, Button, Card, Collapse, Input, InputNumber, Select, Space, Switch, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { mgmt } from '../api/client';
import { useScalarSetting } from '../components/shared';

const { Text, Paragraph } = Typography;

function BoolCard({ title, path, responseKey, desc }: { title: string; path: string; responseKey: string; desc?: string }) {
  const setting = useScalarSetting<boolean>(path, responseKey);
  return (
    <Card size="small" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Text strong>{title}</Text>
          {desc && <div><Text type="secondary" style={{ fontSize: 12 }}>{desc}</Text></div>}
        </div>
        <Switch checked={!!setting.value} loading={setting.loading || setting.saving} onChange={(v) => void setting.save(v)} />
      </div>
    </Card>
  );
}

function TextCard({ title, path, responseKey, desc, placeholder }: { title: string; path: string; responseKey: string; desc?: string; placeholder?: string }) {
  const { t } = useTranslation();
  const setting = useScalarSetting<string>(path, responseKey);
  const [draft, setDraft] = useState('');
  useEffect(() => setDraft(setting.value ?? ''), [setting.value]);
  return (
    <Card title={title} style={{ marginBottom: 16 }}>
      {desc && <p style={{ color: '#888', marginTop: 0 }}>{desc}</p>}
      <Space.Compact style={{ width: '100%', maxWidth: 560 }}>
        <Input value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onPressEnter={() => void setting.save(draft)} />
        <Button type="primary" loading={setting.saving} onClick={() => void setting.save(draft)}>
          {t('common.save')}
        </Button>
      </Space.Compact>
    </Card>
  );
}

function NumberCard({ title, path, responseKey, min, max }: { title: string; path: string; responseKey: string; min: number; max: number }) {
  const { t } = useTranslation();
  const setting = useScalarSetting<number>(path, responseKey);
  const [draft, setDraft] = useState<number | undefined>(undefined);
  useEffect(() => setDraft(setting.value), [setting.value]);
  return (
    <Card title={title} style={{ marginBottom: 16 }}>
      <Space.Compact>
        <InputNumber min={min} max={max} value={draft} onChange={(v) => typeof v === 'number' && setDraft(v)} style={{ width: 200 }} />
        <Button type="primary" loading={setting.saving} onClick={() => typeof draft === 'number' && void setting.save(draft)}>
          {t('common.save')}
        </Button>
      </Space.Compact>
    </Card>
  );
}

interface ApiCallResult {
  status_code?: number;
  header?: Record<string, string[]>;
  body?: string;
}

interface CredentialLite {
  id: string;
  auth_index?: string;
  label?: string;
  name: string;
  provider: string;
}

// ApiCallTester drives the upstream POST /api-call contract:
// { auth_index?, method, url, header?, data } -> { status_code, header, body }.
function ApiCallTester() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [data, setData] = useState('');
  const [authIndex, setAuthIndex] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApiCallResult | null>(null);
  const [creds, setCreds] = useState<CredentialLite[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await mgmt.get<{ files?: CredentialLite[] }>('/auth-files');
        setCreds(res.files ?? []);
      } catch {
        /* optional selector */
      }
    })();
  }, []);

  const send = async () => {
    setBusy(true);
    setResult(null);
    try {
      const payload: Record<string, unknown> = { method, url };
      if (authIndex) payload.auth_index = authIndex;
      if (data.trim()) payload.data = data;
      const res = await mgmt.post<ApiCallResult>('/api-call', payload);
      setResult(res);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('server.apiCallTitle')} style={{ marginBottom: 16 }}>
      <p style={{ color: '#888', marginTop: 0 }}>{t('server.apiCallDesc')}</p>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Space wrap>
          <Select
            style={{ width: 110 }}
            value={method}
            onChange={setMethod}
            options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m }))}
          />
          <Select
            allowClear
            style={{ width: 260 }}
            placeholder={t('server.apiCallCredential')}
            value={authIndex}
            onChange={setAuthIndex}
            options={creds.map((c) => ({ value: c.auth_index ?? c.id, label: `${c.provider} — ${c.label || c.name}` }))}
          />
        </Space>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/v1/…" />
        <Input.TextArea rows={5} value={data} onChange={(e) => setData(e.target.value)} placeholder={t('server.apiCallBody')} style={{ fontFamily: 'monospace' }} />
        <Button type="primary" loading={busy} onClick={() => void send()} disabled={!url.trim()}>
          {t('server.apiCallSend')}
        </Button>
        {result && (
          <>
            <div>
              <Tag color={result.status_code && result.status_code < 400 ? 'green' : 'red'}>
                HTTP {result.status_code ?? '—'}
              </Tag>
            </div>
            {result.header && (
              <Collapse
                size="small"
                items={[{ key: 'h', label: t('server.apiCallHeaders'), children: <pre style={{ fontSize: 11, maxHeight: 160, overflow: 'auto' }}>{JSON.stringify(result.header, null, 2)}</pre> }]}
              />
            )}
            <Paragraph style={{ marginBottom: 0 }}>
              <Text code copyable style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12, display: 'block', maxHeight: 320, overflow: 'auto' }}>
                {result.body ?? ''}
              </Text>
            </Paragraph>
          </>
        )}
      </Space>
    </Card>
  );
}

export default function ServerSettings() {
  const { t } = useTranslation();
  return (
    <div>
      <Card title={t('server.title')} style={{ marginBottom: 16 }}>
        <BoolCard title={t('server.debug')} path="/debug" responseKey="debug" />
        <BoolCard title={t('server.loggingToFile')} path="/logging-to-file" responseKey="logging-to-file" />
        <BoolCard title={t('server.usageStatistics')} path="/usage-statistics-enabled" responseKey="usage-statistics-enabled" />
        <BoolCard title={t('server.requestLog')} path="/request-log" responseKey="request-log" />
        <BoolCard title={t('server.wsAuth')} path="/ws-auth" responseKey="ws-auth" />
      </Card>
      <NumberCard title={t('server.logsMaxSize')} path="/logs-max-total-size-mb" responseKey="logs-max-total-size-mb" min={0} max={102400} />
      <NumberCard title={t('server.errorLogsMaxFiles')} path="/error-logs-max-files" responseKey="error-logs-max-files" min={0} max={1000} />
      <TextCard title={t('server.proxyUrl')} desc={t('server.proxyUrlDesc')} path="/proxy-url" responseKey="proxy-url" placeholder="socks5://127.0.0.1:1080" />
      <ApiCallTester />
    </div>
  );
}
