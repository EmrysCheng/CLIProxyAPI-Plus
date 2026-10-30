import { useCallback, useEffect, useRef, useState } from 'react';
import { App as AntApp, Button, Card, Input, Modal, Popconfirm, Select, Space, Table, Tabs, Typography } from 'antd';
import { ClearOutlined, ReloadOutlined, FileSearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { mgmt } from '../api/client';
import { parseLogLevel } from '../lib/panel';

const { Text, Paragraph } = Typography;

interface LogsResponse {
  lines: string[];
  'line-count': number;
  'latest-timestamp': number;
  'next-cursor': string;
}

function AppLogs() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(true);
  const [scroll, setScroll] = useState(true);
  const [filter, setFilter] = useState('');
  const [level, setLevel] = useState<string>('all');
  const cursorRef = useRef<string>('');
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [disabled, setDisabled] = useState(false);

  const load = useCallback(
    async (reset = false) => {
      setLoading(true);
      try {
        const cursor = reset ? '' : cursorRef.current;
        const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=500` : '?limit=500';
        const data = await mgmt.get<LogsResponse>(`/logs${qs}`);
        cursorRef.current = data['next-cursor'] ?? '';
        setLines((prev) => (reset ? data.lines : [...prev, ...data.lines].slice(-3000)));
        setDisabled(false);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes('logging to file disabled')) setDisabled(true);
        else message.error(msg);
      } finally {
        setLoading(false);
      }
    },
    [message],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => {
      if (!loading) void load(false);
    }, 5000);
    return () => clearInterval(timer);
  }, [auto, loading, load]);

  // Auto-scroll to the bottom whenever new lines arrive and follow is on.
  useEffect(() => {
    if (scroll && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [lines, scroll]);

  const visible = lines.filter((line) => {
    if (level !== 'all' && parseLogLevel(line) !== level) return false;
    if (filter && !line.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  const levelColor = (lv: string): string =>
    lv === 'error' ? '#ff7b72' : lv === 'warning' || lv === 'warn' ? '#e3b341' : lv === 'debug' ? '#8b949e' : '#c9d1d9';

  return (
    <Card
      title={t('logs.appLogs')}
      extra={
        <Space wrap>
          <Input.Search
            allowClear
            size="small"
            style={{ width: 200 }}
            placeholder={t('logs.searchPlaceholder')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <Select size="small" style={{ width: 100 }} value={level} onChange={setLevel}
            options={[
              { value: 'all', label: t('logs.levelAll') },
              { value: 'info', label: 'INFO' },
              { value: 'warning', label: 'WARN' },
              { value: 'error', label: 'ERROR' },
              { value: 'debug', label: 'DEBUG' },
            ]}
          />
          <Button size="small" onClick={() => setScroll(!scroll)} type={scroll ? 'primary' : 'default'} ghost={scroll}>
            {t('logs.follow')}
          </Button>
          <Button size="small" onClick={() => setAuto(!auto)} type={auto ? 'primary' : 'default'} ghost={auto}>
            auto
          </Button>
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void load(true)}>
            {t('common.refresh')}
          </Button>
        </Space>
      }
    >
      {disabled ? (
        <Text type="warning">{t('logs.loggingDisabled')}</Text>
      ) : (
        <div
          ref={boxRef}
          style={{
            background: '#0b1021',
            color: '#c9d1d9',
            fontFamily: 'Consolas, monospace',
            fontSize: 12,
            padding: 12,
            borderRadius: 8,
            height: 480,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {visible.length === 0 ? (
            <span style={{ color: '#666' }}>{t('logs.noLogs')}</span>
          ) : (
            visible.map((line, i) => (
              <div key={i} style={{ color: levelColor(parseLogLevel(line)) }}>
                {line}
              </div>
            ))
          )}
          <div style={{ color: '#666', paddingTop: 4 }}>
            {t('logs.showing').replace('{{shown}}', String(visible.length)).replace('{{total}}', String(lines.length))}
          </div>
        </div>
      )}
    </Card>
  );
}

interface ErrorLogFile {
  name: string;
  size?: number;
  modified?: string;
}

function RequestLogs() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [files, setFiles] = useState<ErrorLogFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<{ id: string; content: string } | null>(null);
  const [searchId, setSearchId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mgmt.get<{ files: ErrorLogFile[] }>('/request-error-logs');
      setFiles(data.files ?? []);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const viewDetail = async (id: string) => {
    try {
      const data = await mgmt.get<string | { content?: string }>(`/request-log-by-id/${encodeURIComponent(id)}`);
      const content = typeof data === 'string' ? data : (data.content ?? JSON.stringify(data, null, 2));
      setDetail({ id, content });
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
          {t('common.refresh')}
        </Button>
        <Input.Search
          placeholder={t('logs.requestId')}
          style={{ width: 320 }}
          value={searchId}
          onChange={(e) => setSearchId(e.target.value)}
          onSearch={(v) => v.trim() && void viewDetail(v.trim())}
          enterButton={t('logs.viewDetail')}
        />
      </Space>
      <Table
        rowKey="name"
        size="small"
        loading={loading}
        dataSource={files}
        pagination={{ pageSize: 15 }}
        columns={[
          { title: 'File', dataIndex: 'name', render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
          { title: 'Size', dataIndex: 'size', width: 110, render: (v?: number) => (v != null ? `${(v / 1024).toFixed(1)} KB` : '—') },
          { title: 'Modified', dataIndex: 'modified', width: 180, render: (v?: string) => (v ? new Date(v).toLocaleString() : '—') },
          {
            title: t('common.actions'),
            key: 'actions',
            width: 200,
            render: (_, r: ErrorLogFile) => (
              <Space>
                <Button size="small" icon={<FileSearchOutlined />} onClick={() => void viewDetail(r.name.replace(/\.log$/, ''))}>
                  {t('logs.viewDetail')}
                </Button>
                <a href={`/panel/api/v0/management/request-error-logs/${encodeURIComponent(r.name)}`} target="_blank" rel="noreferrer">
                  {t('common.download')}
                </a>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title={`${t('logs.viewDetail')} — ${detail?.id ?? ''}`}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width={860}
      >
        <Paragraph style={{ maxHeight: 500, overflow: 'auto', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {detail?.content}
        </Paragraph>
      </Modal>
    </div>
  );
}

export default function Logs() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();

  const clearLogs = async () => {
    try {
      await mgmt.del('/logs');
      message.success(t('common.success'));
      window.location.reload();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <div>
      <Tabs
        items={[
          { key: 'app', label: t('logs.appLogs'), children: <AppLogs /> },
          { key: 'requests', label: t('logs.requestLogs'), children: <RequestLogs /> },
        ]}
      />
      <div style={{ marginTop: 16 }}>
        <Popconfirm
          title={t('logs.clearConfirm')}
          onConfirm={() => void clearLogs()}
          okButtonProps={{ danger: true }}
          okText={t('common.confirm')}
          cancelText={t('common.cancel')}
        >
          <Button danger icon={<ClearOutlined />}>
            {t('logs.clearLogs')}
          </Button>
        </Popconfirm>
      </div>
    </div>
  );
}
