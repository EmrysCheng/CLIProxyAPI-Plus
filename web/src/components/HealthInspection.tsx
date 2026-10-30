import { useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Empty,
  Popconfirm,
  Result,
  Row,
  Space,
  Table,
  Tag,
  theme as antdTheme,
  Tooltip,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  PlayCircleOutlined,
  ProfileOutlined,
  ReloadOutlined,
  StopOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { mgmt } from '../api/client';
import { AuthFileEntry } from './CredentialDetail';
import { maskEmail, parseCredentialSummary } from '../lib/quota';

const { Text, Title, Paragraph } = Typography;

interface HealthInspectionProps {
  files: AuthFileEntry[];
  onReload: () => void;
  onOpenDetail: (f: AuthFileEntry) => void;
  masked: boolean;
}

export default function HealthInspection({ files, onReload, onOpenDetail, masked }: HealthInspectionProps) {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const { token } = antdTheme.useToken();
  const [busyAction, setBusyAction] = useState(false);

  // Categorize accounts
  const reauthList: AuthFileEntry[] = [];
  const cooldownList: AuthFileEntry[] = [];
  const exhaustedList: AuthFileEntry[] = [];
  const disabledErrorList: AuthFileEntry[] = [];

  for (const f of files) {
    const summary = parseCredentialSummary(f);
    if (f.disabled) {
      if (f.status === 'error' || f.unavailable) {
        disabledErrorList.push(f);
      }
      continue;
    }

    if (summary.operationalState === 'reauth') {
      reauthList.push(f);
    } else if (summary.operationalState === 'cooldown') {
      cooldownList.push(f);
    } else if (summary.operationalState === 'exhausted') {
      exhaustedList.push(f);
    }
  }

  const totalIssues = reauthList.length + cooldownList.length + exhaustedList.length + disabledErrorList.length;

  const handleClearCooldown = async (entry: AuthFileEntry) => {
    try {
      await mgmt.post('/quota/reset', { auth_index: entry.auth_index ?? entry.id });
      message.success(t('authFiles.clearCooldownOk'));
      onReload();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const handleClearAllCooldowns = async () => {
    if (cooldownList.length === 0) return;
    setBusyAction(true);
    let successCount = 0;
    for (const f of cooldownList) {
      try {
        await mgmt.post('/quota/reset', { auth_index: f.auth_index ?? f.id });
        successCount++;
      } catch {
        /* ignore individual failure */
      }
    }
    setBusyAction(false);
    message.success(`${t('authFiles.clearCooldownOk')} (${successCount}/${cooldownList.length})`);
    onReload();
  };

  const handleRefreshTokens = async (entry: AuthFileEntry) => {
    try {
      await mgmt.post('/auth-files/refresh', { name: entry.name });
      message.success(t('authFiles.refreshOk'));
      onReload();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const handleDisable = async (entry: AuthFileEntry) => {
    try {
      await mgmt.patch('/auth-files/status', { name: entry.name, auth_index: entry.auth_index, disabled: true });
      message.success(t('common.success'));
      onReload();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const handleDisableAllProblematic = async () => {
    const list = [...reauthList, ...exhaustedList];
    if (list.length === 0) return;
    setBusyAction(true);
    for (const f of list) {
      try {
        await mgmt.patch('/auth-files/status', { name: f.name, auth_index: f.auth_index, disabled: true });
      } catch {
        /* ignore */
      }
    }
    setBusyAction(false);
    message.success(t('common.success'));
    onReload();
  };

  if (totalIssues === 0) {
    return (
      <Card style={{ marginTop: 16, textAlign: 'center', padding: '32px 16px' }}>
        <Result
          status="success"
          icon={<CheckCircleOutlined style={{ color: '#52c41a', fontSize: 64 }} />}
          title={<span style={{ fontSize: 20 }}>{t('authFiles.healthyAll')}</span>}
          subTitle={t('authFiles.healthDesc')}
          extra={
            <Button icon={<ReloadOutlined />} type="primary" onClick={onReload}>
              {t('common.refresh')}
            </Button>
          }
        />
      </Card>
    );
  }

  const renderAccountRow = (f: AuthFileEntry, issueType: 'reauth' | 'cooldown' | 'exhausted' | 'disabled') => {
    const summary = parseCredentialSummary(f);
    const emailStr = maskEmail(f.email || f.account || f.name, masked);
    const cooldownInfo = f.cooldowns?.[0];

    return (
      <div
        key={f.id}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Space size={12} align="center">
          <Tag color={issueType === 'reauth' ? 'error' : issueType === 'cooldown' ? 'warning' : 'default'}>
            {f.provider || f.type || 'Auth'}
          </Tag>
          <div>
            <Text strong style={{ fontSize: 14 }}>{emailStr}</Text>
            <div style={{ fontSize: 12, color: token.colorTextTertiary }}>
              <span>{f.name}</span>
              {cooldownInfo && (
                <span style={{ marginLeft: 8, color: '#faad14' }}>
                  ({cooldownInfo.reason} — 剩余 {Math.round(cooldownInfo.remaining_seconds / 60)} 分钟)
                </span>
              )}
              {f.status_message && !cooldownInfo && (
                <span style={{ marginLeft: 8, color: '#ff4d4f' }}>
                  ({f.status_message})
                </span>
              )}
            </div>
          </div>
        </Space>

        <Space size={8}>
          {issueType === 'cooldown' && (
            <Button
              size="small"
              icon={<ThunderboltOutlined />}
              onClick={() => void handleClearCooldown(f)}
            >
              {t('authFiles.clearCooldowns')}
            </Button>
          )}
          {issueType === 'reauth' && (
            <Button
              size="small"
              type="primary"
              ghost
              icon={<PlayCircleOutlined />}
              onClick={() => void handleRefreshTokens(f)}
            >
              {t('authFiles.refreshTokens')}
            </Button>
          )}
          <Button size="small" type="link" icon={<ProfileOutlined />} onClick={() => onOpenDetail(f)}>
            {t('common.details')}
          </Button>
          {!f.disabled && (
            <Popconfirm title={t('authFiles.disableConfirm')} onConfirm={() => void handleDisable(f)}>
              <Button size="small" type="text" danger icon={<StopOutlined />}>
                {t('common.disable')}
              </Button>
            </Popconfirm>
          )}
        </Space>
      </div>
    );
  };

  return (
    <div style={{ marginTop: 16 }}>
      {/* Overview Banner */}
      <Alert
        message={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space>
              <ExclamationCircleOutlined style={{ fontSize: 18, color: '#faad14' }} />
              <span style={{ fontWeight: 600, fontSize: 15 }}>
                {t('authFiles.healthTitle')} — 发现 {totalIssues} 个凭证存在状态异常或限流冷却
              </span>
            </Space>
            <Space>
              {cooldownList.length > 0 && (
                <Button size="small" type="primary" loading={busyAction} onClick={() => void handleClearAllCooldowns()}>
                  {t('authFiles.clearCooldowns')} ({cooldownList.length})
                </Button>
              )}
              {reauthList.length + exhaustedList.length > 0 && (
                <Button size="small" danger loading={busyAction} onClick={() => void handleDisableAllProblematic()}>
                  {t('authFiles.disableProblematic')}
                </Button>
              )}
              <Button size="small" icon={<ReloadOutlined />} onClick={onReload}>
                {t('common.refresh')}
              </Button>
            </Space>
          </div>
        }
        type="warning"
        showIcon={false}
        style={{ marginBottom: 16 }}
      />

      {/* Reauth / Auth Failed Section */}
      {reauthList.length > 0 && (
        <Card
          title={
            <Space>
              <Tag color="red">{reauthList.length}</Tag>
              <span>{t('authFiles.reauthGroup')}</span>
            </Space>
          }
          style={{ marginBottom: 16 }}
          bodyStyle={{ padding: 0 }}
        >
          {reauthList.map((f) => renderAccountRow(f, 'reauth'))}
        </Card>
      )}

      {/* Cooldown Section */}
      {cooldownList.length > 0 && (
        <Card
          title={
            <Space>
              <Tag color="orange">{cooldownList.length}</Tag>
              <span>{t('authFiles.cooldownGroup')}</span>
            </Space>
          }
          style={{ marginBottom: 16 }}
          bodyStyle={{ padding: 0 }}
        >
          {cooldownList.map((f) => renderAccountRow(f, 'cooldown'))}
        </Card>
      )}

      {/* Quota Exhausted Section */}
      {exhaustedList.length > 0 && (
        <Card
          title={
            <Space>
              <Tag color="gold">{exhaustedList.length}</Tag>
              <span>{t('authFiles.exhaustedGroup')}</span>
            </Space>
          }
          style={{ marginBottom: 16 }}
          bodyStyle={{ padding: 0 }}
        >
          {exhaustedList.map((f) => renderAccountRow(f, 'exhausted'))}
        </Card>
      )}

      {/* Disabled with Errors Section */}
      {disabledErrorList.length > 0 && (
        <Card
          title={
            <Space>
              <Tag color="default">{disabledErrorList.length}</Tag>
              <span>{t('authFiles.disabledGroup')}</span>
            </Space>
          }
          style={{ marginBottom: 16 }}
          bodyStyle={{ padding: 0 }}
        >
          {disabledErrorList.map((f) => renderAccountRow(f, 'disabled'))}
        </Card>
      )}
    </div>
  );
}
