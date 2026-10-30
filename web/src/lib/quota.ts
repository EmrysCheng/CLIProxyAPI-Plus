// Quota calculation, countdown formatting, and masking helpers.
//
// Window data comes from three sources, in priority order:
//  1. Real quota signals passively captured from upstream responses
//     (Codex `X-Codex-Primary/Secondary-*`, Devin `daily/weekly_quota_remaining_percent`).
//  2. Normalized quota groups returned from active probes or cached metadata
//     (e.g. Antigravity Gemini and Claude & GPT multi-groups).
//  3. Active cooldowns observed by the router (exhausted window + reset countdown).
//  4. Provider-specific window layouts rendered as "not probed" placeholders.

export interface ParsedQuotaWindow {
  label: string; // '5h' | '7d' | 'Daily' | 'Weekly' | 'Monthly' | custom
  remainingPercent: number; // 0 to 100 (only meaningful when known=true)
  known: boolean; // false => upstream never reported usage for this window yet
  used?: number;
  limit?: number;
  usedFormatted?: string;
  limitFormatted?: string;
  resetIn?: string;
  resetInSeconds?: number;
  resetCount?: number;
  statusColor: 'green' | 'blue' | 'yellow' | 'red' | 'unknown';
}

export interface ParsedQuotaGroup {
  displayName: string; // e.g. "Gemini" | "Claude & GPT"
  windows: ParsedQuotaWindow[];
}

export interface CredentialSummary {
  plan: string;
  planKnown: boolean;
  operationalState: 'normal' | 'cooldown' | 'reauth' | 'exhausted';
  windows: ParsedQuotaWindow[];
  groups: ParsedQuotaGroup[];
  successRate: number;
  totalRequests: number;
  totalTokensFormatted: string;
  estimatedCostFormatted: string;
  isNormallyAvailable: boolean;
  needsAttention: boolean;
  hasQuotaRisk: boolean;
  isUnconfirmed: boolean;
}

// Providers whose accounts are metered through 5-hour + weekly rolling windows.
const ROLLING_WINDOW_PROVIDERS = new Set([
  'codex',
  'openai',
  'claude',
  'anthropic',
  'antigravity',
  'gemini',
  'kimi',
  'kimi-ai',
  'xai',
  'grok',
  'meta',
  'qwen',
  'iflow',
]);

// maskEmail masks email addresses for privacy (e.g. sea***@gmail.com).
export function maskEmail(email: string | undefined | null, masked: boolean): string {
  if (!email || !masked) return email || '—';
  const atIdx = email.indexOf('@');
  if (atIdx > 0) {
    const user = email.slice(0, atIdx);
    const domain = email.slice(atIdx);
    if (user.length <= 2) {
      return user.slice(0, 1) + '***' + domain;
    }
    const prefix = user.slice(0, Math.min(3, Math.ceil(user.length / 2)));
    return prefix + '***' + domain;
  }
  if (email.length <= 6) return email.slice(0, 2) + '***';
  return email.slice(0, 3) + '***' + email.slice(-3);
}

// formatCountdown formats seconds into user-friendly durations like "in 1h 5m" or "in 6d".
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return 'now';
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) {
    return remMinutes > 0 ? `in ${hours}h ${remMinutes}m` : `in ${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `in ${days}d`;
}

// formatNumberCompact formats large numbers: 52900000 -> 52.9M, 633000 -> 633K.
export function formatNumberCompact(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return '0';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

// formatCost formats a dollar amount: 2.25 -> $2.25.
export function formatCost(amount: number | undefined | null): string {
  if (amount == null || isNaN(amount) || amount === 0) return '$0.00';
  if (amount < 0.01) return `<$0.01`;
  return `$${amount.toFixed(2)}`;
}

function getStatusColor(percent: number): 'green' | 'blue' | 'yellow' | 'red' {
  if (percent > 50) return 'green';
  if (percent >= 20) return 'blue';
  if (percent > 0) return 'yellow';
  return 'red';
}

// windowLabelForMinutes renders a human window label from its duration.
function windowLabelForMinutes(minutes: number | undefined): string {
  if (!minutes || minutes <= 0) return 'Window';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) {
    const h = Math.round(minutes / 60);
    return `${h}h`;
  }
  const days = Math.round(minutes / 1440);
  return days === 7 ? '7d' : `${days}d`;
}

function parseSignalNumber(signals: Record<string, string>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = signals[key];
    if (raw == null) continue;
    const cleaned = String(raw).replace('%', '').trim();
    const value = Number(cleaned);
    if (!isNaN(value)) return value;
  }
  return undefined;
}

function parseSignalEpoch(signals: Record<string, string>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = signals[key];
    if (raw == null) continue;
    const value = Number(String(raw).trim());
    if (!isNaN(value) && value > 0) return value;
  }
  return undefined;
}

// quotaSignals extracts the flat string map from entry.quota.signals.
function quotaSignals(entry: Record<string, unknown>): Record<string, string> {
  const quota = (entry.quota ?? {}) as Record<string, unknown>;
  const signals = quota.signals;
  if (!signals || typeof signals !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(signals as Record<string, unknown>)) {
    out[key] = String(value ?? '');
  }
  return out;
}

interface CooldownInfo {
  remainingSeconds: number;
  reason: string;
  httpStatus?: number;
}

function cooldownInfo(entry: Record<string, unknown>): CooldownInfo | null {
  const cooldowns = Array.isArray(entry.cooldowns) ? (entry.cooldowns as Array<Record<string, unknown>>) : [];
  let best: CooldownInfo | null = null;
  for (const cooldown of cooldowns) {
    const remaining = Number(cooldown.remaining_seconds ?? 0);
    if (remaining <= 0) continue;
    const info: CooldownInfo = {
      remainingSeconds: remaining,
      reason: String(cooldown.reason ?? ''),
      httpStatus: cooldown.http_status != null ? Number(cooldown.http_status) : undefined,
    };
    if (!best || info.remainingSeconds > best.remainingSeconds) best = info;
  }
  return best;
}

// buildWindowFromCodexSignals maps one Codex primary/secondary signal group to a window.
function buildWindowFromCodexSignals(
  signals: Record<string, string>,
  prefix: 'X-Codex-Primary' | 'X-Codex-Secondary',
): ParsedQuotaWindow | null {
  const usedPercent = parseSignalNumber(signals, `${prefix}-Used-Percent`);
  if (usedPercent == null) return null;
  const windowMinutes = parseSignalNumber(signals, `${prefix}-Window-Minutes`);
  const resetAfter = parseSignalEpoch(signals, `${prefix}-Reset-After-Seconds`);
  const resetAt = parseSignalEpoch(signals, `${prefix}-Reset-At`);

  let resetInSeconds = resetAfter;
  if (resetInSeconds == null && resetAt != null) {
    const nowSec = Math.floor(Date.now() / 1000);
    if (resetAt > nowSec) resetInSeconds = resetAt - nowSec;
  }

  const remainingPercent = Math.min(100, Math.max(0, Math.round(100 - usedPercent)));
  return {
    label: windowLabelForMinutes(windowMinutes),
    remainingPercent,
    known: true,
    resetInSeconds,
    resetIn: resetInSeconds != null && resetInSeconds > 0 ? formatCountdown(resetInSeconds) : undefined,
    statusColor: getStatusColor(remainingPercent),
  };
}

// buildWindowsFromGenericSignals covers Devin-style `*_quota_remaining_percent` signals
// plus any other `X-*-Used-Percent`/`Window-Minutes` pairs other providers may emit.
function buildWindowsFromGenericSignals(signals: Record<string, string>): ParsedQuotaWindow[] {
  const windows: ParsedQuotaWindow[] = [];

  // Devin-style remaining-percentage signals.
  const genericPairs: Array<{ label: string; percentKey: string; resetKey: string }> = [
    { label: 'Daily', percentKey: 'daily_quota_remaining_percent', resetKey: 'daily_quota_reset_at' },
    { label: 'Weekly', percentKey: 'weekly_quota_remaining_percent', resetKey: 'weekly_quota_reset_at' },
    { label: 'Monthly', percentKey: 'monthly_quota_remaining_percent', resetKey: 'monthly_quota_reset_at' },
  ];
  for (const pair of genericPairs) {
    const remaining = parseSignalNumber(signals, pair.percentKey);
    if (remaining == null) continue;
    const percent = Math.min(100, Math.max(0, Math.round(remaining)));
    let resetInSeconds: number | undefined;
    const resetRaw = signals[pair.resetKey];
    if (resetRaw) {
      const ts = Date.parse(resetRaw);
      if (!isNaN(ts)) {
        const diff = Math.floor((ts - Date.now()) / 1000);
        if (diff > 0) resetInSeconds = diff;
      }
    }
    windows.push({
      label: pair.label,
      remainingPercent: percent,
      known: true,
      resetInSeconds,
      resetIn: resetInSeconds ? formatCountdown(resetInSeconds) : undefined,
      statusColor: getStatusColor(percent),
    });
  }

  // Generic `X-*-Used-Percent` + `X-*-Window-Minutes` header pairs (any prefix).
  const usedKeys = Object.keys(signals).filter((key) => key.endsWith('-Used-Percent'));
  for (const usedKey of usedKeys) {
    const prefix = usedKey.slice(0, -'-Used-Percent'.length);
    if (prefix === 'X-Codex-Primary' || prefix === 'X-Codex-Secondary') continue;
    const usedPercent = parseSignalNumber(signals, usedKey);
    if (usedPercent == null) continue;
    const windowMinutes = parseSignalNumber(signals, `${prefix}-Window-Minutes`);
    const resetAfter = parseSignalEpoch(signals, `${prefix}-Reset-After-Seconds`);
    const remainingPercent = Math.min(100, Math.max(0, Math.round(100 - usedPercent)));
    windows.push({
      label: windowLabelForMinutes(windowMinutes),
      remainingPercent,
      known: true,
      resetInSeconds: resetAfter,
      resetIn: resetAfter ? formatCountdown(resetAfter) : undefined,
      statusColor: getStatusColor(remainingPercent),
    });
  }

  return windows;
}

function unknownWindow(label: string): ParsedQuotaWindow {
  return { label, remainingPercent: 0, known: false, statusColor: 'unknown' };
}

// parseCredentialSummary extracts multi-window quotas, plans, and health states from AuthFileEntry.
export function parseCredentialSummary(entry: Record<string, unknown>): CredentialSummary {
  const provider = String(entry.provider || entry.type || '').toLowerCase();
  const disabled = Boolean(entry.disabled);
  const unavailable = Boolean(entry.unavailable);
  const status = String(entry.status || '').toLowerCase();
  const statusMsg = String(entry.status_message || '').toLowerCase();
  const success = Number(entry.success || 0);
  const failed = Number(entry.failed || 0);
  const totalRequests = success + failed;
  const successRate = totalRequests > 0 ? Math.round((success / totalRequests) * 1000) / 10 : 100;

  const signals = quotaSignals(entry);
  const activeCooldown = cooldownInfo(entry);
  const cooldownSeconds = activeCooldown?.remainingSeconds ?? 0;
  const quotaObj = (entry.quota ?? {}) as Record<string, unknown>;

  // 1. Plan detection — prefer real upstream-reported plan over name heuristics.
  let plan = '';
  const rawPlanProp = String(entry.plan || '').trim();
  const rawAccountType = String(entry.account_type || '').trim();
  if (rawPlanProp && rawPlanProp.toLowerCase() !== 'free') {
    plan = rawPlanProp;
  } else if (rawAccountType && rawAccountType.toLowerCase() !== 'free') {
    plan = rawAccountType;
  }

  if (!plan) {
    const planSignal = String(
      signals['X-Codex-Plan-Type'] || signals['plan'] || signals['X-Plan-Type'] || '',
    ).toLowerCase();
    const accountType = rawAccountType.toLowerCase();
    const subscription = quotaObj.subscription as { plan?: string; tierName?: string } | undefined;
    const planInSub = String(subscription?.plan || subscription?.tierName || '').toLowerCase();
    const nameStr = String(entry.name || '').toLowerCase();
    const idToken = entry.id_token as Record<string, unknown> | undefined;
    const planInIdToken = idTokenPlan(idToken);
    const rawMetaPlan = rawPlanProp.toLowerCase();

    const planHints = [planSignal, accountType, planInSub, rawMetaPlan, planInIdToken];
    for (const hint of planHints) {
      if (!hint) continue;
      if (hint.includes('google ai pro') || hint.includes('g1-pro')) plan = 'Google AI Pro';
      else if (hint.includes('google ai ultra') || hint.includes('g1-ultra')) plan = 'Google AI Ultra';
      else if (hint.includes('kimi code')) plan = 'Kimi Code';
      else if (hint.includes('kimi ai')) plan = 'Kimi AI';
      else if (hint.includes('supergrok')) plan = 'SuperGrok';
      else if (hint.includes('muse code')) plan = 'Muse Code';
      else if (hint.includes('claude pro')) plan = 'Claude Pro';
      else if (hint.includes('claude team')) plan = 'Claude Team';
      else if (hint.includes('chatgpt plus')) plan = 'ChatGPT Plus';
      else if (hint.includes('chatgpt team')) plan = 'ChatGPT Team';
      else if (hint.includes('chatgpt pro')) plan = 'ChatGPT Pro';
      else if (hint.includes('team')) plan = 'Team';
      else if (hint.includes('enterprise')) plan = 'Enterprise';
      else if (hint.includes('ultra')) plan = 'Ultra';
      else if (hint.includes('plus')) plan = 'Plus';
      else if (hint.includes('super')) plan = 'SuperGrok';
      else if (hint.includes('pro') && !hint.includes('provider')) plan = 'Pro';
      else if (hint.includes('free') || hint.includes('lite')) plan = 'Free';
      if (plan) break;
    }
  }

  const planKnown = plan !== '' && plan.toLowerCase() !== 'free';
  if (!plan) {
    const nameStr = String(entry.name || '').toLowerCase();
    if (nameStr.includes('google-ai-pro') || nameStr.includes('g1-pro')) plan = 'Google AI Pro';
    else if (nameStr.includes('kimi-ai')) plan = 'Kimi AI';
    else if (nameStr.includes('kimi')) plan = 'Kimi Code';
    else if (nameStr.includes('supergrok') || nameStr.includes('grok')) plan = 'SuperGrok';
    else if (nameStr.includes('team')) plan = 'Team';
    else if (nameStr.includes('plus')) plan = 'Plus';
    else if (nameStr.includes('pro')) plan = 'Pro';
    else if (provider === 'kimi') plan = 'Kimi Code';
    else if (provider === 'kimi-ai') plan = 'Kimi AI';
    else if (provider === 'xai') plan = 'SuperGrok';
    else if (provider === 'meta') plan = 'Muse Code';
    else if (provider === 'gemini') plan = 'Google AI Studio';
    else plan = 'Free';
  }

  // 2. Operational state.
  let operationalState: 'normal' | 'cooldown' | 'reauth' | 'exhausted' = 'normal';
  if (
    status === 'error' ||
    unavailable ||
    statusMsg.includes('reauth') ||
    statusMsg.includes('401') ||
    statusMsg.includes('403') ||
    statusMsg.includes('unauthorized') ||
    statusMsg.includes('expired')
  ) {
    operationalState = 'reauth';
  } else if (cooldownSeconds > 0) {
    operationalState = 'cooldown';
  }

  // 3. Multi-group quota parsing (e.g. Antigravity "Gemini" + "Claude & GPT").
  const parsedGroups: ParsedQuotaGroup[] = [];
  const rawGroups = Array.isArray(quotaObj.groups) ? quotaObj.groups : [];
  for (const rg of rawGroups as Array<Record<string, unknown>>) {
    const gName = String(rg.displayName || rg.name || '').trim();
    const gWindows: ParsedQuotaWindow[] = [];
    const buckets = Array.isArray(rg.buckets) ? rg.buckets : [];
    for (const b of buckets as Array<Record<string, unknown>>) {
      const label = String(b.window || b.label || 'Window');
      let remPercent = 0;
      if (typeof b.remainingFraction === 'number') {
        remPercent = Math.min(100, Math.max(0, Math.round(b.remainingFraction * 1000) / 10));
      } else if (typeof b.remaining === 'number') {
        remPercent = Math.min(100, Math.max(0, Math.round(b.remaining)));
      }
      const resetTime = String(b.resetTime || b.reset_time || '');
      gWindows.push({
        label,
        remainingPercent: remPercent,
        known: true,
        resetIn: resetTime || undefined,
        statusColor: getStatusColor(remPercent),
      });
    }
    if (gWindows.length > 0) {
      parsedGroups.push({ displayName: gName, windows: gWindows });
    }
  }

  // 4. Windows extraction
  const windows: ParsedQuotaWindow[] = [];
  if (parsedGroups.length > 0) {
    for (const g of parsedGroups) {
      for (const w of g.windows) {
        windows.push(w);
      }
    }
  } else {
    // Signals-based parsing
    const codexPrimary = buildWindowFromCodexSignals(signals, 'X-Codex-Primary');
    const codexSecondary = buildWindowFromCodexSignals(signals, 'X-Codex-Secondary');
    if (codexPrimary) windows.push(codexPrimary);
    if (codexSecondary) windows.push(codexSecondary);
    windows.push(...buildWindowsFromGenericSignals(signals));

    if (windows.length === 0) {
      if (provider === 'antigravity') {
        // Built-in dual groups for Antigravity before first probe
        parsedGroups.push({
          displayName: 'Gemini',
          windows: [unknownWindow('5h'), unknownWindow('7d')],
        });
        parsedGroups.push({
          displayName: 'Claude & GPT',
          windows: [unknownWindow('5h'), unknownWindow('7d')],
        });
        for (const g of parsedGroups) {
          for (const w of g.windows) {
            windows.push(w);
          }
        }
      } else if (provider === 'devin') {
        windows.push(unknownWindow('Daily'), unknownWindow('Weekly'));
      } else if (ROLLING_WINDOW_PROVIDERS.has(provider)) {
        windows.push(unknownWindow('5h'), unknownWindow('7d'));
      } else {
        windows.push(unknownWindow('Monthly'));
      }
    }
  }

  // Cooldown overlay
  if (cooldownSeconds > 0 && operationalState === 'cooldown' && windows.length > 0) {
    const shortest = windows.reduce(
      (min, w) => ((w.resetInSeconds ?? Infinity) < (min.resetInSeconds ?? Infinity) ? w : min),
      windows[0],
    );
    shortest.remainingPercent = 0;
    shortest.known = true;
    shortest.statusColor = 'red';
    shortest.resetInSeconds = cooldownSeconds;
    shortest.resetIn = formatCountdown(cooldownSeconds);
  }

  const isAnyExhausted = windows.some((w) => w.known && w.remainingPercent === 0);
  if (isAnyExhausted && operationalState === 'normal') {
    operationalState = 'exhausted';
  }

  // Tokens & cost estimation.
  const totalTokens = success * 3500;
  const totalCost = totalRequests * 0.005;

  const isNormallyAvailable =
    !disabled && !unavailable && status === 'active' && cooldownSeconds === 0 && operationalState === 'normal';
  const needsAttention = !disabled && (operationalState === 'reauth' || unavailable || status === 'error');
  const hasQuotaRisk =
    !disabled &&
    (operationalState === 'cooldown' ||
      operationalState === 'exhausted' ||
      windows.some((w) => w.known && w.remainingPercent <= 20));
  const isUnconfirmed = !disabled && totalRequests === 0 && !needsAttention && cooldownSeconds === 0;

  return {
    plan,
    planKnown,
    operationalState,
    windows,
    groups: parsedGroups,
    successRate,
    totalRequests,
    totalTokensFormatted: formatNumberCompact(totalTokens),
    estimatedCostFormatted: formatCost(totalCost),
    isNormallyAvailable,
    needsAttention,
    hasQuotaRisk,
    isUnconfirmed,
  };
}

function idTokenPlan(idToken: Record<string, unknown> | undefined): string {
  const chatgpt = idToken?.['https://api.openai.com/auth'] as Record<string, unknown> | undefined;
  const plan = (chatgpt?.chatgpt_plan_type ?? chatgpt?.chatgpt_account_type) as string | undefined;
  return (plan ?? '').toLowerCase();
}
