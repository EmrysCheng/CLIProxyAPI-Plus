import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  Badge,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  theme as antdTheme,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  CodeOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  KeyOutlined,
  PlayCircleOutlined,
  ProfileOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  SettingOutlined,
  StarFilled,
  StarOutlined,
  StopOutlined,
  TableOutlined,
  ThunderboltOutlined,
  UserSwitchOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { mgmt, mgmtUrl } from '../api/client';
import CredentialDetail, { AuthFileEntry } from '../components/CredentialDetail';
import HealthInspection from '../components/HealthInspection';
import OAuthTab from '../components/OAuthTab';
import PasteJsonModal from '../components/PasteJsonModal';
import QuickEditModal from '../components/QuickEditModal';
import { maskEmail, parseCredentialSummary } from '../lib/quota';

const { Text } = Typography;

export default function AuthFiles() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const { token } = antdTheme.useToken();

  // Primary data state
  const [files, setFiles] = useState<AuthFileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Tabs & Views
  const [activeTab, setActiveTab] = useState<'list' | 'health' | 'oauth'>('list');
  const [viewMode, setViewMode] = useState<'table' | 'card'>(() => {
    return (localStorage.getItem('cpa_view_mode') as 'table' | 'card') || 'table';
  });
  const [masked, setMasked] = useState<boolean>(() => {
    return localStorage.getItem('cpa_masked') !== 'false';
  });
  const [pinnedNames, setPinnedNames] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('cpa_pinned_auths') || '[]') as string[];
    } catch {
      return [];
    }
  });

  // Filters & Search
  const [searchKeyword, setSearchKeyword] = useState('');
  const [providerFilter, setProviderFilter] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [stateFilter, setStateFilter] = useState<string | undefined>();
  const [planFilter, setPlanFilter] = useState<string | undefined>();
  const [quotaFilter, setQuotaFilter] = useState<string | undefined>();
  const [sortBy, setSortBy] = useState<string>('recent');

  // Modals & Drawers
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [quickEditEntries, setQuickEditEntries] = useState<AuthFileEntry[]>([]);
  const [detailTarget, setDetailTarget] = useState<AuthFileEntry | null>(null);
  const [modelsTarget, setModelsTarget] = useState<AuthFileEntry | null>(null);
  const [models, setModels] = useState<Array<{ id: string; display_name?: string }>>([]);
  const [fieldsTarget, setFieldsTarget] = useState<AuthFileEntry | null>(null);
  const [fieldsText, setFieldsText] = useState('{}');

  // Batch Selection
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);

  // Load all credentials
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mgmt.get<{ files?: AuthFileEntry[] }>('/auth-files');
      const loaded = data.files ?? [];
      setFiles(loaded);

      // Auto-probe credentials that support quota and haven't observed multi-group data yet
      const needsQuotaProbe = loaded.filter(
        (f) =>
          !f.disabled &&
          (f.provider === 'antigravity' || f.supports_quota) &&
          (!f.quota || typeof f.quota !== 'object' || !('groups' in (f.quota as Record<string, unknown>)))
      );
      if (needsQuotaProbe.length > 0) {
        void Promise.all(
          needsQuotaProbe.map(async (f) => {
            try {
              const q = await mgmt.post<Record<string, unknown>>('/quota/fetch', {
                auth_index: f.auth_index ?? f.id,
              });
              setFiles((prev) =>
                prev.map((item) =>
                  item.id === f.id
                    ? {
                        ...item,
                        quota: q,
                        plan: (q.subscription as { plan?: string })?.plan ?? item.plan,
                      }
                    : item
                )
              );
            } catch {
              /* ignore background probe failures */
            }
          })
        );
      }
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const togglePin = (name: string) => {
    setPinnedNames((prev) => {
      const next = prev.includes(name) ? prev.filter((x) => x !== name) : [name, ...prev];
      try {
        localStorage.setItem('cpa_pinned_auths', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const handleToggleMasked = () => {
    setMasked((prev) => {
      const next = !prev;
      localStorage.setItem('cpa_masked', String(next));
      return next;
    });
  };

  const handleToggleViewMode = (mode: 'table' | 'card') => {
    setViewMode(mode);
    localStorage.setItem('cpa_view_mode', mode);
  };

  // Toggle active/disabled
  const handleToggleDisabled = async (f: AuthFileEntry, disabled: boolean) => {
    try {
      await mgmt.patch('/auth-files/status', { name: f.name, auth_index: f.auth_index, disabled });
      message.success(t('common.success'));
      void load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const remove = async (f: AuthFileEntry) => {
    try {
      await mgmt.del(`/auth-files?name=${encodeURIComponent(f.name)}`);
      message.success(t('common.success'));
      void load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const refreshOne = async (f: AuthFileEntry) => {
    try {
      await mgmt.post('/auth-files/refresh', { name: f.name });
      if (f.provider === 'antigravity' || f.supports_quota) {
        try {
          const q = await mgmt.post<Record<string, unknown>>('/quota/fetch', {
            auth_index: f.auth_index ?? f.id,
          });
          setFiles((prev) =>
            prev.map((item) =>
              item.id === f.id
                ? {
                    ...item,
                    quota: q,
                    plan: (q.subscription as { plan?: string })?.plan ?? item.plan,
                  }
                : item
            )
          );
        } catch {
          /* ignore quota fetch failure */
        }
      }
      message.success(t('authFiles.refreshOk'));
      void load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const download = (f: AuthFileEntry) => {
    window.open(mgmtUrl(`/auth-files/download?name=${encodeURIComponent(f.name)}`), '_blank');
  };

  const openModels = async (f: AuthFileEntry) => {
    setModelsTarget(f);
    setModels([]);
    try {
      const data = await mgmt.get<{ models: Array<{ id: string; display_name?: string }> }>(
        `/auth-files/models?name=${encodeURIComponent(f.name)}`,
      );
      setModels(data.models ?? []);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const openFields = (f: AuthFileEntry) => {
    setFieldsTarget(f);
    setFieldsText('{}');
  };

  const saveFields = async () => {
    if (!fieldsTarget) return;
    try {
      const parsed = JSON.parse(fieldsText);
      await mgmt.patch('/auth-files/fields', { name: fieldsTarget.name, ...parsed });
      message.success(t('common.success'));
      setFieldsTarget(null);
      void load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  // Selected entries for batch operations
  const selectedEntries = useMemo(() => {
    return files.filter((f) => selectedKeys.includes(`${f.id}-${f.auth_index ?? ''}`));
  }, [files, selectedKeys]);

  const runBatch = async (op: 'enable' | 'disable' | 'refresh' | 'delete') => {
    if (selectedEntries.length === 0) return;
    setBatchBusy(true);
    const failures: string[] = [];
    for (const f of selectedEntries) {
      try {
        if (op === 'enable') await mgmt.patch('/auth-files/status', { name: f.name, auth_index: f.auth_index, disabled: false });
        else if (op === 'disable') await mgmt.patch('/auth-files/status', { name: f.name, auth_index: f.auth_index, disabled: true });
        else if (op === 'refresh') await mgmt.post('/auth-files/refresh', { name: f.name });
        else if (op === 'delete') await mgmt.del(`/auth-files?name=${encodeURIComponent(f.name)}`);
      } catch (e) {
        failures.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    setBatchBusy(false);
    setSelectedKeys([]);
    if (failures.length > 0) {
      message.error(`${t('common.failed')}: ${failures.slice(0, 3).join('; ')}`);
    } else {
      message.success(t('common.success'));
    }
    void load();
  };

  // KPI Calculations
  const kpis = useMemo(() => {
    let normallyAvailable = 0;
    let needsAttention = 0;
    let quotaRisk = 0;
    let disabled = 0;
    let unconfirmed = 0;

    for (const f of files) {
      const s = parseCredentialSummary(f);
      if (f.disabled) {
        disabled++;
      } else {
        if (s.isNormallyAvailable) normallyAvailable++;
        if (s.needsAttention) needsAttention++;
        if (s.hasQuotaRisk) quotaRisk++;
        if (s.isUnconfirmed) unconfirmed++;
      }
    }

    return {
      total: files.length,
      normallyAvailable,
      needsAttention,
      quotaRisk,
      disabled,
      unconfirmed,
    };
  }, [files]);

  // Providers & Provider count pills
  const providerStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of files) {
      const p = (f.provider || f.type || 'other').toLowerCase();
      counts[p] = (counts[p] || 0) + 1;
    }
    return counts;
  }, [files]);

  const uniqueProviders = Object.keys(providerStats).sort();

  // Filtered & Sorted files list
  const filteredFiles = useMemo(() => {
    let result = files.filter((f) => {
      const summary = parseCredentialSummary(f);

      // 1. Provider pill filter
      if (providerFilter && (f.provider || f.type || '').toLowerCase() !== providerFilter.toLowerCase()) {
        return false;
      }

      // 2. Status filter (active / disabled / error)
      if (statusFilter === 'active' && f.disabled) return false;
      if (statusFilter === 'disabled' && !f.disabled) return false;
      if (statusFilter === 'error' && !f.unavailable && f.status !== 'error') return false;

      // 3. Operational state filter
      if (stateFilter && summary.operationalState !== stateFilter) return false;

      // 4. Plan filter
      if (planFilter && summary.plan.toLowerCase() !== planFilter.toLowerCase()) return false;

      // 5. Quota filter
      if (quotaFilter === 'sufficient') {
        const ok = summary.windows.every((w) => w.remainingPercent > 50);
        if (!ok) return false;
      } else if (quotaFilter === 'low') {
        const low = summary.windows.some((w) => w.remainingPercent > 0 && w.remainingPercent <= 20);
        if (!low) return false;
      } else if (quotaFilter === 'exhausted') {
        const exhausted = summary.windows.some((w) => w.remainingPercent === 0);
        if (!exhausted) return false;
      } else if (quotaFilter === 'cooldown') {
        if (summary.operationalState !== 'cooldown') return false;
      }

      // 6. Search keyword
      if (searchKeyword.trim()) {
        const kw = searchKeyword.toLowerCase();
        const n = String(f.name || '').toLowerCase();
        const e = String(f.email || '').toLowerCase();
        const a = String(f.account || '').toLowerCase();
        const note = String(f.note || '').toLowerCase();
        if (!n.includes(kw) && !e.includes(kw) && !a.includes(kw) && !note.includes(kw)) {
          return false;
        }
      }

      return true;
    });

    // Sorting
    result.sort((a, b) => {
      // Pinned always on top
      const aPinned = pinnedNames.includes(a.name);
      const bPinned = pinnedNames.includes(b.name);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;

      const sumA = parseCredentialSummary(a);
      const sumB = parseCredentialSummary(b);

      if (sortBy === 'recent') {
        const tA = new Date(a.updated_at || a.last_refresh || 0).getTime();
        const tB = new Date(b.updated_at || b.last_refresh || 0).getTime();
        return tB - tA;
      }
      if (sortBy === 'quota') {
        const remA = sumA.windows[0]?.remainingPercent ?? 0;
        const remB = sumB.windows[0]?.remainingPercent ?? 0;
        return remB - remA;
      }
      if (sortBy === 'success') {
        return sumB.successRate - sumA.successRate;
      }
      if (sortBy === 'priority') {
        return Number(b.priority ?? 0) - Number(a.priority ?? 0);
      }
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      }
      return 0;
    });

    return result;
  }, [files, providerFilter, statusFilter, stateFilter, planFilter, quotaFilter, searchKeyword, sortBy, pinnedNames]);

  // Upload handlers
  const uploadProps = {
    name: 'file',
    action: mgmtUrl('/auth-files'),
    multiple: true,
    showUploadList: false,
    accept: '.json',
    onChange(info: { file: { status?: string; error?: unknown; name: string } }) {
      if (info.file.status === 'done') {
        message.success(t('common.success'));
        void load();
      } else if (info.file.status === 'error') {
        message.error(`${info.file.name}: ${String(info.file.error)}`);
      }
    },
  };

  // Helper to render provider brand colors & icons
  const getProviderIconStyle = (provider: string) => {
    const p = provider.toLowerCase();
    if (p.includes('codex') || p.includes('openai')) return { bg: '#10a37f', color: '#fff' };
    if (p.includes('claude') || p.includes('anthropic')) return { bg: '#d97706', color: '#fff' };
    if (p.includes('antigravity') || p.includes('gemini')) return { bg: '#1a73e8', color: '#fff' };
    if (p.includes('kimi')) return { bg: '#2563eb', color: '#fff' };
    if (p.includes('xai') || p.includes('grok')) return { bg: '#111827', color: '#fff' };
    return { bg: '#4f46e5', color: '#fff' };
  };

  // Sparkline generator for recent requests
  const renderSparkline = (f: AuthFileEntry) => {
    const buckets = f.recent_requests ?? [];
    if (buckets.length === 0) {
      return (
        <div style={{ display: 'flex', gap: 2, height: 16, alignItems: 'center' }}>
          {[...Array(8)].map((_, i) => (
            <div key={i} style={{ width: 4, height: 8, background: token.colorBorderSecondary, borderRadius: 1 }} />
          ))}
        </div>
      );
    }

    const max = Math.max(1, ...buckets.map((b) => b.success + b.failed));
    return (
      <div style={{ display: 'flex', gap: 2, height: 20, alignItems: 'flex-end' }}>
        {buckets.slice(-10).map((b, i) => {
          const total = b.success + b.failed;
          const h = total > 0 ? Math.max(4, Math.round((total / max) * 18)) : 3;
          const isError = b.failed > 0;
          return (
            <Tooltip key={i} title={`${b.time} +${b.success} / -${b.failed}`}>
              <div
                style={{
                  width: 4,
                  height: h,
                  background: isError ? '#ef4444' : '#22c55e',
                  borderRadius: 1,
                  cursor: 'pointer',
                }}
              />
            </Tooltip>
          );
        })}
      </div>
    );
  };

  // Table columns
  const columns: ColumnsType<AuthFileEntry> = [
    {
      title: t('authFiles.title'),
      key: 'credential',
      width: 260,
      render: (_, f) => {
        const isPinned = pinnedNames.includes(f.name);
        const style = getProviderIconStyle(f.provider || f.type || '');
        const emailStr = maskEmail(f.email || f.account || f.name.replace(/\.json$/i, ''), masked);

        return (
          <Space size={10} align="center">
            <span
              onClick={() => togglePin(f.name)}
              style={{ cursor: 'pointer', fontSize: 15, color: isPinned ? '#faad14' : '#d9d9d9' }}
            >
              {isPinned ? <StarFilled /> : <StarOutlined />}
            </span>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: style.bg,
                color: style.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 'bold',
                fontSize: 12,
                flexShrink: 0,
              }}
            >
              {(f.provider || f.type || 'A').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <Text strong style={{ fontSize: 13, display: 'block' }}>
                {emailStr}
              </Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {f.name}
              </Text>
            </div>
          </Space>
        );
      },
    },
    {
      title: t('authFiles.plan'),
      key: 'plan',
      width: 125,
      render: (_, f) => {
        const summary = parseCredentialSummary(f);
        let color = 'default';
        if (summary.planKnown) {
          const p = summary.plan.toLowerCase();
          if (p.includes('ultra') || p.includes('plus')) color = 'purple';
          else if (p.includes('pro') || p.includes('super') || p.includes('kimi')) color = 'blue';
          else if (p.includes('team') || p.includes('enterprise')) color = 'geekblue';
          else if (p.includes('muse') || p.includes('spark')) color = 'magenta';
          else if (p.includes('studio') || p.includes('devin')) color = 'cyan';
        }
        return (
          <Tooltip title={summary.planKnown ? undefined : t('authFiles.planUnconfirmed')}>
            <Tag color={color} style={{ fontWeight: 600 }}>{summary.plan}</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: t('authFiles.availability'),
      key: 'availability',
      width: 130,
      render: (_, f) => {
        const summary = parseCredentialSummary(f);
        if (f.disabled) {
          return (
            <div>
              <Tag color="default">{t('authFiles.statusDisabled')}</Tag>
              <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>
                {t('authFiles.priority')} {f.priority ?? 0}
              </div>
            </div>
          );
        }

        let badgeNode = <Tag color="success">Available</Tag>;
        if (summary.operationalState === 'reauth') {
          badgeNode = (
            <Tooltip title={f.status_message || '401/403: Reauth Required'}>
              <Tag color="error">Reauth</Tag>
            </Tooltip>
          );
        } else if (summary.operationalState === 'cooldown') {
          const rem = f.cooldowns?.[0]?.remaining_seconds;
          badgeNode = (
            <Tooltip title={f.cooldowns?.[0]?.reason}>
              <Tag color="warning">5H cooldown</Tag>
            </Tooltip>
          );
        } else if (summary.operationalState === 'exhausted') {
          badgeNode = <Tag color="orange">Exhausted</Tag>;
        }

        return (
          <div>
            {badgeNode}
            <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>
              {t('authFiles.priority')} {f.priority ?? 0}
            </div>
          </div>
        );
      },
    },
    {
      title: t('authFiles.recentRequests'),
      key: 'recentRequests',
      width: 170,
      render: (_, f) => {
        const summary = parseCredentialSummary(f);
        const lastActive = f.updated_at
          ? new Date(f.updated_at).toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' }) +
            ' ' +
            new Date(f.updated_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : '—';

        return (
          <div>
            <div style={{ fontSize: 11, color: token.colorTextTertiary, marginBottom: 2 }}>{lastActive}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {renderSparkline(f)}
              <div style={{ fontSize: 11 }}>
                <span style={{ color: '#1677ff', fontWeight: 500 }}>🚀 {summary.totalRequests}</span>
                <span style={{ color: token.colorTextTertiary, marginLeft: 6 }}>{summary.estimatedCostFormatted}</span>
              </div>
            </div>
          </div>
        );
      },
    },
    {
      title: t('authFiles.historicalUsage'),
      key: 'historicalUsage',
      width: 130,
      render: (_, f) => {
        const summary = parseCredentialSummary(f);
        const isHighRate = summary.successRate >= 95;
        return (
          <div>
            <div style={{ fontSize: 12, fontWeight: 500 }}>
              <span style={{ color: '#722ed1', marginRight: 4 }}>📊</span>
              {summary.totalTokensFormatted}
            </div>
            <div style={{ fontSize: 11, color: isHighRate ? '#52c41a' : '#ff4d4f', marginTop: 2 }}>
              ✓ {summary.successRate}%
            </div>
          </div>
        );
      },
    },
    {
      title: t('authFiles.quota'),
      key: 'quota',
      width: 330,
      render: (_, f) => {
        const summary = parseCredentialSummary(f);

        if (summary.groups && summary.groups.length > 0) {
          return (
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              {summary.groups.map((group, gIdx) => (
                <div key={gIdx} style={{ width: '100%' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: token.colorTextSecondary, marginBottom: 2 }}>
                    {group.displayName}
                  </div>
                  <div style={{ display: 'flex', gap: 10, width: '100%' }}>
                    {group.windows.map((w, wIdx) => {
                      const strokeColor = w.known
                        ? w.statusColor === 'green'
                          ? '#52c41a'
                          : w.statusColor === 'blue'
                          ? '#1677ff'
                          : w.statusColor === 'yellow'
                          ? '#faad14'
                          : '#ff4d4f'
                        : token.colorBorderSecondary;

                      return (
                        <div key={wIdx} style={{ flex: 1, minWidth: 90 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                            <Space size={3}>
                              <Text strong style={{ fontSize: 11 }}>{w.label}</Text>
                              {w.known ? (
                                <span style={{ color: token.colorTextTertiary }}>{w.remainingPercent}%</span>
                              ) : (
                                <Tooltip title={t('authFiles.notProbed')}>
                                  <span style={{ color: token.colorTextQuaternary, fontSize: 10 }}>· {t('authFiles.notProbedShort')}</span>
                                </Tooltip>
                              )}
                            </Space>
                            {w.resetIn && <span style={{ color: token.colorTextTertiary, fontSize: 10 }}>{w.resetIn}</span>}
                          </div>
                          <Progress
                            percent={w.known ? w.remainingPercent : 100}
                            strokeColor={strokeColor}
                            size="small"
                            showInfo={false}
                            style={{ margin: 0 }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </Space>
          );
        }

        return (
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            {summary.windows.map((w, idx) => {
              const strokeColor = w.known
                ? w.statusColor === 'green'
                  ? '#52c41a'
                  : w.statusColor === 'blue'
                  ? '#1677ff'
                  : w.statusColor === 'yellow'
                  ? '#faad14'
                  : '#ff4d4f'
                : token.colorBorderSecondary;

              return (
                <div key={idx} style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                    <Space size={4}>
                      <Text strong style={{ fontSize: 11 }}>{w.label}</Text>
                      {w.resetCount != null && (
                        <span style={{ color: '#1677ff', fontSize: 11 }}>🔄 {w.resetCount}</span>
                      )}
                      {w.known ? (
                        <span style={{ color: token.colorTextTertiary }}>| Rem {w.remainingPercent}%</span>
                      ) : (
                        <Tooltip title={t('authFiles.notProbed')}>
                          <span style={{ color: token.colorTextQuaternary, fontSize: 10 }}>· {t('authFiles.notProbedShort')}</span>
                        </Tooltip>
                      )}
                    </Space>
                    {w.resetIn && <span style={{ color: token.colorTextTertiary, fontSize: 11 }}>{w.resetIn}</span>}
                  </div>
                  <Progress
                    percent={w.known ? w.remainingPercent : 100}
                    strokeColor={strokeColor}
                    size="small"
                    showInfo={false}
                    style={{ margin: 0 }}
                  />
                  {(w.usedFormatted || w.limitFormatted) && (
                    <div style={{ fontSize: 10, color: token.colorTextTertiary, marginTop: 1, display: 'flex', justifyContent: 'space-between' }}>
                      <span>{w.usedFormatted}</span>
                      <span>{w.limitFormatted}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </Space>
        );
      },
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 200,
      render: (_, f) => (
        <Space size={4} wrap>
          <Tooltip title={t('authFiles.fetchQuota')}>
            <Button
              size="small"
              type="text"
              icon={<ReloadOutlined />}
              onClick={() => void refreshOne(f)}
            />
          </Tooltip>

          <Tooltip title={t('authFiles.quickEditTitle')}>
            <Button
              size="small"
              type="text"
              icon={<SettingOutlined />}
              onClick={() => setQuickEditEntries([f])}
            />
          </Tooltip>

          <Tooltip title={t('authFiles.viewModels')}>
            <Button
              size="small"
              type="text"
              icon={<EyeOutlined />}
              onClick={() => void openModels(f)}
            />
          </Tooltip>

          <Tooltip title={f.disabled ? t('common.enable') : t('common.disable')}>
            <Switch
              size="small"
              checked={!f.disabled}
              onChange={(checked) => void handleToggleDisabled(f, !checked)}
            />
          </Tooltip>

          <Tooltip title={t('common.download')}>
            <Button
              size="small"
              type="text"
              icon={<DownloadOutlined />}
              onClick={() => download(f)}
            />
          </Tooltip>

          <Popconfirm
            title={t('authFiles.deleteConfirm', { name: f.name })}
            onConfirm={() => void remove(f)}
            okButtonProps={{ danger: true }}
          >
            <Tooltip title={t('common.delete')}>
              <Button size="small" type="text" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>

          <Button
            size="small"
            type="primary"
            ghost
            onClick={() => setDetailTarget(f)}
            style={{ fontSize: 11, padding: '0 8px', height: 22 }}
          >
            {t('common.details')}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ paddingBottom: 24 }}>
      {/* Top Header / Subtabs Navigation & Action Buttons */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as 'list' | 'health' | 'oauth')}
          style={{ marginBottom: 0 }}
          items={[
            { key: 'list', label: t('authFiles.tabList') },
            {
              key: 'health',
              label: (
                <Space size={6}>
                  <span>{t('authFiles.tabHealth')}</span>
                  {(kpis.needsAttention + kpis.quotaRisk) > 0 && (
                    <Badge
                      count={kpis.needsAttention + kpis.quotaRisk}
                      style={{ backgroundColor: kpis.needsAttention > 0 ? '#ff4d4f' : '#faad14' }}
                    />
                  )}
                </Space>
              ),
            },
            { key: 'oauth', label: t('authFiles.tabOauth') },
          ]}
        />

        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
            {t('common.refresh')}
          </Button>
          <Button icon={<CodeOutlined />} onClick={() => setPasteModalOpen(true)}>
            {t('authFiles.pasteJson')}
          </Button>
          <Upload {...uploadProps}>
            <Button type="primary" icon={<CloudUploadOutlined />}>
              {t('authFiles.uploadFile')}
            </Button>
          </Upload>
        </Space>
      </div>

      {/* Tab 2: Health Inspection */}
      {activeTab === 'health' && (
        <HealthInspection
          files={files}
          onReload={load}
          onOpenDetail={setDetailTarget}
          masked={masked}
        />
      )}

      {/* Tab 3: OAuth Configuration */}
      {activeTab === 'oauth' && (
        <OAuthTab onSuccess={load} />
      )}

      {/* Tab 1: Credential List (Core View) */}
      {activeTab === 'list' && (
        <div>
          {/* Provider Quick Filter Pills */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto', paddingBottom: 4 }}>
            <Button
              size="middle"
              type={providerFilter === undefined ? 'primary' : 'default'}
              onClick={() => setProviderFilter(undefined)}
              style={{ borderRadius: 16 }}
            >
              All <Tag style={{ marginLeft: 4, borderRadius: 10 }}>{files.length}</Tag>
            </Button>
            {uniqueProviders.map((p) => {
              const active = providerFilter?.toLowerCase() === p;
              return (
                <Button
                  key={p}
                  size="middle"
                  type={active ? 'primary' : 'default'}
                  onClick={() => setProviderFilter(active ? undefined : p)}
                  style={{ borderRadius: 16 }}
                >
                  <span style={{ textTransform: 'capitalize' }}>{p}</span>
                  <Tag style={{ marginLeft: 4, borderRadius: 10 }}>{providerStats[p]}</Tag>
                </Button>
              );
            })}
          </div>

          {/* Search and Multi-Dimensional Filter Bar */}
          <Card size="small" style={{ marginBottom: 16, background: token.colorFillQuaternary }}>
            <Row gutter={[12, 12]} align="middle">
              <Col xs={24} sm={12} md={6}>
                <Input.Search
                  placeholder={t('authFiles.searchPlaceholder')}
                  allowClear
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                />
              </Col>
              <Col xs={12} sm={6} md={3}>
                <Select
                  style={{ width: '100%' }}
                  allowClear
                  placeholder={t('authFiles.filterAllStatuses')}
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[
                    { value: 'active', label: t('authFiles.statusActive') },
                    { value: 'disabled', label: t('authFiles.statusDisabled') },
                    { value: 'error', label: t('authFiles.statusError') },
                  ]}
                />
              </Col>
              <Col xs={12} sm={6} md={4}>
                <Select
                  style={{ width: '100%' }}
                  allowClear
                  placeholder={t('authFiles.filterAllStates')}
                  value={stateFilter}
                  onChange={setStateFilter}
                  options={[
                    { value: 'normal', label: t('authFiles.filterStateNormal') },
                    { value: 'cooldown', label: t('authFiles.filterStateCooldown') },
                    { value: 'reauth', label: t('authFiles.filterStateReauth') },
                    { value: 'exhausted', label: t('authFiles.filterStateExhausted') },
                  ]}
                />
              </Col>
              <Col xs={12} sm={6} md={3}>
                <Select
                  style={{ width: '100%' }}
                  allowClear
                  placeholder={t('authFiles.filterAllPlans')}
                  value={planFilter}
                  onChange={setPlanFilter}
                  options={[
                    { value: 'Free', label: 'Free' },
                    { value: 'Plus', label: 'Plus' },
                    { value: 'Team', label: 'Team' },
                    { value: 'Pro', label: 'Pro' },
                    { value: 'Enterprise', label: 'Enterprise' },
                  ]}
                />
              </Col>
              <Col xs={12} sm={6} md={4}>
                <Select
                  style={{ width: '100%' }}
                  allowClear
                  placeholder={t('authFiles.filterAllQuotas')}
                  value={quotaFilter}
                  onChange={setQuotaFilter}
                  options={[
                    { value: 'sufficient', label: t('authFiles.filterQuotaSufficient') },
                    { value: 'low', label: t('authFiles.filterQuotaLow') },
                    { value: 'exhausted', label: t('authFiles.filterQuotaExhausted') },
                    { value: 'cooldown', label: t('authFiles.filterQuotaCooldown') },
                  ]}
                />
              </Col>
              <Col xs={24} sm={12} md={4}>
                <Select
                  style={{ width: '100%' }}
                  value={sortBy}
                  onChange={setSortBy}
                  options={[
                    { value: 'recent', label: t('authFiles.sortRecent') },
                    { value: 'quota', label: t('authFiles.sortQuota') },
                    { value: 'success', label: t('authFiles.sortSuccessRate') },
                    { value: 'priority', label: t('authFiles.sortPriority') },
                    { value: 'name', label: t('authFiles.sortName') },
                  ]}
                />
              </Col>
            </Row>
          </Card>

          {/* 6 KPI Cards Matrix with Mini Trend Waves */}
          <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
            {/* 1. Total */}
            <Col xs={12} sm={8} md={4}>
              <Card
                size="small"
                hoverable
                onClick={() => {
                  setStatusFilter(undefined);
                  setStateFilter(undefined);
                }}
                style={{ height: '100%', borderColor: 'rgba(37,99,235,0.45)', borderRadius: 8, position: 'relative', overflow: 'hidden' }}
              >
                <Space size={6} align="center" style={{ marginBottom: 4 }}>
                  <KeyOutlined style={{ color: '#2563eb', fontSize: 14 }} />
                  <Text type="secondary" style={{ fontSize: 12 }}>{t('authFiles.kpiTotal')}</Text>
                </Space>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#2563eb' }}>{kpis.total}</div>
                <div style={{ fontSize: 11, color: token.colorTextTertiary }}>{t('authFiles.kpiTotalSub')}</div>
                <svg width="60" height="24" style={{ position: 'absolute', right: 8, bottom: 8, opacity: 0.35 }}>
                  <path d="M0,16 Q15,4 30,12 T60,8" fill="none" stroke="#2563eb" strokeWidth="2" />
                </svg>
              </Card>
            </Col>

            {/* 2. Normally Available */}
            <Col xs={12} sm={8} md={4}>
              <Card
                size="small"
                hoverable
                onClick={() => setStateFilter('normal')}
                style={{ height: '100%', borderColor: 'rgba(22,163,74,0.45)', borderRadius: 8, position: 'relative', overflow: 'hidden' }}
              >
                <Space size={6} align="center" style={{ marginBottom: 4 }}>
                  <CheckCircleOutlined style={{ color: '#16a34a', fontSize: 14 }} />
                  <Text type="secondary" style={{ fontSize: 12 }}>{t('authFiles.kpiAvailable')}</Text>
                </Space>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#16a34a' }}>{kpis.normallyAvailable}</div>
                <div style={{ fontSize: 11, color: token.colorTextTertiary }}>{t('authFiles.kpiAvailableSub')}</div>
                <svg width="60" height="24" style={{ position: 'absolute', right: 8, bottom: 8, opacity: 0.35 }}>
                  <path d="M0,18 Q15,6 30,14 T60,4" fill="none" stroke="#16a34a" strokeWidth="2" />
                </svg>
              </Card>
            </Col>

            {/* 3. Needs Attention */}
            <Col xs={12} sm={8} md={4}>
              <Card
                size="small"
                hoverable
                onClick={() => setStateFilter('reauth')}
                style={{ height: '100%', borderColor: 'rgba(220,38,38,0.45)', borderRadius: 8, position: 'relative', overflow: 'hidden' }}
              >
                <Space size={6} align="center" style={{ marginBottom: 4 }}>
                  <WarningOutlined style={{ color: '#dc2626', fontSize: 14 }} />
                  <Text type="secondary" style={{ fontSize: 12 }}>{t('authFiles.kpiAttention')}</Text>
                </Space>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#dc2626' }}>{kpis.needsAttention}</div>
                <div style={{ fontSize: 11, color: token.colorTextTertiary }}>{t('authFiles.kpiAttentionSub')}</div>
                <svg width="60" height="24" style={{ position: 'absolute', right: 8, bottom: 8, opacity: 0.35 }}>
                  <path d="M0,12 Q15,20 30,10 T60,18" fill="none" stroke="#dc2626" strokeWidth="2" />
                </svg>
              </Card>
            </Col>

            {/* 4. Quota Risk */}
            <Col xs={12} sm={8} md={4}>
              <Card
                size="small"
                hoverable
                onClick={() => setStateFilter('cooldown')}
                style={{ height: '100%', borderColor: 'rgba(217,119,6,0.45)', borderRadius: 8, position: 'relative', overflow: 'hidden' }}
              >
                <Space size={6} align="center" style={{ marginBottom: 4 }}>
                  <ThunderboltOutlined style={{ color: '#d97706', fontSize: 14 }} />
                  <Text type="secondary" style={{ fontSize: 12 }}>{t('authFiles.kpiQuotaRisk')}</Text>
                </Space>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#d97706' }}>{kpis.quotaRisk}</div>
                <div style={{ fontSize: 11, color: token.colorTextTertiary }}>{t('authFiles.kpiQuotaRiskSub')}</div>
                <svg width="60" height="24" style={{ position: 'absolute', right: 8, bottom: 8, opacity: 0.35 }}>
                  <path d="M0,14 Q15,8 30,16 T60,6" fill="none" stroke="#d97706" strokeWidth="2" />
                </svg>
              </Card>
            </Col>

            {/* 5. Disabled */}
            <Col xs={12} sm={8} md={4}>
              <Card
                size="small"
                hoverable
                onClick={() => setStatusFilter('disabled')}
                style={{ height: '100%', borderColor: token.colorBorderSecondary, borderRadius: 8, position: 'relative', overflow: 'hidden' }}
              >
                <Space size={6} align="center" style={{ marginBottom: 4 }}>
                  <StopOutlined style={{ color: token.colorTextTertiary, fontSize: 14 }} />
                  <Text type="secondary" style={{ fontSize: 12 }}>{t('authFiles.kpiDisabled')}</Text>
                </Space>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: token.colorTextTertiary }}>{kpis.disabled}</div>
                <div style={{ fontSize: 11, color: token.colorTextTertiary }}>{t('authFiles.kpiDisabledSub')}</div>
                <svg width="60" height="24" style={{ position: 'absolute', right: 8, bottom: 8, opacity: 0.35 }}>
                  <path d="M0,15 L60,15" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 2" />
                </svg>
              </Card>
            </Col>

            {/* 6. Unconfirmed */}
            <Col xs={12} sm={8} md={4}>
              <Card
                size="small"
                hoverable
                style={{ height: '100%', borderColor: 'rgba(147,51,234,0.45)', borderRadius: 8, position: 'relative', overflow: 'hidden' }}
              >
                <Space size={6} align="center" style={{ marginBottom: 4 }}>
                  <QuestionCircleOutlined style={{ color: '#9333ea', fontSize: 14 }} />
                  <Text type="secondary" style={{ fontSize: 12 }}>{t('authFiles.kpiUnconfirmed')}</Text>
                </Space>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#9333ea' }}>{kpis.unconfirmed}</div>
                <div style={{ fontSize: 11, color: token.colorTextTertiary }}>{t('authFiles.kpiUnconfirmedSub')}</div>
                <svg width="60" height="24" style={{ position: 'absolute', right: 8, bottom: 8, opacity: 0.35 }}>
                  <path d="M0,16 Q20,12 40,16 T60,12" fill="none" stroke="#9333ea" strokeWidth="2" />
                </svg>
              </Card>
            </Col>
          </Row>

          {/* Batch Operation Toolbar & View Switcher */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
              flexWrap: 'wrap',
              gap: 8,
              padding: '8px 12px',
              background: token.colorFillQuaternary,
              borderRadius: 6,
            }}
          >
            <Space wrap align="center">
              {selectedEntries.length > 0 ? (
                <>
                  <Text strong>{t('authFiles.batchSelectDesc').replace('{{count}}', String(selectedEntries.length))}</Text>
                  <Button size="small" loading={batchBusy} onClick={() => void runBatch('enable')}>
                    {t('common.enable')}
                  </Button>
                  <Button size="small" loading={batchBusy} onClick={() => void runBatch('disable')}>
                    {t('common.disable')}
                  </Button>
                  <Button size="small" onClick={() => setQuickEditEntries(selectedEntries)}>
                    {t('authFiles.batchSetPriority')}
                  </Button>
                  <Button size="small" loading={batchBusy} onClick={() => void runBatch('refresh')}>
                    {t('authFiles.batchRefreshQuota')}
                  </Button>
                  <Popconfirm title={t('common.confirm')} onConfirm={() => void runBatch('delete')} okButtonProps={{ danger: true }}>
                    <Button size="small" danger loading={batchBusy}>
                      {t('common.delete')}
                    </Button>
                  </Popconfirm>
                </>
              ) : (
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {t('authFiles.batchSelectDesc').replace('{{count}}', '0')}
                </Text>
              )}
            </Space>

            <Space wrap align="center">
              <Button
                size="small"
                onClick={() => {
                  if (selectedKeys.length === filteredFiles.length) {
                    setSelectedKeys([]);
                  } else {
                    setSelectedKeys(filteredFiles.map((f) => `${f.id}-${f.auth_index ?? ''}`));
                  }
                }}
              >
                {selectedKeys.length === filteredFiles.length ? 'Deselect All' : 'Select All'}
              </Button>

              <Button
                size="small"
                icon={masked ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                onClick={handleToggleMasked}
              >
                {masked ? t('authFiles.masked') : t('authFiles.unmasked')}
              </Button>

              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={async () => {
                  try {
                    await mgmt.post('/auth-files/refresh', { all: true });
                    message.success(t('authFiles.refreshOk'));
                  } catch (e) {
                    message.error((e as Error).message);
                  }
                  void load();
                }}
              >
                {t('authFiles.refreshQuota')}
              </Button>

              <Space.Compact size="small">
                <Button
                  type={viewMode === 'table' ? 'primary' : 'default'}
                  icon={<TableOutlined />}
                  onClick={() => handleToggleViewMode('table')}
                >
                  {t('authFiles.tableView')}
                </Button>
                <Button
                  type={viewMode === 'card' ? 'primary' : 'default'}
                  icon={<AppstoreOutlined />}
                  onClick={() => handleToggleViewMode('card')}
                >
                  {t('authFiles.cardView')}
                </Button>
              </Space.Compact>
            </Space>
          </div>

          {/* Table View Mode */}
          {viewMode === 'table' && (
            <Table
              rowKey={(f) => `${f.id}-${f.auth_index ?? ''}`}
              columns={columns}
              dataSource={filteredFiles}
              loading={loading}
              pagination={{ pageSize: 20, showTotal: (n) => `${n} credentials` }}
              size="middle"
              rowSelection={{
                selectedRowKeys: selectedKeys,
                onChange: (keys) => setSelectedKeys(keys),
              }}
            />
          )}

          {/* Card View Mode */}
          {viewMode === 'card' && (
            <div>
              {filteredFiles.length === 0 ? (
                <Card style={{ textAlign: 'center', padding: '40px 0' }}>
                  <Empty description="No credentials found matching filters" />
                </Card>
              ) : (
                <Row gutter={[16, 16]}>
                  {filteredFiles.map((f) => {
                    const isPinned = pinnedNames.includes(f.name);
                    const summary = parseCredentialSummary(f);
                    const style = getProviderIconStyle(f.provider || f.type || '');
                    const emailStr = maskEmail(f.email || f.account || f.name.replace(/\.json$/i, ''), masked);

                    return (
                      <Col xs={24} sm={12} lg={8} key={`${f.id}-${f.auth_index ?? ''}`}>
                        <Card
                          hoverable
                          size="small"
                          style={{
                            height: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            borderTop: `3px solid ${style.bg}`,
                          }}
                        >
                          {/* Card Header */}
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                              <Space size={8}>
                                <span
                                  onClick={() => togglePin(f.name)}
                                  style={{ cursor: 'pointer', fontSize: 16, color: isPinned ? '#faad14' : '#d9d9d9' }}
                                >
                                  {isPinned ? <StarFilled /> : <StarOutlined />}
                                </span>
                                <div
                                  style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: '50%',
                                    background: style.bg,
                                    color: style.color,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontWeight: 'bold',
                                    fontSize: 11,
                                  }}
                                >
                                  {(f.provider || f.type || 'A').slice(0, 2).toUpperCase()}
                                </div>
                                <div>
                                  <Text strong style={{ fontSize: 13, display: 'block', maxWidth: 170 }} ellipsis>
                                    {emailStr}
                                  </Text>
                                  <Text type="secondary" style={{ fontSize: 10 }}>{f.name}</Text>
                                </div>
                              </Space>

                              <Space size={4}>
                                <Tag color={
                                  summary.planKnown
                                    ? summary.plan.toLowerCase().includes('ultra') || summary.plan.toLowerCase().includes('plus')
                                      ? 'purple'
                                      : summary.plan.toLowerCase().includes('pro') || summary.plan.toLowerCase().includes('super') || summary.plan.toLowerCase().includes('kimi')
                                      ? 'blue'
                                      : summary.plan.toLowerCase().includes('team') || summary.plan.toLowerCase().includes('enterprise')
                                      ? 'geekblue'
                                      : summary.plan.toLowerCase().includes('muse')
                                      ? 'magenta'
                                      : 'cyan'
                                    : 'default'
                                }>
                                  {summary.plan}
                                </Tag>
                                <Switch
                                  size="small"
                                  checked={!f.disabled}
                                  onChange={(checked) => void handleToggleDisabled(f, !checked)}
                                />
                              </Space>
                            </div>

                            {/* Status & Priority */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, background: token.colorFillQuaternary, padding: '4px 8px', borderRadius: 4 }}>
                              <div>
                                {f.disabled ? (
                                  <Tag color="default">Disabled</Tag>
                                ) : summary.operationalState === 'reauth' ? (
                                  <Tag color="error">Reauth</Tag>
                                ) : summary.operationalState === 'cooldown' ? (
                                  <Tag color="warning">5H cooldown</Tag>
                                ) : summary.operationalState === 'exhausted' ? (
                                  <Tag color="orange">Exhausted</Tag>
                                ) : (
                                  <Tag color="success">Available</Tag>
                                )}
                              </div>
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                {t('authFiles.priority')}: <span style={{ fontWeight: 600, color: '#1677ff' }}>{f.priority ?? 0}</span>
                              </Text>
                            </div>

                            {/* Quota Progress Bars */}
                            <div style={{ marginBottom: 12 }}>
                              {summary.groups && summary.groups.length > 0 ? (
                                summary.groups.map((group, gIdx) => (
                                  <div key={gIdx} style={{ marginBottom: 8 }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, color: token.colorTextSecondary, marginBottom: 2 }}>
                                      {group.displayName}
                                    </div>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                      {group.windows.map((w, wIdx) => {
                                        const strokeColor = w.known
                                          ? w.statusColor === 'green'
                                            ? '#52c41a'
                                            : w.statusColor === 'blue'
                                            ? '#1677ff'
                                            : w.statusColor === 'yellow'
                                            ? '#faad14'
                                            : '#ff4d4f'
                                          : token.colorBorderSecondary;
                                        return (
                                          <div key={wIdx} style={{ flex: 1 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
                                              <Space size={2}>
                                                <Text strong style={{ fontSize: 10 }}>{w.label}</Text>
                                                {w.known ? (
                                                  <span style={{ color: token.colorTextTertiary }}>{w.remainingPercent}%</span>
                                                ) : (
                                                  <span style={{ color: token.colorTextQuaternary, fontSize: 9 }}>· {t('authFiles.notProbedShort')}</span>
                                                )}
                                              </Space>
                                              {w.resetIn && <span style={{ color: token.colorTextTertiary, fontSize: 9 }}>{w.resetIn}</span>}
                                            </div>
                                            <Progress percent={w.known ? w.remainingPercent : 100} strokeColor={strokeColor} size="small" showInfo={false} />
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))
                              ) : (
                                summary.windows.map((w, idx) => {
                                  const strokeColor = w.known
                                    ? w.statusColor === 'green'
                                      ? '#52c41a'
                                      : w.statusColor === 'blue'
                                      ? '#1677ff'
                                      : w.statusColor === 'yellow'
                                      ? '#faad14'
                                      : '#ff4d4f'
                                    : token.colorBorderSecondary;

                                  return (
                                    <div key={idx} style={{ marginBottom: 6 }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                                        <Space size={4}>
                                          <Text strong style={{ fontSize: 11 }}>{w.label}</Text>
                                          {w.known ? (
                                            <span style={{ color: token.colorTextTertiary }}>Rem {w.remainingPercent}%</span>
                                          ) : (
                                            <Tooltip title={t('authFiles.notProbed')}>
                                              <span style={{ color: token.colorTextQuaternary, fontSize: 10 }}>· {t('authFiles.notProbedShort')}</span>
                                            </Tooltip>
                                          )}
                                        </Space>
                                        {w.resetIn && <span style={{ color: token.colorTextTertiary, fontSize: 10 }}>{w.resetIn}</span>}
                                      </div>
                                      <Progress percent={w.known ? w.remainingPercent : 100} strokeColor={strokeColor} size="small" showInfo={false} />
                                    </div>
                                  );
                                })
                              )}
                            </div>

                            {/* Metrics & History */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                              <Space size={6}>
                                {renderSparkline(f)}
                                <Text style={{ fontSize: 11 }}>🚀 {summary.totalRequests}</Text>
                              </Space>
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: 11, fontWeight: 500 }}>📊 {summary.totalTokensFormatted}</div>
                                <div style={{ fontSize: 10, color: summary.successRate >= 95 ? '#52c41a' : '#ff4d4f' }}>
                                  ✓ {summary.successRate}%
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Card Footer Actions */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${token.colorBorderSecondary}`, paddingTop: 8, marginTop: 8 }}>
                            <Space size={2}>
                              <Tooltip title={t('authFiles.fetchQuota')}>
                                <Button size="small" type="text" icon={<ReloadOutlined />} onClick={() => void refreshOne(f)} />
                              </Tooltip>
                              <Tooltip title={t('authFiles.quickEditTitle')}>
                                <Button size="small" type="text" icon={<SettingOutlined />} onClick={() => setQuickEditEntries([f])} />
                              </Tooltip>
                              <Tooltip title={t('common.download')}>
                                <Button size="small" type="text" icon={<DownloadOutlined />} onClick={() => download(f)} />
                              </Tooltip>
                              <Popconfirm title={t('authFiles.deleteConfirm', { name: f.name })} onConfirm={() => void remove(f)} okButtonProps={{ danger: true }}>
                                <Tooltip title={t('common.delete')}>
                                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                                </Tooltip>
                              </Popconfirm>
                            </Space>

                            <Button size="small" type="primary" ghost onClick={() => setDetailTarget(f)}>
                              {t('common.details')}
                            </Button>
                          </div>
                        </Card>
                      </Col>
                    );
                  })}
                </Row>
              )}
            </div>
          )}
        </div>
      )}

      {/* Detail Drawer */}
      <CredentialDetail
        entry={detailTarget}
        onClose={() => setDetailTarget(null)}
        onChanged={() => void load()}
      />

      {/* Paste JSON Modal */}
      <PasteJsonModal
        open={pasteModalOpen}
        onClose={() => setPasteModalOpen(false)}
        onSuccess={() => void load()}
      />

      {/* Quick Edit Priority & Note Modal */}
      <QuickEditModal
        open={quickEditEntries.length > 0}
        entries={quickEditEntries}
        onClose={() => setQuickEditEntries([])}
        onSuccess={() => void load()}
      />

      {/* View Models Drawer */}
      <Drawer title={t('authFiles.viewModels')} open={!!modelsTarget} onClose={() => setModelsTarget(null)} width={480}>
        <Table
          rowKey="id"
          size="small"
          dataSource={models}
          columns={[
            { title: 'ID', dataIndex: 'id' },
            { title: 'Name', dataIndex: 'display_name', render: (v) => v || '—' },
          ]}
          pagination={false}
          locale={{ emptyText: '—' }}
        />
      </Drawer>

      {/* Edit Fields Modal */}
      <Modal
        title={`${t('authFiles.fields')} - ${fieldsTarget?.name ?? ''}`}
        open={!!fieldsTarget}
        onOk={() => void saveFields()}
        onCancel={() => setFieldsTarget(null)}
        width={640}
        okText={t('common.save')}
      >
        <p style={{ color: token.colorTextTertiary }}>PATCH /auth-files/fields — JSON merge body, e.g. {`{"priority": 1, "project_id": "..."}`}</p>
        <Input.TextArea rows={10} value={fieldsText} onChange={(e) => setFieldsText(e.target.value)} style={{ fontFamily: 'monospace' }} />
      </Modal>
    </div>
  );
}
