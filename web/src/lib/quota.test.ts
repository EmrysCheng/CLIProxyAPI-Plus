import { describe, expect, it } from 'vitest';
import {
  formatCost,
  formatCountdown,
  formatNumberCompact,
  maskEmail,
  parseCredentialSummary,
} from './quota';

describe('maskEmail', () => {
  it('masks standard email addresses properly', () => {
    expect(maskEmail('sean.miller@gmail.com', true)).toBe('sea***@gmail.com');
    expect(maskEmail('hi@domain.com', true)).toBe('h***@domain.com');
  });

  it('keeps email unmasked when flag is false', () => {
    expect(maskEmail('sean.miller@gmail.com', false)).toBe('sean.miller@gmail.com');
  });

  it('handles non-email identifiers', () => {
    expect(maskEmail('my-codex-account', true)).toBe('my-***unt');
    expect(maskEmail('', true)).toBe('—');
  });
});

describe('formatCountdown', () => {
  it('formats seconds into intuitive intervals', () => {
    expect(formatCountdown(0)).toBe('now');
    expect(formatCountdown(45)).toBe('in 45s');
    expect(formatCountdown(120)).toBe('in 2m');
    expect(formatCountdown(3600)).toBe('in 1h');
    expect(formatCountdown(3900)).toBe('in 1h 5m');
    expect(formatCountdown(86400 * 3)).toBe('in 3d');
  });
});

describe('formatNumberCompact', () => {
  it('formats thousands, millions, and billions', () => {
    expect(formatNumberCompact(500)).toBe('500');
    expect(formatNumberCompact(1500)).toBe('1.5K');
    expect(formatNumberCompact(52900000)).toBe('52.9M');
    expect(formatNumberCompact(3200000000)).toBe('3.2B');
  });
});

describe('formatCost', () => {
  it('formats currency values correctly', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(2.25)).toBe('$2.25');
    expect(formatCost(0.004)).toBe('<$0.01');
  });
});

describe('parseCredentialSummary — real Codex signals', () => {
  it('derives 5h + 7d windows from X-Codex-Primary/Secondary signals', () => {
    const summary = parseCredentialSummary({
      provider: 'codex',
      status: 'active',
      disabled: false,
      unavailable: false,
      success: 40,
      failed: 2,
      quota: {
        signals: {
          'X-Codex-Primary-Used-Percent': '42.5',
          'X-Codex-Primary-Window-Minutes': '300',
          'X-Codex-Primary-Reset-After-Seconds': '4800',
          'X-Codex-Secondary-Used-Percent': '63',
          'X-Codex-Secondary-Window-Minutes': '10080',
          'X-Codex-Secondary-Reset-After-Seconds': '518400',
          'X-Codex-Plan-Type': 'plus',
        },
      },
    });

    expect(summary.plan).toBe('Plus');
    expect(summary.planKnown).toBe(true);
    expect(summary.windows).toHaveLength(2);

    const [fiveHour, weekly] = summary.windows;
    expect(fiveHour.label).toBe('5h');
    expect(fiveHour.known).toBe(true);
    expect(fiveHour.remainingPercent).toBe(58); // 100 - 42.5 rounded
    expect(fiveHour.resetIn).toBe('in 1h 20m');

    expect(weekly.label).toBe('7d');
    expect(weekly.remainingPercent).toBe(37); // 100 - 63
    expect(weekly.resetIn).toBe('in 6d');

    expect(summary.isNormallyAvailable).toBe(true);
  });

  it('falls back to rolling window layout without fake percentages when never probed', () => {
    const summary = parseCredentialSummary({
      provider: 'codex',
      name: 'someone@gmail.com.json',
      email: 'someone@gmail.com',
      status: 'active',
      disabled: false,
      unavailable: false,
      success: 0,
      failed: 0,
    });

    // Free Codex accounts are still metered by 5h + weekly windows — both must render.
    expect(summary.windows).toHaveLength(2);
    expect(summary.windows.map((w) => w.label)).toEqual(['5h', '7d']);
    for (const w of summary.windows) {
      expect(w.known).toBe(false);
      expect(w.statusColor).toBe('unknown');
    }
    // No fake risk flags for unprobed credentials.
    expect(summary.hasQuotaRisk).toBe(false);
    expect(summary.isUnconfirmed).toBe(true);
  });
});

describe('parseCredentialSummary — Devin signals', () => {
  it('parses daily/weekly remaining percentages with reset timestamps', () => {
    const resetAt = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    const summary = parseCredentialSummary({
      provider: 'devin',
      status: 'active',
      disabled: false,
      success: 5,
      failed: 0,
      quota: {
        signals: {
          plan: 'team',
          daily_quota_remaining_percent: '45%',
          daily_quota_reset_at: resetAt,
          weekly_quota_remaining_percent: '80%',
        },
      },
    });

    expect(summary.plan).toBe('Team');
    const labels = summary.windows.map((w) => w.label);
    expect(labels).toContain('Daily');
    expect(labels).toContain('Weekly');
    const daily = summary.windows.find((w) => w.label === 'Daily')!;
    expect(daily.remainingPercent).toBe(45);
    expect(daily.known).toBe(true);
    expect(daily.resetInSeconds).toBeGreaterThanOrEqual(7100);
    expect(daily.resetInSeconds).toBeLessThanOrEqual(7200);
  });
});

describe('parseCredentialSummary — cooldown overlay', () => {
  it('drains the nearest window and carries the real cooldown countdown', () => {
    const summary = parseCredentialSummary({
      provider: 'claude',
      status: 'active',
      disabled: false,
      success: 30,
      failed: 5,
      quota: {
        signals: {
          'X-Codex-Primary-Used-Percent': '20', // not claude's, but generic parser picks it up
          'X-Codex-Primary-Window-Minutes': '300',
          'X-Codex-Primary-Reset-After-Seconds': '600',
        },
      },
      cooldowns: [{ scope: 'credential', reason: '5h limit reached', remaining_seconds: 5400 }],
    });

    expect(summary.operationalState).toBe('cooldown');
    const drained = summary.windows.find((w) => w.remainingPercent === 0);
    expect(drained).toBeDefined();
    expect(drained!.resetIn).toBe('in 1h 30m');
    expect(drained!.statusColor).toBe('red');
    expect(summary.hasQuotaRisk).toBe(true);
  });
});

describe('parseCredentialSummary — health states', () => {
  it('flags reauth requirements for 401 error states', () => {
    const summary = parseCredentialSummary({
      provider: 'claude',
      status: 'error',
      status_message: 'HTTP 401 unauthorized: reauth required',
      disabled: false,
      unavailable: true,
    });

    expect(summary.operationalState).toBe('reauth');
    expect(summary.needsAttention).toBe(true);
    expect(summary.isNormallyAvailable).toBe(false);
  });

  it('shows a single monthly window only for unknown providers', () => {
    const summary = parseCredentialSummary({
      provider: 'custom-openai-compatible',
      status: 'active',
      disabled: false,
      success: 3,
      failed: 0,
    });
    expect(summary.windows.map((w) => w.label)).toEqual(['Monthly']);
  });

  it('correctly parses Antigravity Google AI Pro with Gemini and Claude & GPT multi-groups', () => {
    const summary = parseCredentialSummary({
      provider: 'antigravity',
      account_type: 'Google AI Pro',
      status: 'active',
      disabled: false,
      success: 10,
      failed: 0,
      quota: {
        subscription: {
          plan: 'Google AI Pro',
          tierName: 'Google AI Pro',
          tierId: 'g1-pro-tier',
        },
        groups: [
          {
            displayName: 'Gemini',
            buckets: [
              { window: '5h', remainingFraction: 0.993, resetTime: 'in 3h 15m' },
              { window: '7d', remainingFraction: 0.715, resetTime: 'in 6d' },
            ],
          },
          {
            displayName: 'Claude & GPT',
            buckets: [
              { window: '5h', remainingFraction: 1.0, resetTime: 'in 5h' },
              { window: '7d', remainingFraction: 1.0, resetTime: 'in 7d' },
            ],
          },
        ],
      },
    });

    expect(summary.plan).toBe('Google AI Pro');
    expect(summary.planKnown).toBe(true);
    expect(summary.groups).toHaveLength(2);

    const gemini = summary.groups.find((g) => g.displayName === 'Gemini')!;
    expect(gemini.windows).toHaveLength(2);
    expect(gemini.windows[0].label).toBe('5h');
    expect(gemini.windows[0].remainingPercent).toBe(99.3);
    expect(gemini.windows[1].label).toBe('7d');
    expect(gemini.windows[1].remainingPercent).toBe(71.5);

    const claude = summary.groups.find((g) => g.displayName === 'Claude & GPT')!;
    expect(claude.windows).toHaveLength(2);
    expect(claude.windows[0].label).toBe('5h');
    expect(claude.windows[0].remainingPercent).toBe(100);
    expect(claude.windows[1].label).toBe('7d');
    expect(claude.windows[1].remainingPercent).toBe(100);
  });
});
