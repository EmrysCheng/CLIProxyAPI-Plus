import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Card, Checkbox, Drawer, Empty, Input, Modal, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { mgmt } from '../api/client';
import { StringListEditor } from '../components/shared';
import { maskKey } from '../lib/panel';

const { Text } = Typography;

// Simple single-key provider groups: each entry carries api-key (+ optional base-url).
const SIMPLE_PROVIDERS: Array<{ key: string; label: string }> = [
  { key: 'gemini-api-key', label: 'Gemini' },
  { key: 'claude-api-key', label: 'Claude' },
  { key: 'codex-api-key', label: 'Codex' },
  { key: 'xai-api-key', label: 'xAI' },
  { key: 'meta-api-key', label: 'Meta' },
  { key: 'vertex-api-key', label: 'Vertex' },
  { key: 'interactions-api-key', label: 'Interactions' },
];

function ClientKeys() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [keys, setKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [masked, setMasked] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mgmt.get<{ 'api-keys': string[] }>('/api-keys');
      setKeys(data['api-keys'] ?? []);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await mgmt.put('/api-keys', keys);
      message.success(t('common.success'));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={t('keys.clientKeys')} style={{ marginBottom: 16 }}>
      <p style={{ color: '#888', marginTop: 0 }}>{t('keys.clientKeysDesc')}</p>
      {loading ? (
        <Text type="secondary">{t('common.loading')}</Text>
      ) : (
        <>
          <div style={{ marginBottom: 8 }}>
            <Checkbox checked={masked} onChange={(e) => setMasked(e.target.checked)}>
              {t('keys.maskKeys')}
            </Checkbox>
          </div>
          <StringListEditor
            values={masked ? keys.map(maskKey) : keys}
            onChange={(next) => {
              // Replacing masked values with raw ones would corrupt the list;
              // editing requires unmasking first, which we make explicit.
              if (masked) {
                message.info(t('keys.unmaskToEdit'));
                return;
              }
              setKeys(next);
            }}
            placeholder={t('keys.inputPlaceholder')}
          />
          <Button type="primary" style={{ marginTop: 12 }} loading={saving} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      )}
    </Card>
  );
}

function ProviderKeysSection() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [lists, setLists] = useState<Record<string, Array<Record<string, unknown>>>>({});
  const [edit, setEdit] = useState<{ key: string; index: number; text: string } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const jsonError = useMemo(() => {
    if (!edit?.text.trim()) return null;
    try {
      JSON.parse(edit.text);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, [edit?.text]);

  const loadAll = useCallback(async () => {
    const next: Record<string, Array<Record<string, unknown>>> = {};
    for (const p of SIMPLE_PROVIDERS) {
      try {
        const data = await mgmt.get<Record<string, Array<Record<string, unknown>>>>(`/${p.key}`);
        next[p.key] = data[p.key] ?? [];
      } catch {
        next[p.key] = [];
      }
    }
    setLists(next);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const saveList = async (key: string, list: Array<Record<string, unknown>>) => {
    try {
      await mgmt.put(`/${key}`, { items: list });
      message.success(t('common.success'));
      await loadAll();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const deleteEntry = async (key: string, entry: Record<string, unknown>) => {
    const apiKey = String(entry['api-key'] ?? '');
    const baseUrl = entry['base-url'];
    let query = `api-key=${encodeURIComponent(apiKey)}`;
    if (baseUrl != null && baseUrl !== '') query += `&base-url=${encodeURIComponent(String(baseUrl))}`;
    try {
      await mgmt.del(`/${key}?${query}`);
      message.success(t('common.success'));
      await loadAll();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const saveEdit = async () => {
    if (!edit) return;
    try {
      const parsed = JSON.parse(edit.text);
      const list = [...(lists[edit.key] ?? [])];
      list[edit.index] = parsed;
      setEdit(null);
      await saveList(edit.key, list);
    } catch (e) {
      message.error(`JSON: ${(e as Error).message}`);
    }
  };

  if (!loaded) return <Card loading title={t('keys.providerKeys')} />;

  return (
    <Card title={t('keys.providerKeys')} style={{ marginBottom: 16 }}>
      <p style={{ color: '#888', marginTop: 0 }}>{t('keys.providerKeysDesc')}</p>
      {SIMPLE_PROVIDERS.map((p) => {
        const list = lists[p.key] ?? [];
        return (
          <Card
            key={p.key}
            type="inner"
            size="small"
            title={p.label}
            style={{ marginBottom: 12 }}
            extra={
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={() => setEdit({ key: p.key, index: list.length, text: JSON.stringify({ 'api-key': '', 'base-url': '' }, null, 2) })}
              >
                {t('common.add')}
              </Button>
            }
          >
            {list.length === 0 ? (
              <Text type="secondary">—</Text>
            ) : (
              <Space wrap size={4}>
                {list.map((entry, i) => {
                  const k = String(entry['api-key'] ?? '');
                  const base = entry['base-url'];
                  return (
                    <Tag
                      key={`${k}-${i}`}
                      closable
                      onClose={(e) => {
                        e.preventDefault();
                        void deleteEntry(p.key, entry);
                      }}
                      style={{ fontSize: 12 }}
                    >
                      <Space size={4}>
                        <Text style={{ fontSize: 12, maxWidth: 200 }} ellipsis={{ tooltip: k }} code>
                          {k ? k.slice(0, 8) + '…' + k.slice(-4) : '(empty)'}
                        </Text>
                        {base ? <Text type="secondary" style={{ fontSize: 11 }}>{String(base)}</Text> : null}
                        <EditOutlined
                          style={{ fontSize: 11 }}
                          onClick={() => setEdit({ key: p.key, index: i, text: JSON.stringify(entry, null, 2) })}
                        />
                      </Space>
                    </Tag>
                  );
                })}
              </Space>
            )}
          </Card>
        );
      })}
      <Modal
        title={t('common.edit')}
        open={!!edit}
        onOk={() => void saveEdit()}
        onCancel={() => setEdit(null)}
        okText={t('common.save')}
        okButtonProps={{ disabled: !!jsonError || !edit?.text.trim() }}
        width={640}
      >
        <Input.TextArea rows={12} value={edit?.text} onChange={(e) => setEdit((v) => (v ? { ...v, text: e.target.value } : v))} style={{ fontFamily: 'monospace' }} />
        {jsonError && <Alert style={{ marginTop: 8 }} type="error" showIcon message={`JSON: ${jsonError}`} />}
      </Modal>
    </Card>
  );
}

interface CompatProvider {
  name: string;
  'base-url': string;
  disabled?: boolean;
  'api-key-entries'?: Array<{ 'api-key': string; weight?: number; 'proxy-url'?: string }>;
  'api-keys'?: string[];
  models?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

function OpenAICompat() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [list, setList] = useState<CompatProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<{ index: number; text: string; isNew: boolean } | null>(null);

  const jsonError = useMemo(() => {
    if (!edit?.text.trim()) return null;
    try {
      JSON.parse(edit.text);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, [edit?.text]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mgmt.get<{ 'openai-compatibility': CompatProvider[] }>('/openai-compatibility');
      setList(data['openai-compatibility'] ?? []);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveAll = async (next: CompatProvider[]) => {
    try {
      await mgmt.put('/openai-compatibility', { items: next });
      message.success(t('common.success'));
      await load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const removeProvider = async (name: string) => {
    try {
      await mgmt.del(`/openai-compatibility?name=${encodeURIComponent(name)}`);
      message.success(t('common.success'));
      await load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const saveEdit = async () => {
    if (!edit) return;
    try {
      const parsed = JSON.parse(edit.text) as CompatProvider;
      const next = [...list];
      if (edit.isNew) next.push(parsed);
      else next[edit.index] = parsed;
      setEdit(null);
      await saveAll(next);
    } catch (e) {
      message.error(`JSON: ${(e as Error).message}`);
    }
  };

  const columns = [
    { title: t('keys.providerName'), dataIndex: 'name', render: (v: string) => <Text strong>{v}</Text> },
    { title: t('keys.baseUrl'), dataIndex: 'base-url', render: (v: string) => <Text code>{v}</Text> },
    {
      title: t('keys.apiKey'),
      key: 'keys',
      render: (_v: unknown, r: CompatProvider) => {
        const keys = r['api-key-entries']?.map((k) => k['api-key']) ?? r['api-keys'] ?? [];
        return <Tag>{keys.length}</Tag>;
      },
    },
    { title: t('keys.models'), key: 'models', render: (_v: unknown, r: CompatProvider) => <Tag>{r.models?.length ?? 0}</Tag> },
    { title: t('common.status'), key: 'disabled', render: (_v: unknown, r: CompatProvider) => (r.disabled ? <Tag color="default">{t('common.disabled')}</Tag> : <Tag color="success">{t('common.enabled')}</Tag>) },
    {
      title: t('common.actions'),
      key: 'actions',
      render: (_v: unknown, r: CompatProvider) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => setEdit({ index: list.indexOf(r), text: JSON.stringify(r, null, 2), isNew: false })} />
          <Popconfirm title={t('plugins.deleteConfirm', { id: r.name })} onConfirm={() => void removeProvider(r.name)} okButtonProps={{ danger: true }}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title={t('keys.openaiCompatTitle')}
      extra={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() =>
            setEdit({
              index: list.length,
              isNew: true,
              text: JSON.stringify({ name: '', 'base-url': '', 'api-key-entries': [{ 'api-key': '' }], models: [{ name: '', alias: '' }] }, null, 2),
            })
          }
        >
          {t('keys.addProvider')}
        </Button>
      }
    >
      <p style={{ color: '#888', marginTop: 0 }}>{t('keys.openaiCompatDesc')}</p>
      <Table rowKey="name" size="middle" loading={loading} columns={columns} dataSource={list} pagination={false} locale={{ emptyText: <Empty description={t('common.none')} /> }} />
      <Modal
        title={edit?.isNew ? t('keys.addProvider') : t('common.edit')}
        open={!!edit}
        onOk={() => void saveEdit()}
        onCancel={() => setEdit(null)}
        okText={t('common.save')}
        okButtonProps={{ disabled: !!jsonError || !edit?.text.trim() }}
        width={720}
      >
        <Input.TextArea rows={16} value={edit?.text} onChange={(e) => setEdit((v) => (v ? { ...v, text: e.target.value } : v))} style={{ fontFamily: 'monospace' }} />
        {jsonError && <Alert style={{ marginTop: 8 }} type="error" showIcon message={`JSON: ${jsonError}`} />}
      </Modal>
    </Card>
  );
}

export default function ApiKeys() {
  const { t } = useTranslation();
  return (
    <div>
      <ClientKeys />
      <ProviderKeysSection key="providers" />
      <OpenAICompat key="compat" />
      <p style={{ color: '#aaa', fontSize: 12 }}>{t('settings.aboutDesc')}</p>
    </div>
  );
}
