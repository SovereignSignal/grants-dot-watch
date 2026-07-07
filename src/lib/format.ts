import type { Wire } from './types';

export function money(n: number | null | undefined, text?: string | null): string {
  if (n == null || n === 0) return text || '—';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

export function dateShort(d: string | null | undefined): string {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (!m) return y;
  return day ? `${months[+m - 1]} ${+day}, ${y}` : `${months[+m - 1]} ${y}`;
}

export const WIRE_LABEL: Record<Wire, string> = { crypto: 'Crypto', ai: 'AI', oss: 'Open Source' };
export const WIRE_COLOR: Record<Wire, string> = {
  crypto: 'var(--color-crypto)',
  ai: 'var(--color-ai)',
  oss: 'var(--color-oss)',
};

export const ROUND_STATUS_LABEL: Record<string, string> = {
  announced: 'Announced',
  open: 'Open',
  reviewing: 'In review',
  closed: 'Closed',
  deployed: 'Deployed',
};
