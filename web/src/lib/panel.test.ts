import { describe, expect, it } from 'vitest';
import { healthIssues, maskKey, mergeRequestBuckets, parseLogLevel, pickFirstClientKey } from './panel';

describe('maskKey', () => {
  it('masks long keys keeping head and tail', () => {
    expect(maskKey('sk-abcdef1234567890')).toBe('sk-abc****7890');
  });
  it('masks short keys beyond a minimal prefix', () => {
    expect(maskKey('short')).toBe('sh****');
  });
});

describe('parseLogLevel', () => {
  it('parses logrus text levels', () => {
    expect(parseLogLevel('[2026-10-30 03:17:27] [--------] [info ] [main.go:1] x')).toBe('info');
    expect(parseLogLevel('[----] [warning] [updater.go:2] failed')).toBe('warning');
    expect(parseLogLevel('[-] [error ] [x] boom')).toBe('error');
    expect(parseLogLevel('[-] [debug] x')).toBe('debug');
  });
  it('normalizes warn to warning', () => {
    expect(parseLogLevel('[warn] x')).toBe('warning');
  });
  it('defaults to info for untagged lines', () => {
    expect(parseLogLevel('plain text line')).toBe('info');
  });
});

describe('mergeRequestBuckets', () => {
  const files = [
    { provider: 'codex', recent_requests: [{ time: '10:00', success: 2, failed: 1 }, { time: '10:05', success: 1, failed: 0 }] },
    { provider: 'codex', recent_requests: [{ time: '10:00', success: 1, failed: 0 }] },
    { provider: 'claude', recent_requests: [{ time: '10:00', success: 0, failed: 3 }] },
  ];

  it('merges globally by bucket time and sorts', () => {
    const [{ key, buckets }] = mergeRequestBuckets(files, false);
    expect(key).toBe('');
    expect(buckets).toEqual([
      { time: '10:00', success: 3, failed: 4 },
      { time: '10:05', success: 1, failed: 0 },
    ]);
  });

  it('groups by provider when requested', () => {
    const groups = mergeRequestBuckets(files, true);
    expect(groups).toHaveLength(2);
    const codex = groups.find((g) => g.key === 'codex');
    expect(codex?.buckets).toEqual([
      { time: '10:00', success: 3, failed: 1 },
      { time: '10:05', success: 1, failed: 0 },
    ]);
    const claude = groups.find((g) => g.key === 'claude');
    expect(claude?.buckets).toEqual([{ time: '10:00', success: 0, failed: 3 }]);
  });

  it('handles empty input', () => {
    expect(mergeRequestBuckets([], false)).toEqual([{ key: '', buckets: [] }]);
  });
});

describe('pickFirstClientKey', () => {
  it('returns the first non-empty key', () => {
    expect(pickFirstClientKey(['', 'sk-b', 'sk-c'])).toBe('sk-b');
  });
  it('returns empty for missing keys', () => {
    expect(pickFirstClientKey(undefined)).toBe('');
    expect(pickFirstClientKey([])).toBe('');
    expect(pickFirstClientKey([''])).toBe('');
  });
});

describe('healthIssues', () => {
  const labels = { disabled: 'disabled', error: 'error' };
  it('flags disabled and error credentials', () => {
    const issues = healthIssues(
      [
        { name: 'a.json', provider: 'codex', disabled: true, status_message: 'off' },
        { name: 'b.json', provider: 'codex', unavailable: true, status: 'error', status_message: 'token expired' },
        { name: 'c.json', provider: 'codex', status: 'active' },
      ],
      labels,
    );
    expect(issues).toEqual([
      { name: 'a.json', provider: 'codex', reason: 'off', disabled: true },
      { name: 'b.json', provider: 'codex', reason: 'token expired', disabled: false },
    ]);
  });
  it('falls back to label reasons', () => {
    expect(healthIssues([{ name: 'x.json', provider: 'codex', unavailable: true }], labels)).toEqual([
      { name: 'x.json', provider: 'codex', reason: 'error', disabled: false },
    ]);
  });
});
