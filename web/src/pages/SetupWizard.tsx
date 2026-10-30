import { useState } from 'react';
import { Button, Card, Checkbox, Form, Input, List, Result, Space, Steps, Tag, Typography, App as AntApp } from 'antd';
import { SafetyCertificateOutlined, LockOutlined, CheckCircleOutlined, KeyOutlined, CopyOutlined, UserAddOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { theme as antdTheme } from 'antd';
import { authApi, mgmt, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

const { Text, Title } = Typography;

function genKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return 'sk-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export default function SetupWizard() {
  const { t } = useTranslation();
  const { token } = antdTheme.useToken();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const { message } = AntApp.useApp();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const passwordForm = Form.useForm()[0];

  // Client key step state. The key is generated locally; the wizard creates it
  // through the management API once the panel session exists (after setup).
  const [wantKey, setWantKey] = useState(true);
  const [clientKey, setClientKey] = useState<string>(genKey());
  const [keySaved, setKeySaved] = useState(false);

  const createPassword = async (values: { password: string; confirm: string }) => {
    if (values.password !== values.confirm) {
      message.error(t('auth.setupMismatch'));
      return;
    }
    setSubmitting(true);
    try {
      // Session cookie is now live; deliberately defer AuthContext.refresh()
      // to the final step — otherwise the auth gate yanks the user out of the
      // remaining wizard steps the moment the session becomes valid.
      await authApi.setup(values.password);
      setStep(2);
    } catch (e) {
      const msg = e instanceof ApiError && e.status === 429 ? t('auth.loginRateLimited') : (e as Error).message;
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const finish = async (target = '/') => {
    await refresh();
    let last = target;
    try {
      const stored = sessionStorage.getItem('panel-last-route');
      if (target === '/' && stored && stored.startsWith('/')) last = stored;
    } catch {
      /* ignore */
    }
    navigate(last);
  };

  const saveClientKey = async () => {
    setSubmitting(true);
    try {
      // putStringList accepts a bare array; the panel session was established
      // by the setup step, so this goes straight through the mgmt proxy.
      await mgmt.put('/api-keys', [clientKey.trim()]);
      setKeySaved(true);
      message.success(t('common.success'));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: token.colorBgLayout }}>
      <Card style={{ width: 560, maxWidth: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <img src="/panel/favicon.svg" alt="logo" style={{ width: 48, height: 48 }} />
          <Title level={4} style={{ marginBottom: 4 }}>{t('auth.setupTitle')}</Title>
          <Text type="secondary">{t('app.subtitle')}</Text>
        </div>
        <Steps
          size="small"
          current={step}
          items={[{ title: t('setup.step1') }, { title: t('setup.step2') }, { title: t('setup.step2b') }, { title: t('setup.step3') }]}
          style={{ marginBottom: 24 }}
        />
        {step === 0 && (
          <div>
            <p>{t('setup.step1Desc')}</p>
            <List
              size="small"
              dataSource={[t('setup.step1Tips1'), t('setup.step1Tips2'), t('setup.step1Tips3')]}
              renderItem={(item) => (
                <List.Item>
                  <SafetyCertificateOutlined style={{ color: '#1677ff', marginRight: 8 }} />
                  {item}
                </List.Item>
              )}
            />
            <Button type="primary" block style={{ marginTop: 24 }} onClick={() => setStep(1)}>
              {t('setup.next')}
            </Button>
          </div>
        )}
        {step === 1 && (
          <Form layout="vertical" form={passwordForm} onFinish={createPassword}>
            <Form.Item name="password" label={t('auth.setupPassword')} rules={[{ required: true, min: 8, message: t('auth.setupTooShort') }]}>
              <Input.Password prefix={<LockOutlined />} size="large" autoFocus />
            </Form.Item>
            <Form.Item name="confirm" label={t('auth.setupConfirm')} dependencies={['password']} rules={[{ required: true }]}>
              <Input.Password prefix={<LockOutlined />} size="large" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
              {t('auth.setupSubmit')}
            </Button>
            <Button block style={{ marginTop: 8 }} onClick={() => setStep(0)}>
              {t('setup.prev')}
            </Button>
          </Form>
        )}
        {step === 2 && (
          <div>
            <p>{t('setup.keyDesc')}</p>
            <Checkbox checked={wantKey} onChange={(e) => setWantKey(e.target.checked)}>
              <Space size={4}>
                <KeyOutlined />
                {t('setup.keyEnable')}
              </Space>
            </Checkbox>
            {wantKey && (
              <div style={{ marginTop: 12 }}>
                <Space.Compact style={{ width: '100%' }}>
                  <Input value={clientKey} onChange={(e) => setClientKey(e.target.value)} style={{ fontFamily: 'monospace' }} />
                  <Button
                    icon={<CopyOutlined />}
                    onClick={() => {
                      void navigator.clipboard.writeText(clientKey);
                      message.success(t('common.copied'));
                    }}
                  />
                </Space.Compact>
                <div style={{ marginTop: 8 }}>
                  <Button size="small" onClick={() => setClientKey(genKey())}>{t('setup.keyRegenerate')}</Button>
                  {!keySaved && (
                    <Button size="small" type="primary" style={{ marginLeft: 8 }} loading={submitting} onClick={() => void saveClientKey()}>
                      {t('setup.keySave')}
                    </Button>
                  )}
                  {keySaved && <Tag color="success" style={{ marginLeft: 8 }}>{t('setup.keySaved')}</Tag>}
                </div>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                  {t('setup.keyHint')}
                </Text>
              </div>
            )}
            <Button type="primary" block style={{ marginTop: 24 }} onClick={() => setStep(3)}>
              {t('setup.next')}
            </Button>
            <Button block style={{ marginTop: 8 }} onClick={() => setStep(1)}>
              {t('setup.prev')}
            </Button>
          </div>
        )}
        {step === 3 && (
          <Result
            status="success"
            title={t('setup.step3')}
            subTitle={t('setup.step3Desc')}
            extra={
              <Space direction="vertical" size={8}>
                <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => void finish('/')}>
                  {t('setup.start')}
                </Button>
                <Button icon={<UserAddOutlined />} onClick={() => void finish('/oauth')}>
                  {t('setup.goOauth')}
                </Button>
                {!wantKey && (
                  <Text type="secondary" style={{ fontSize: 12 }}>{t('setup.skipKeyHint')}</Text>
                )}
              </Space>
            }
          />
        )}
      </Card>
    </div>
  );
}
