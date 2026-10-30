// Pure helpers shared by panel pages, kept framework-free for unit testing.

// maskKey shortens an API key for display so full values are not on screen.
export function maskKey(k: string): string {
  if (k.length <= 10) return k.slice(0, 2) + '****';
  return k.slice(0, 6) + '****' + k.slice(-4);
}

// parseLogLevel extracts the level from a logrus text-format line.
export function parseLogLevel(line: string): 'error' | 'warning' | 'info' | 'debug' {
  const m = line.match(/\[\s*(error|warning|warn|info|debug)\s*\]/i);
  const lv = m ? m[1].toLowerCase() : 'info';
  if (lv === 'warn') return 'warning';
  if (lv === 'warning') return 'warning';
  if (lv === 'error') return 'error';
  if (lv === 'debug') return 'debug';
  return 'info';
}

export interface RequestBucket {
  time: string;
  success: number;
  failed: number;
}

export interface AuthFileUsageLite {
  provider: string;
  recent_requests?: RequestBucket[];
}

// mergeRequestBuckets sums per-credential request buckets either globally or
// grouped by provider, keyed by bucket time label.
export function mergeRequestBuckets(
  files: AuthFileUsageLite[],
  perProvider: boolean,
): Array<{ key: string; buckets: RequestBucket[] }> {
  if (perProvider) {
    const byProvider: Record<string, RequestBucket[]> = {};
    for (const f of files) {
      const p = f.provider || 'unknown';
      if (!byProvider[p]) byProvider[p] = [];
      for (const b of f.recent_requests ?? []) {
        const buckets = byProvider[p];
        const existing = buckets.find((x) => x.time === b.time);
        if (existing) {
          existing.success += b.success;
          existing.failed += b.failed;
        } else {
          buckets.push({ time: b.time, success: b.success, failed: b.failed });
        }
      }
    }
    return Object.entries(byProvider).map(([key, buckets]) => ({ key, buckets }));
  }
  const merged: RequestBucket[] = [];
  for (const f of files) {
    for (const b of f.recent_requests ?? []) {
      const existing = merged.find((x) => x.time === b.time);
      if (existing) {
        existing.success += b.success;
        existing.failed += b.failed;
      } else {
        merged.push({ time: b.time, success: b.success, failed: b.failed });
      }
    }
  }
  merged.sort((a, b) => a.time.localeCompare(b.time));
  return [{ key: '', buckets: merged }];
}

// pickFirstClientKey returns the first usable client access key.
export function pickFirstClientKey(keys?: string[]): string {
  return (keys ?? []).find((k) => k.trim() !== '') ?? '';
}

// healthIssues collects credentials that cannot currently serve traffic.
export interface HealthIssue {
  name: string;
  provider: string;
  reason: string;
  disabled: boolean;
}

export function healthIssues(
  files: Array<{ name: string; provider?: string; type?: string; disabled?: boolean; unavailable?: boolean; status?: string; status_message?: string }>,
  labels: { disabled: string; error: string },
): HealthIssue[] {
  const out: HealthIssue[] = [];
  for (const file of files) {
    const p = file.provider || file.type || 'unknown';
    if (file.disabled) {
      out.push({ name: file.name, provider: p, reason: file.status_message ?? labels.disabled, disabled: true });
    } else if (file.unavailable || file.status === 'error') {
      out.push({ name: file.name, provider: p, reason: file.status_message ?? labels.error, disabled: false });
    }
  }
  return out;
}
