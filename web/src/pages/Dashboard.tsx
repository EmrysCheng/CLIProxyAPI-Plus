import { useCallback, useEffect, useState } from 'react';
import { App as AntApp, Button, Card, Col, Row, Space, Statistic, Switch, Tag, Typography } from 'antd';
import { CheckCircleOutlined, CloudDownloadOutlined, CopyOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { mgmt, mgmtUrl } from '../api/client';
import { useScalarSetting } from '../components/shared';
import type { AuthFileEntry } from '../components/CredentialDetail';
import { healthIssues } from '../lib/panel';

const { Text } = Typography;

export default function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const [providers, setProviders] = useState<Record<string, number>>({});
  const [totalCreds, setTotalCreds] = useState(0);
  const [clientKeyCount, setClientKeyCount] = useState(0);
  const [currentVersion, setCurrentVersion] = useState<string>('');
  const [currentCommit, setCurrentCommit] = useState<string>('');
  const [latestVersion, setLatestVersion] = useState<string>('');
  const [checking, setChecking] = useState(false);
  const [reqSuccess, setReqSuccess] = useState(0);
  const [reqFailed, setReqFailed] = useState(0);
  const [reqRecent, setReqRecent] = useState(0);
  const [unhealthy, setUnhealthy] = useState<Array<{ name: string; provider: string; reason: string; disabled: boolean }>>([]);
  const [firstClientKey, setFirstClientKey] = useState<string>('');

  const debug = useScalarSetting<boolean>('/debug', 'debug');
  const logToFile = useScalarSetting<boolean>('/logging-to-file', 'logging-to-file');
  const usageStats = useScalarSetting<boolean>('/usage-statistics-enabled', 'usage-statistics-enabled');
  const proxy = useScalarSetting<string>('/proxy-url', 'proxy-url');
  const strategy = useScalarSetting<string>('/routing/strategy', 'strategy');

  const loadCredentials = useCallback(async () => {
    try {
      const data = await mgmt.get<{ files?: Array<AuthFileEntry & { success?: number; failed?: number; status?: string; status_message?: string; unavailable?: boolean; disabled?: boolean; recent_requests?: Array<{ success: number; failed: number }> }> }>('/auth-files');
      const files = data.files ?? [];
      setTotalCreds(files.length);
      const byProvider: Record<string, number> = {};
      let s = 0;
      let f = 0;
      let recent = 0;
      for (const file of files) {
        const p = file.provider || file.type || 'unknown';
        byProvider[p] = (byProvider[p] ?? 0) + 1;
        s += file.success ?? 0;
        f += file.failed ?? 0;
        const buckets = file.recent_requests ?? [];
        // The last two buckets cover the most recent ~2 windows.
        recent += buckets.slice(-2).reduce((acc, b) => acc + (b.success ?? 0) + (b.failed ?? 0), 0);

      }
      setUnhealthy(healthIssues(files, { disabled: 'disabled', error: 'error' }));
      setReqSuccess(s);
      setReqFailed(f);
      setReqRecent(recent);
      setProviders(byProvider);
    } catch {
      /* panel still usable */
    }
  }, []);

  const loadClientKeys = useCallback(async () => {
    try {
      const data = await mgmt.get<{ 'api-keys'?: string[] }>('/api-keys');
      const keys = data['api-keys'] ?? [];
      setClientKeyCount(keys.length);
      setFirstClientKey(keys[0] ?? '');
    } catch {
      /* ignore */
    }
  }, []);

  const detectCurrentVersion = useCallback(async () => {
    try {
      // The panel proxy stamps build identity headers on every response.
      const res = await fetch(mgmtUrl('/debug'));
      setCurrentVersion(res.headers.get('X-CPA-VERSION') ?? '');
      setCurrentCommit(res.headers.get('X-CPA-COMMIT') ?? '');
    } catch {
      /* ignore */
    }
  }, []);

  const checkLatest = useCallback(async () => {
    setChecking(true);
    try {
      // Cache the GitHub-backed check for an hour to spare the rate limit.
      const cacheRaw = localStorage.getItem('panel-latest-version');
      if (cacheRaw) {
        try {
          const cache = JSON.parse(cacheRaw) as { at: number; version: string };
          if (Date.now() - cache.at < 60 * 60 * 1000 && cache.version) {
            setLatestVersion(cache.version);
            return;
          }
        } catch {
          /* stale cache shape */
        }
      }
      const data = await mgmt.get<{ 'latest-version': string }>('/latest-version');
      const version = data['latest-version'] ?? '';
      setLatestVersion(version);
      try {
        localStorage.setItem('panel-latest-version', JSON.stringify({ at: Date.now(), version }));
      } catch {
        /* ignore quota */
      }
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setChecking(false);
    }
  }, [message]);

  const curlExample = () =>
    `curl ${window.location.origin}/v1/chat/completions \\\n  -H "Authorization: Bearer ${firstClientKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"gemini-3.5-pro","messages":[{"role":"user","content":"hello"}]}'`;

  useEffect(() => {
    void loadCredentials();
    void loadClientKeys();
    void detectCurrentVersion();
  }, [loadCredentials, loadClientKeys, detectCurrentVersion]);

  // Optional 30s auto-refresh of the live statistics.
  const [autoRefresh, setAutoRefresh] = useState(false);
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      void loadCredentials();
      void loadClientKeys();
    }, 30_000);
    return () => clearInterval(timer);
  }, [autoRefresh, loadCredentials, loadClientKeys]);

  const versionCompare = (a: string, b: string): number => {
    const pa = a.replace(/^v/, '').split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
    const pb = b.replace(/^v/, '').split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  };
  const updateAvailable = latestVersion !== '' && versionCompare(latestVersion, currentVersion || '0') > 0;

  return (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title={t('dashboard.credentialCount')} value={totalCreds} />
            <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {Object.entries(providers).map(([p, n]) => (
                <Tag key={p} color="blue">
                  {p}: {n}
                </Tag>
              ))}
              {totalCreds === 0 && <Text type="secondary">—</Text>}
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title={t('dashboard.clientApiKeys')} value={clientKeyCount} />
            <div style={{ marginTop: 12 }}>
              <Text type="secondary">{t('dashboard.routingStrategy')}: </Text>
              <Tag color="geekblue">{strategy.value ?? '—'}</Tag>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title={t('dashboard.currentVersion')} value={currentVersion || t('common.unknown')} />
            <div style={{ marginTop: 12 }}>
              <Button size="small" icon={<CloudDownloadOutlined />} loading={checking} onClick={checkLatest}>
                {t('dashboard.checkUpdate')}
              </Button>
              {latestVersion && (
                <Tag style={{ marginLeft: 8 }} color={updateAvailable ? 'orange' : 'green'}>
                  {updateAvailable ? `${t('dashboard.newVersion')}: ${latestVersion}` : t('dashboard.upToDate')}
                </Tag>
              )}
              {currentVersion && currentVersion !== 'dev' && (
                <div style={{ marginTop: 6 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>commit: {currentCommit || '—'}</Text>
                </div>
              )}
              {updateAvailable && (
                <div style={{ marginTop: 8 }}>
                  <Button size="small" type="primary" ghost onClick={() => navigate('/system')}>
                    {t('nav.system')}
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card title={t('dashboard.quickActions')} styles={{ body: { display: 'flex', flexDirection: 'column', gap: 10 } }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text>{t('dashboard.debugMode')}</Text>
              <Switch
                checked={!!debug.value}
                loading={debug.saving}
                onChange={(v) => void debug.save(v)}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text>{t('dashboard.loggingToFile')}</Text>
              <Switch checked={!!logToFile.value} loading={logToFile.saving} onChange={(v) => void logToFile.save(v)} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text>{t('dashboard.usageStats')}</Text>
              <Switch checked={!!usageStats.value} loading={usageStats.saving} onChange={(v) => void usageStats.save(v)} />
            </div>
            <div>
              <Text type="secondary">{t('dashboard.proxyUrl')}: </Text>
              <Text code>{proxy.value || t('common.none')}</Text>
            </div>
          </Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title={t('dashboard.reqSuccess')} value={reqSuccess} valueStyle={{ color: '#3f8600' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title={t('dashboard.reqFailed')} value={reqFailed} valueStyle={{ color: reqFailed > 0 ? '#cf1322' : undefined }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title={t('dashboard.reqRecent')} value={reqRecent} suffix={<Text type="secondary" style={{ fontSize: 13 }}>{t('dashboard.reqRecentUnit')}</Text>} />
          </Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={24}>
          <Card
            title={t('dashboard.guideTitle')}
            extra={
              firstClientKey ? (
                <Button size="small" icon={<CopyOutlined />} onClick={() => void navigator.clipboard.writeText(curlExample())}>
                  {t('common.copy')}
                </Button>
              ) : (
                <Button size="small" onClick={() => navigate('/keys')}>
                  {t('nav.apiKeys')}
                </Button>
              )
            }
          >
            {firstClientKey ? (
              <div>
                <p style={{ margin: 0, color: '#888', fontSize: 13 }}>
                  {t('dashboard.guideDesc')} <Text code>{window.location.origin}</Text>
                </p>
                <pre
                  style={{
                    marginTop: 10,
                    padding: 12,
                    borderRadius: 8,
                    fontSize: 12,
                    fontFamily: 'Consolas, monospace',
                    overflowX: 'auto',
                    border: '1px solid rgba(128,128,128,0.25)',
                  }}
                >
                  {curlExample()}
                </pre>
              </div>
            ) : (
              <Text type="secondary">{t('dashboard.guideNoKey')}</Text>
            )}
          </Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={24}>
          {unhealthy.length > 0 ? (
            <Card size="small" style={{ marginBottom: 16, borderColor: '#faad14' }} title={<span style={{ color: '#faad14' }}>{t('dashboard.healthIssues').replace('{{count}}', String(unhealthy.length))}</span>}>
              <Space direction="vertical" style={{ width: '100%' }} size={6}>
                {unhealthy.map((u) => (
                  <div key={u.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <Space size={8}>
                      <WarningOutlined style={{ color: '#faad14' }} />
                      <Text strong style={{ fontSize: 12 }}>{u.name}</Text>
                      <Tag color="geekblue" style={{ fontSize: 11 }}>{u.provider}</Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>{u.reason}</Text>
                    </Space>
                    <Button size="small" onClick={() => navigate('/auth-files')}>
                      {t('dashboard.healthGoFix')}
                    </Button>
                  </div>
                ))}
              </Space>
            </Card>
          ) : (
            totalCreds > 0 && (
              <Card size="small" style={{ marginBottom: 16 }}>
                <Space size={8}>
                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                  <Text type="secondary">{t('dashboard.healthOk')}</Text>
                </Space>
              </Card>
            )
          )}
          <Card
            title={t('dashboard.byProvider')}
            extra={
              <Space wrap>
                <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} />
                <Text type="secondary" style={{ fontSize: 12 }}>{t('dashboard.autoRefresh')} (30s)</Text>
                <Button icon={<ReloadOutlined />} onClick={() => void loadCredentials()}>
                  {t('common.refresh')}
                </Button>
              </Space>
            }
          >
            {totalCreds === 0 ? (
              <Text type="secondary">—</Text>
            ) : (
              <Row gutter={[12, 12]}>
                {Object.entries(providers).map(([p, n]) => (
                  <Col key={p} xs={12} sm={8} md={6} lg={4}>
                    <Card size="small" style={{ textAlign: 'center' }}>
                      <Statistic title={p} value={n} />
                    </Card>
                  </Col>
                ))}
              </Row>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
