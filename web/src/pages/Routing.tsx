import { useEffect, useState } from 'react';
import { App as AntApp, Button, Card, InputNumber, Popconfirm, Select, Switch } from 'antd';
import { useTranslation } from 'react-i18next';
import { mgmt } from '../api/client';
import { useScalarSetting } from '../components/shared';

// NumberCard manages a local draft for an integer setting and saves on click.
function NumberCard({
  title,
  desc,
  path,
  responseKey,
  min,
  max,
  fallback,
}: {
  title: string;
  desc?: string;
  path: string;
  responseKey: string;
  min: number;
  max: number;
  fallback: number;
}) {
  const { t } = useTranslation();
  const setting = useScalarSetting<number>(path, responseKey);
  const [draft, setDraft] = useState<number | undefined>(undefined);

  useEffect(() => {
    setDraft(setting.value);
  }, [setting.value]);

  return (
    <Card title={title} style={{ marginBottom: 16 }}>
      {desc && <p style={{ color: '#888', marginTop: 0 }}>{desc}</p>}
      <InputNumber min={min} max={max} value={draft} onChange={(v) => typeof v === 'number' && setDraft(v)} style={{ width: 200 }} />
      <Button
        type="primary"
        style={{ marginLeft: 12 }}
        loading={setting.saving}
        onClick={() => void setting.save(draft ?? fallback)}
      >
        {t('common.save')}
      </Button>
    </Card>
  );
}

export default function Routing() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const strategy = useScalarSetting<string>('/routing/strategy', 'strategy');
  const forcePrefix = useScalarSetting<boolean>('/force-model-prefix', 'force-model-prefix');

  const resetCooldown = async () => {
    try {
      await mgmt.post('/reset-quota');
      message.success(t('routing.resetCooldownOk'));
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <div>
      <Card title={t('routing.strategy')} style={{ marginBottom: 16 }}>
        <Select
          style={{ width: 320 }}
          value={strategy.value ?? 'round-robin'}
          loading={strategy.loading || strategy.saving}
          onChange={(v) => void strategy.save(v)}
          options={[
            { value: 'round-robin', label: t('routing.strategyRoundRobin') },
            { value: 'weighted-round-robin', label: t('routing.strategyWeighted') },
            { value: 'fill-first', label: t('routing.strategyFillFirst') },
          ]}
        />
      </Card>

      <NumberCard title={t('routing.requestRetry')} desc={t('routing.requestRetryDesc')} path="/request-retry" responseKey="request-retry" min={0} max={20} fallback={3} />
      <NumberCard title={t('routing.maxRetryInterval')} path="/max-retry-interval" responseKey="max-retry-interval" min={0} max={600} fallback={30} />
      <NumberCard
        title={t('routing.maxRetryCredentials')}
        desc={t('routing.maxRetryCredentialsDesc')}
        path="/max-retry-credentials"
        responseKey="max-retry-credentials"
        min={0}
        max={1000}
        fallback={0}
      />

      <Card title={t('routing.forceModelPrefix')} style={{ marginBottom: 16 }}>
        <p style={{ color: '#888', marginTop: 0 }}>{t('routing.forceModelPrefixDesc')}</p>
        <Switch checked={!!forcePrefix.value} loading={forcePrefix.saving} onChange={(v) => void forcePrefix.save(v)} />
      </Card>

      <Card title={t('routing.resetCooldown')}>
        <p style={{ color: '#888', marginTop: 0 }}>{t('routing.cooldownTip')}</p>
        <Popconfirm title={t('common.confirm')} onConfirm={() => void resetCooldown()}>
          <Button danger>{t('routing.resetCooldown')}</Button>
        </Popconfirm>
      </Card>
    </div>
  );
}
