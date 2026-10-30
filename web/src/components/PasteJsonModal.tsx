import { useState } from 'react';
import { Alert, App as AntApp, Form, Input, Modal, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, CodeOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { mgmtUrl } from '../api/client';

const { Text, Paragraph } = Typography;

interface PasteJsonModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function PasteJsonModal({ open, onClose, onSuccess }: PasteJsonModalProps) {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [jsonText, setJsonText] = useState('');
  const [filename, setFilename] = useState('');
  const [detectedProvider, setDetectedProvider] = useState<string | null>(null);
  const [detectedEmail, setDetectedEmail] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleJsonChange = (val: string) => {
    setJsonText(val);
    const trimmed = val.trim();
    if (!trimmed) {
      setErrorMsg(null);
      setDetectedProvider(null);
      setDetectedEmail(null);
      return;
    }

    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      setErrorMsg(null);

      // Detect provider
      let provider = String(obj.provider || obj.type || '').toLowerCase();
      if (!provider) {
        const fullStr = JSON.stringify(obj).toLowerCase();
        if (fullStr.includes('codex') || fullStr.includes('openai') || fullStr.includes('chatgpt')) {
          provider = 'codex';
        } else if (fullStr.includes('claude') || fullStr.includes('anthropic')) {
          provider = 'claude';
        } else if (fullStr.includes('antigravity')) {
          provider = 'antigravity';
        } else if (fullStr.includes('gemini') || fullStr.includes('ai studio')) {
          provider = 'gemini';
        } else if (fullStr.includes('kimi')) {
          provider = 'kimi';
        } else if (fullStr.includes('grok') || fullStr.includes('xai')) {
          provider = 'xai';
        } else {
          provider = 'auth';
        }
      }
      setDetectedProvider(provider);

      // Detect email / account
      let email = String(obj.email || obj.account || obj.user || '').trim();
      if (!email && typeof obj.id_token === 'string') {
        try {
          const parts = obj.id_token.split('.');
          if (parts.length >= 2) {
            const payload = JSON.parse(atob(parts[1])) as Record<string, unknown>;
            email = String(payload.email || payload.sub || '').trim();
          }
        } catch {
          /* ignore JWT parse failure */
        }
      }
      setDetectedEmail(email || null);

      // Suggest filename if not manually customized yet
      if (!filename || filename.endsWith('.json')) {
        const safeAccount = email ? email.replace(/[^a-zA-Z0-9@._-]/g, '_') : `import-${Date.now().toString().slice(-6)}`;
        setFilename(`${provider}-${safeAccount}.json`);
      }
    } catch {
      setErrorMsg(t('authFiles.invalidJson'));
      setDetectedProvider(null);
      setDetectedEmail(null);
    }
  };

  const handleSave = async () => {
    const trimmed = jsonText.trim();
    if (!trimmed) {
      message.error(t('authFiles.invalidJson'));
      return;
    }
    let targetName = filename.trim();
    if (!targetName) {
      targetName = `auth-${Date.now().toString().slice(-6)}.json`;
    }
    if (!targetName.toLowerCase().endsWith('.json')) {
      targetName += '.json';
    }

    setSaving(true);
    try {
      const res = await fetch(mgmtUrl(`/auth-files?name=${encodeURIComponent(targetName)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: trimmed,
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      message.success(t('authFiles.saveSuccess'));
      setJsonText('');
      setFilename('');
      setDetectedProvider(null);
      setDetectedEmail(null);
      onSuccess();
      onClose();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <CodeOutlined style={{ color: '#1677ff' }} />
          <span>{t('authFiles.pasteModalTitle')}</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      onOk={() => void handleSave()}
      confirmLoading={saving}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      width={680}
      destroyOnClose
    >
      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {t('authFiles.pasteModalDesc')}
      </Paragraph>

      <Form layout="vertical">
        <Form.Item label={t('authFiles.pasteModalTitle')} required>
          <Input.TextArea
            rows={10}
            placeholder={t('authFiles.pasteJsonPlaceholder')}
            value={jsonText}
            onChange={(e) => handleJsonChange(e.target.value)}
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          />
        </Form.Item>

        {errorMsg && (
          <Alert message={errorMsg} type="error" showIcon style={{ marginBottom: 12 }} />
        )}

        {(detectedProvider || detectedEmail) && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(22,119,255,0.06)', borderRadius: 6 }}>
            <Space size={8} wrap>
              <CheckCircleOutlined style={{ color: '#52c41a' }} />
              {detectedProvider && (
                <Text style={{ fontSize: 13 }}>
                  {t('authFiles.detectedProvider')}: <Tag color="geekblue">{detectedProvider}</Tag>
                </Text>
              )}
              {detectedEmail && (
                <Text style={{ fontSize: 13 }}>
                  {t('authFiles.detectedEmail')}: <Tag color="cyan">{detectedEmail}</Tag>
                </Text>
              )}
            </Space>
          </div>
        )}

        <Form.Item label={t('authFiles.targetFilename')} required>
          <Input
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            placeholder="e.g. codex-account@gmail.com.json"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
