import { useEffect, useState } from 'react';
import { App as AntApp, Form, Input, InputNumber, Modal, theme as antdTheme, Typography } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { mgmt } from '../api/client';
import { AuthFileEntry } from './CredentialDetail';

const { Text } = Typography;

interface QuickEditModalProps {
  open: boolean;
  entries: AuthFileEntry[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function QuickEditModal({ open, entries, onClose, onSuccess }: QuickEditModalProps) {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const { token } = antdTheme.useToken();
  const [priority, setPriority] = useState<number>(0);
  const [note, setNote] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const isBatch = entries.length > 1;
  const single = entries.length === 1 ? entries[0] : null;

  useEffect(() => {
    if (single) {
      setPriority(typeof single.priority === 'number' ? single.priority : 0);
      setNote(typeof single.note === 'string' ? single.note : '');
    } else {
      setPriority(0);
      setNote('');
    }
  }, [single]);

  const handleSave = async () => {
    if (entries.length === 0) return;
    setSaving(true);
    const failures: string[] = [];

    for (const entry of entries) {
      try {
        const payload: Record<string, unknown> = {
          name: entry.name,
          priority: Number(priority),
        };
        if (!isBatch || note.trim() !== '') {
          payload.note = note.trim();
        }
        await mgmt.patch('/auth-files/fields', payload);
      } catch (e) {
        failures.push(`${entry.name}: ${(e as Error).message}`);
      }
    }

    setSaving(false);
    if (failures.length > 0) {
      message.error(`${t('common.failed')}: ${failures.slice(0, 3).join('; ')}`);
    } else {
      message.success(t('common.success'));
      onSuccess();
      onClose();
    }
  };

  const titleText = isBatch
    ? `${t('authFiles.batchPriorityTitle')} (${entries.length})`
    : `${t('authFiles.quickEditTitle')} - ${single?.name ?? ''}`;

  return (
    <Modal
      title={
        <span>
          <SettingOutlined style={{ marginRight: 8, color: '#1677ff' }} />
          {titleText}
        </span>
      }
      open={open}
      onCancel={onClose}
      onOk={() => void handleSave()}
      confirmLoading={saving}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      width={500}
      destroyOnClose
    >
      {isBatch && (
        <p style={{ color: token.colorTextTertiary, marginBottom: 16 }}>
          {t('authFiles.batchSelectDesc').replace('{{count}}', String(entries.length))}
        </p>
      )}

      <Form layout="vertical">
        <Form.Item label={t('authFiles.priorityLabel')} required>
          <InputNumber
            min={-100}
            max={1000}
            value={priority}
            onChange={(v) => setPriority(v ?? 0)}
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item label={t('authFiles.noteLabel')}>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={isBatch ? '留空保持原有备注不变' : '如：生产主力账号、限额备用'}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
