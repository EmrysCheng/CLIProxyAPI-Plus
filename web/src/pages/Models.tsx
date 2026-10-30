import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Card, Input, Spin, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { mgmt } from '../api/client';

const { Text } = Typography;

// JsonSettingCard edits a map-shaped management setting as raw JSON.
// PUT bodies for these endpoints take the bare object (not an envelope).
function JsonSettingCard({
  title,
  desc,
  path,
  responseKey,
}: {
  title: string;
  desc?: string;
  path: string;
  responseKey: string;
}) {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const jsonError = useMemo(() => {
    if (!text.trim()) return null;
    try {
      JSON.parse(text);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, [text]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mgmt.get<Record<string, unknown>>(path);
      setText(JSON.stringify(data[responseKey] ?? {}, null, 2));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path, responseKey, message]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const parsed = JSON.parse(text);
      await mgmt.put(path, parsed);
      message.success(t('common.success'));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={title} style={{ marginBottom: 16 }} extra={<Button onClick={() => void load()}>{t('config.reload')}</Button>}>
      {desc && <p style={{ color: '#888', marginTop: 0 }}>{desc}</p>}
      {loading ? (
        <Spin />
      ) : (
        <>
          <Input.TextArea rows={12} value={text} onChange={(e) => setText(e.target.value)} style={{ fontFamily: 'monospace' }} />
          {jsonError && (
            <Alert style={{ marginTop: 8 }} type="error" showIcon message={`JSON: ${jsonError}`} />
          )}
          <Button type="primary" style={{ marginTop: 12 }} loading={saving} disabled={!!jsonError || !text.trim()} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      )}
    </Card>
  );
}

export default function Models() {
  const { t } = useTranslation();
  return (
    <div>
      <JsonSettingCard
        title={t('models.excludedModels')}
        desc={`${t('models.excludedModelsDesc')} — e.g. { "gemini": ["gemini-3.0-pro"] }`}
        path="/oauth-excluded-models"
        responseKey="oauth-excluded-models"
      />
      <JsonSettingCard title={t('models.modelAlias')} desc={t('models.modelAliasDesc')} path="/oauth-model-alias" responseKey="oauth-model-alias" />
      <JsonSettingCard
        title={t('models.requestScopedErrors')}
        desc={t('models.requestScopedErrorsDesc')}
        path="/oauth-request-scoped-errors"
        responseKey="oauth-request-scoped-errors"
      />
      <Text type="secondary" style={{ fontSize: 12 }}>
        PUT /v0/management/oauth-model-alias
      </Text>
    </div>
  );
}
