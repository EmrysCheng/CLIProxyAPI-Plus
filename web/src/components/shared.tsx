import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input, Space, Tag, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { mgmt } from '../api/client';
import { useTranslation } from 'react-i18next';

// useScalarSetting wires the common GET/PUT pattern of management scalar
// endpoints: GET returns { "<key>": value }; PUT accepts { "<key>": value }.
export function useScalarSetting<T>(path: string, key: string) {
  const { t } = useTranslation();
  const [value, setValue] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mgmt.get<Record<string, T>>(path);
      setValue(data[key] as T);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path, key]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (next: T) => {
      setSaving(true);
      try {
        // Scalar management endpoints accept { "value": <x> } regardless of
        // the response envelope key.
        await mgmt.put(path, { value: next });
        setValue(next);
        message.success(t('common.success'));
        setError(null);
        return true;
      } catch (e) {
        message.error((e as Error).message);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [path, t],
  );

  return { value, loading, saving, error, save, reload };
}

// StringListEditor manages an array-of-strings setting with tag-style rows.
export function StringListEditor({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const add = () => {
    const v = input.trim();
    if (!v) return;
    if (!values.includes(v)) onChange([...values, v]);
    setInput('');
  };
  return (
    <div>
      <div style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {values.length === 0 && <span style={{ color: '#999' }}>{t('common.none')}</span>}
        {values.map((v) => (
          <Tag key={v} closable onClose={() => onChange(values.filter((x) => x !== v))}>
            {v}
          </Tag>
        ))}
      </div>
      <Space.Compact style={{ width: '100%', maxWidth: 480 }}>
        <Input
          value={input}
          placeholder={placeholder}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={add}
        />
        <Button icon={<PlusOutlined />} onClick={add}>
          {t('common.add')}
        </Button>
      </Space.Compact>
    </div>
  );
}

// ScalarCard renders a labelled setting with an inline save button.
export function ScalarCard<T>({
  title,
  desc,
  children,
  onSave,
  saving,
  extra,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
  onSave: () => void;
  saving?: boolean;
  extra?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Card title={title} extra={extra} style={{ marginBottom: 16 }}>
      {desc && <p style={{ color: '#888', marginTop: 0 }}>{desc}</p>}
      <Space.Compact style={{ width: '100%', maxWidth: 560 }}>
        {children}
        <Button type="primary" loading={saving} onClick={onSave}>
          {t('common.save')}
        </Button>
      </Space.Compact>
    </Card>
  );
}
