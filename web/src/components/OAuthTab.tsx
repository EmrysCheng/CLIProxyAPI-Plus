import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Collapse,
  Input,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
  Upload,
} from 'antd';
import {
  CloudUploadOutlined,
  CopyOutlined,
  ExportOutlined,
  KeyOutlined,
  StopOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { mgmtV8, mgmtV8Url } from '../api/client';

const { Text, Paragraph } = Typography;

const PROVIDERS = [
  { key: 'codex', name: 'OpenAI Codex', desc: 'ChatGPT Plus/Team/Pro OAuth' },
  { key: 'claude', name: 'Anthropic Claude', desc: 'Claude Pro/Team OAuth' },
  { key: 'antigravity', name: 'Google Antigravity', desc: 'Google AI Pro/Ultra OAuth' },
  { key: 'kimi', name: 'Kimi Code', desc: 'Moonshot Kimi Code Subscription' },
  { key: 'kimi-ai', name: 'Kimi AI', desc: 'Kimi AI Web Session' },
  { key: 'xai', name: 'xAI Grok', desc: 'Grok 4 / SuperGrok OAuth' },
  { key: 'devin', name: 'Devin', desc: 'Cognition Devin AI OAuth' },
  { key: 'meta', name: 'Meta Muse', desc: 'Meta Model / Muse Code OAuth' },
] as const;

type ProviderKey = (typeof PROVIDERS)[number]['key'];

interface LoginProgress {
  provider: ProviderKey;
  url: string;
  state: string;
  flow?: string;
  user_code?: string;
  expires_in?: number;
}

interface OAuthTabProps {
  onSuccess: () => void;
}

export default function OAuthTab({ onSuccess }: OAuthTabProps) {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [starting, setStarting] = useState<ProviderKey | null>(null);
  const [progress, setProgress] = useState<LoginProgress | null>(null);
  const [done, setDone] = useState<{ ok: boolean; msg?: string } | null>(null);
  const [manualUrl, setManualUrl] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const startLogin = async (provider: ProviderKey) => {
    setStarting(provider);
    setDone(null);
    try {
      const data = await mgmtV8.post<{
        status: string;
        url?: string;
        state?: string;
        flow?: string;
        user_code?: string;
        expires_in?: number;
        error?: string;
      }>('/oauth/auth-url', { provider, is_webui: true });

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
            onSuccess();
          } else if (st.status === 'error') {
            stopPolling();
            setDone({ ok: false, msg: st.error });
            setProgress(null);
          }
        } catch {
          /* transient network check error */
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

  const vertexUploadProps = {
    name: 'file',
    action: mgmtV8Url('/credentials/vertex/service-account'),
    showUploadList: false,
    accept: '.json',
    onChange(info: { file: { status?: string; error?: unknown; name: string } }) {
      if (info.file.status === 'done') {
        message.success(t('oauth.vertexUploaded'));
        onSuccess();
      } else if (info.file.status === 'error') {
        message.error(`${info.file.name}: ${String(info.file.error)}`);
      }
    },
  };

  return (
    <div style={{ marginTop: 16 }}>
      <Alert
        style={{ marginBottom: 16 }}
        type="info"
        showIcon
        message={t('oauth.desc')}
      />

      {done && !done.ok && (
        <Alert
          style={{ marginBottom: 16 }}
          type="error"
          showIcon
          message={t('oauth.loginFailed', { msg: done.msg ?? '' })}
          closable
        />
      )}

      {progress && (
        <Card style={{ marginBottom: 20, borderColor: '#1677ff' }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space>
              <Spin />
              <Text strong>{t('oauth.waitingCallback')}</Text>
              <Tag color="processing">{progress.provider}</Tag>
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
            <Space wrap>
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
                          placeholder="http://localhost:8317/oauth/callback?code=...&state=..."
                          value={manualUrl}
                          onChange={(e) => setManualUrl(e.target.value)}
                        />
                        <Button type="primary" onClick={() => void submitManualCallback()}>
                          {t('common.submit')}
                        </Button>
                      </Space.Compact>
                    </Space>
                  ),
                },
              ]}
            />
          </Space>
        </Card>
      )}

      {/* Provider Cards Matrix */}
      <Row gutter={[16, 16]}>
        {PROVIDERS.map((p) => (
          <Col xs={24} sm={12} md={8} lg={6} key={p.key}>
            <Card
              hoverable
              size="small"
              style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
              title={
                <Space>
                  <KeyOutlined style={{ color: '#1677ff' }} />
                  <span>{p.name}</span>
                </Space>
              }
            >
              <div style={{ marginBottom: 16 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>{p.desc}</Text>
              </div>
              <Button
                type="primary"
                block
                icon={<UserAddOutlined />}
                loading={starting === p.key}
                disabled={Boolean(progress && progress.provider !== p.key)}
                onClick={() => void startLogin(p.key)}
              >
                {t('oauth.startLogin')}
              </Button>
            </Card>
          </Col>
        ))}

        {/* Google Cloud Vertex Service Account Upload */}
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card
            hoverable
            size="small"
            style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
            title={
              <Space>
                <CloudUploadOutlined style={{ color: '#722ed1' }} />
                <span>Google Cloud Vertex</span>
              </Space>
            }
          >
            <div style={{ marginBottom: 16 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>{t('oauth.vertexDesc')}</Text>
            </div>
            <Upload {...vertexUploadProps}>
              <Button block icon={<CloudUploadOutlined />}>
                {t('oauth.vertexUpload')}
              </Button>
            </Upload>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
