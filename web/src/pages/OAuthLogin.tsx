import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, App as AntApp, Button, Card, Collapse, Input, Space, Spin, Tag, Typography, Upload } from 'antd';
import { UserAddOutlined, CopyOutlined, ExportOutlined, StopOutlined, CloudUploadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { mgmtV8, mgmtV8Url } from '../api/client';

const { Text, Paragraph } = Typography;

const PROVIDERS = ['claude', 'codex', 'antigravity', 'kimi', 'kimi-ai', 'xai', 'devin', 'meta'] as const;
type Provider = (typeof PROVIDERS)[number];

interface LoginProgress {
  provider: Provider;
  url: string;
  state: string;
  flow?: string;
  user_code?: string;
  expires_in?: number;
}

export default function OAuthLogin() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [starting, setStarting] = useState<Provider | null>(null);
  const [progress, setProgress] = useState<LoginProgress | null>(null);
  const [done, setDone] = useState<{ ok: boolean; msg?: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const startLogin = async (provider: Provider) => {
    setStarting(provider);
    setDone(null);
    try {
      const data = await mgmtV8.post<{ status: string; url?: string; state?: string; flow?: string; user_code?: string; expires_in?: number; error?: string }>(
        '/oauth/auth-url',
        { provider, is_webui: true },
      );
      if (data.status !== 'ok' || !data.url || !data.state) {
        message.error(data.error ?? t('oauth.loginFailed', { msg: 'no url' }));
        return;
      }
      setProgress({
        provider,
        url: data.url,
        state: data.state,
        flow: data.flow,
        user_code: data.user_code,
        expires_in: data.expires_in,
      });
      window.open(data.url, '_blank', 'noopener');
      pollRef.current = setInterval(async () => {
        try {
          const st = await mgmtV8.get<{ status: string; error?: string }>(
            `/oauth/status?state=${encodeURIComponent(data.state!)}`,
          );
          if (st.status === 'ok') {
            stopPolling();
            setDone({ ok: true });
            setProgress(null);
            message.success(t('oauth.loginSuccess'));
          } else if (st.status === 'error') {
            stopPolling();
            setDone({ ok: false, msg: st.error });
            setProgress(null);
          }
          // status "wait" keeps polling
        } catch {
          /* transient network error; keep polling */
        }
      }, 2000);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setStarting(null);
    }
  };

  const cancelLogin = async () => {
    if (!progress) return;
    stopPolling();
    try {
      await mgmtV8.del(`/oauth/session?state=${encodeURIComponent(progress.state)}`);
    } catch {
      /* ignore */
    }
    setProgress(null);
    setDone({ ok: false, msg: t('oauth.cancelled') });
  };

  // Remote deployments: the provider redirects the browser to a localhost
  // callback the panel host cannot see. The user pastes that full URL here and
  // the public v0 callback endpoint completes the flow (state parsed from it).
  const [manualUrl, setManualUrl] = useState('');
  const submitManualCallback = async () => {
    if (!progress || !manualUrl.trim()) return;
    try {
      await mgmtV8.post('/oauth/callback', { redirect_url: manualUrl.trim() });
      message.success(t('oauth.manualAccepted'));
      setManualUrl('');
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <div>
      <Alert style={{ marginBottom: 16 }} type="info" showIcon message={t('oauth.desc')} />
      <Alert style={{ marginBottom: 16 }} type="info" showIcon={false} icon={<CloudUploadOutlined />} message={t('oauth.fileOnlyHint')} />
      {done && !done.ok && (
        <Alert style={{ marginBottom: 16 }} type="error" showIcon message={t('oauth.loginFailed', { msg: done.msg ?? '' })} closable />
      )}
      {progress && (
        <Card style={{ marginBottom: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space>
              <Spin />
              <Text strong>{t('oauth.waitingCallback')}</Text>
              <Tag color="processing">{t(`oauth.providers.${progress.provider}`)}</Tag>
            </Space>
            <Paragraph copyable={{ text: progress.url }} style={{ marginBottom: 0, wordBreak: 'break-all', fontSize: 12 }}>
              {progress.url}
            </Paragraph>
            {progress.flow === 'device' && progress.user_code && (
              <Space size={12} align="center" style={{ background: 'rgba(22,119,255,0.08)', padding: '8px 12px', borderRadius: 8 }}>
                <Text strong>{t('oauth.deviceCode')}:</Text>
                <Text copyable={{ text: progress.user_code }} style={{ fontSize: 22, fontFamily: 'monospace', letterSpacing: 2 }}>
                  {progress.user_code}
                </Text>
                {progress.expires_in ? <Tag>{t('oauth.expiresIn').replace('{{minutes}}', String(Math.round(progress.expires_in / 60)))}</Tag> : null}
              </Space>
            )}
            <Space>
              <Button icon={<ExportOutlined />} href={progress.url} target="_blank">
                {t('oauth.openAuthUrl')}
              </Button>
              <Button icon={<CopyOutlined />} onClick={() => void navigator.clipboard.writeText(progress.url)}>
                {t('oauth.copyAuthUrl')}
              </Button>
              <Button danger icon={<StopOutlined />} onClick={() => void cancelLogin()}>
                {t('oauth.cancel')}
              </Button>
            </Space>
            <Collapse
              size="small"
              items={[
                {
                  key: 'manual',
                  label: t('oauth.manualTitle'),
                  children: (
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>{t('oauth.manualDesc')}</Text>
                      <Space.Compact style={{ width: '100%' }}>
                        <Input
                          value={manualUrl}
                          onChange={(e) => setManualUrl(e.target.value)}
                          placeholder={t('oauth.manualPlaceholder')}
                        />
                        <Button
                          type="primary"
                          disabled={!manualUrl.trim()}
                          onClick={() => void submitManualCallback()}
                        >
                          {t('oauth.manualSubmit')}
                        </Button>
                      </Space.Compact>
                    </Space>
                  ),
                },
              ]}
            />
            <Text type="secondary">{t('oauth.needPopup')}</Text>
          </Space>
        </Card>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
        {PROVIDERS.map((p) => (
          <Card key={p} hoverable style={{ textAlign: 'center' }}>
            <UserAddOutlined style={{ fontSize: 28, color: '#1677ff' }} />
            <Card.Meta style={{ marginTop: 8 }} title={t(`oauth.providers.${p}`)} />
            <Button
              type="primary"
              ghost
              style={{ marginTop: 12 }}
              loading={starting === p}
              onClick={() => void startLogin(p)}
            >
              {t('oauth.startLogin')}
            </Button>
          </Card>
        ))}
      </div>
      <VertexImport />
    </div>
  );
}

function VertexImport() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  return (
    <Card style={{ marginTop: 24 }} title={t('oauth.vertexTitle')}>
      <p style={{ color: '#888' }}>{t('oauth.vertexDesc')}</p>
      <Upload
        name="file"
        accept=".json"
        showUploadList={false}
        action={mgmtV8Url('/oauth/import?provider=vertex')}
        onChange={(info: { file: { status?: string; error?: unknown; name: string } }) => {
          if (info.file.status === 'done') {
            message.success(t('oauth.vertexOk'));
          } else if (info.file.status === 'error') {
            message.error(`${info.file.name}: upload failed`);
          }
        }}
      >
        <Button type="primary" ghost icon={<CloudUploadOutlined />}>
          {t('oauth.vertexImport')}
        </Button>
      </Upload>
    </Card>
  );
}
