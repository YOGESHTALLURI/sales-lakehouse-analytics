import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';

export type BadgeTone = 'neutral' | 'brand' | 'positive' | 'caution' | 'critical';

const TONES: Readonly<Record<BadgeTone, string>> = {
  neutral: 'border-line bg-surface-sunken text-ink-soft',
  brand: 'border-brand-line bg-brand-surface text-brand',
  positive: 'border-positive-line bg-positive-surface text-positive',
  caution: 'border-caution-line bg-caution-surface text-caution',
  critical: 'border-critical-line bg-critical-surface text-critical',
};

const DOTS: Readonly<Record<BadgeTone, string>> = {
  neutral: 'bg-ink-faint',
  brand: 'bg-brand',
  positive: 'bg-positive',
  caution: 'bg-caution',
  critical: 'bg-critical',
};

export interface BadgeProps {
  tone?: BadgeTone;
  /** A status dot carries the same meaning as colour for anyone who cannot see it. */
  dot?: boolean;
  pulse?: boolean;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', dot = false, pulse = false, children }: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium',
        TONES[tone],
      )}
    >
      {dot ? (
        <span
          aria-hidden
          className={cx('size-1.5 rounded-full', DOTS[tone], pulse && 'animate-pulse')}
        />
      ) : null}
      {children}
    </span>
  );
}
