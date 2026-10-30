import { useState } from 'react';
import { Button, Card, Form, Input, Typography, App as AntApp } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { theme as antdTheme } from 'antd';
import { authApi, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

const { Title, Text } = Typography;

export default function Login() {
  const { t } = useTranslation();
  const { token } = antdTheme.useToken();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const { message } = AntApp.useApp();
  const [submitting, setSubmitting] = useState(false);

  const onFinish = async (values: { password: string }) => {
    setSubmitting(true);
    try {
      await authApi.login(values.password);
      await refresh();
      let target = '/';
      try {
        const last = sessionStorage.getItem('panel-last-route');
        if (last && last.startsWith('/')) target = last;
      } catch {
        /* ignore */
      }
      navigate(target);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        message.error(t('auth.loginRateLimited'));
      } else {
        message.error(t('auth.loginFailed'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: token.colorBgLayout }}>
      <Card style={{ width: 400, maxWidth: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <img src="/panel/favicon.svg" alt="logo" style={{ width: 48, height: 48 }} />
          <Title level={4} style={{ marginBottom: 4 }}>{t('auth.loginTitle')}</Title>
          <Text type="secondary">CLIProxyAPI</Text>
        </div>
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item name="password" label={t('auth.loginPassword')} rules={[{ required: true, message: t('auth.loginPassword') }]}>
            <Input.Password prefix={<LockOutlined />} size="large" autoFocus />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
            {t('auth.loginSubmit')}
          </Button>
        </Form>
      </Card>
    </div>
  );
}
