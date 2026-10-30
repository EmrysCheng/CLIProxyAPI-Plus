
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Card, Input, Modal, Space, Tabs, Tag, Typography, Upload } from 'antd';
import { DownloadOutlined, ReloadOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons';
import { load as loadYaml } from 'js-yaml';
import { diffLines, type Change } from 'diff';
import { useTranslation } from 'react-i18next';
import { mgmt, mgmtV8 } from '../api/client';

const { Text } = Typography;

function YamlEditor() {
  const { t } = useTranslation();
  const { message, modal } = AntApp.useApp();
  const [yamlText, setYamlText] = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/panel/api/v0/management/config.yaml');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setYamlText(text);
      setOriginal(text);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  // Client-side YAML syntax check with line info, so mistakes are caught
  // before they reach the server.
  const yamlError = useMemo(() => {
    if (!yamlText.trim()) return null;
    try {
      loadYaml(yamlText);
      return null;
    } catch (e) {
      const msg = (e as { message?: string; mark?: { line?: number } }) ?? {};
      const line = msg.mark?.line !== undefined ? msg.mark.line + 1 : undefined;
      return line ? `${msg.message ?? 'invalid YAML'} (line ${line})` : (msg.message ?? 'invalid YAML');
    }
  }, [yamlText]);

  const dirty = yamlText !== original;

  const diffChanges = useMemo<Change[] | null>(() => {
    if (!diffOpen) return null;
    return diffLines(original, yamlText);
  }, [diffOpen, original, yamlText]);

  const doSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/panel/api/v0/management/config.yaml', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/x-yaml' },
        body: yamlText,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      message.success(t('common.success'));
      setOriginal(yamlText);
      setDiffOpen(false);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    if (yamlError) {
      message.error(`${t('config.yamlInvalid')}: ${yamlError}`);
      return;
    }
    if (dirty) {
      setDiffOpen(true);
      return;
    }
    message.info(t('config.noChanges'));
  };

  return (
    <Card
      title={t('config.yamlTitle')}
      extra={
        <Space>
          {/* Backup: download the server-side YAML as-is. */}
          <Button
            icon={<DownloadOutlined />}
            onClick={() => {
              const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
              const blob = new Blob([original], { type: 'application/x-yaml' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `config-backup-${stamp}.yaml`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            {t('config.backup')}
          </Button>
          {/* Restore: load an uploaded YAML into the editor for review + diff. */}
          <Upload
            accept=".yaml,.yml,.txt"
            showUploadList={false}
            beforeUpload={(file) => {
              const reader = new FileReader();
              reader.onload = () => {
                setYamlText(String(reader.result ?? ''));
                message.info(t('config.restoreLoaded'));
              };
              reader.readAsText(file);
              return false; // keep control; nothing uploads until Save
            }}
          >
            <Button icon={<UploadOutlined />}>{t('config.restore')}</Button>
          </Upload>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
            {t('config.reload')}
          </Button>
          {dirty && <Tag color="orange">{t('config.dirty')}</Tag>}
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save} disabled={!dirty}>
            {t('config.saveYaml')}
          </Button>
        </Space>
      }
    >
      <Alert style={{ marginBottom: 12 }} type="warning" showIcon message={t('config.yamlDesc')} />
      {yamlError && (
        <Alert style={{ marginBottom: 12 }} type="error" showIcon message={`${t('config.yamlInvalid')}: ${yamlError}`} />
      )}
      <Input.TextArea
        rows={26}
        value={yamlText}
        onChange={(e) => setYamlText(e.target.value)}
        style={{ fontFamily: 'Consolas, monospace', fontSize: 13 }}
        spellCheck={false}
      />
      <Modal
        title={t('config.diffTitle')}
        open={diffOpen}
        onCancel={() => setDiffOpen(false)}
        width={860}
        okText={t('config.saveYaml')}
        cancelText={t('common.cancel')}
        onOk={() => void doSave()}
        okButtonProps={{ loading: saving }}
      >
        <Alert style={{ marginBottom: 12 }} type="info" showIcon message={t('config.diffDesc')} />
        <pre style={{ maxHeight: 420, overflow: 'auto', fontSize: 12, fontFamily: 'Consolas, monospace', padding: 12, borderRadius: 8 }}>
          {(diffChanges ?? []).map((c, i) =>
            c.value.split('\n').filter((l, idx, arr) => !(idx === arr.length - 1 && l === '')).map((line, j) => (
              <div
                key={`${i}-${j}`}
                style={{
                  background: c.added ? 'rgba(26,127,55,0.18)' : c.removed ? 'rgba(207,34,46,0.18)' : undefined,
                  color: c.added ? '#1a7f37' : c.removed ? '#cf222e' : undefined,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {c.added ? '+ ' : c.removed ? '- ' : '  '}
                {line}
              </div>
            )),
          )}
        </pre>
      </Modal>
    </Card>
  );
}

function TreeEditor() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [path, setPath] = useState('');
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadPath = async () => {
    setLoading(true);
    try {
      const target = path.replace(/^\/+|\/+$/g, '');
      const data = await mgmtV8.get<unknown>(`/config${target ? `/${target}` : ''}`);
      setValue(JSON.stringify(data, null, 2));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const savePatch = async () => {
    setSaving(true);
    try {
      const parsed = JSON.parse(value);
      const target = path.replace(/^\/+|\/+$/g, '');
      const url = `/panel/api/v8/management/config${target ? `/${target}` : ''}`;
      const head = await fetch(url);
      const etag = head.headers.get('ETag') ?? '';
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) },
        body: JSON.stringify(parsed),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      message.success(t('common.success'));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={t('config.treeTitle')}>
      <Alert style={{ marginBottom: 12 }} type="info" showIcon message={t('config.treeDesc')} />
      <Space.Compact style={{ width: '100%', maxWidth: 640, marginBottom: 12 }}>
        <Input
          value={path}
          placeholder={t('config.jsonPath')}
          onChange={(e) => setPath(e.target.value)}
          onPressEnter={() => void loadPath()}
        />
        <Button loading={loading} onClick={() => void loadPath()}>
          {t('config.loadPath')}
        </Button>
      </Space.Compact>
      <div style={{ marginBottom: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          e.g. server / routing / oauth-excluded-models / api-keys.codex
        </Text>
      </div>
      <Input.TextArea rows={18} value={value} onChange={(e) => setValue(e.target.value)} style={{ fontFamily: 'Consolas, monospace', fontSize: 13 }} spellCheck={false} />
      <Button type="primary" style={{ marginTop: 12 }} loading={saving} onClick={() => void savePatch()} disabled={!value.trim()}>
        {t('config.savePatch')}
      </Button>
    </Card>
  );
}

export default function ConfigEditor() {
  const { t } = useTranslation();
  return (
    <Tabs
      items={[
        { key: 'yaml', label: t('config.yamlTitle'), children: <YamlEditor /> },
        { key: 'tree', label: t('config.treeTitle'), children: <TreeEditor /> },
      ]}
    />
  );
}
