import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';

export type CalloutTone = 'info' | 'positive' | 'caution' | 'critical';

const TONES: Readonly<Record<CalloutTone, string>> = {
  info: 'border-brand-line bg-brand-surface text-brand',
  positive: 'border-positive-line bg-positive-surface text-positive',
  caution: 'border-caution-line bg-caution-surface text-caution',
  critical: 'border-critical-line bg-critical-surface text-critical',
};

const ICONS: Readonly<Record<CalloutTone, LucideIcon>> = {
  info: Info,
  positive: CircleCheck,
  caution: TriangleAlert,
  critical: CircleAlert,
};

export interface CalloutProps {
  tone?: CalloutTone;
  title?: string;
  onDismiss?: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * An inline message attached to the thing it is about.
 *
 * Deliberately not a floating toast: a form's outcome belongs next to the form,
 * where it stays readable and does not disappear before it has been read.
 */
export function Callout({ tone = 'info', title, onDismiss, children, className }: CalloutProps) {
  const Icon = ICONS[tone];

  return (
    <div
      className={cx('flex gap-3 rounded-lg border px-4 py-3', TONES[tone], className)}
      role={tone === 'critical' ? 'alert' : 'status'}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
      <div className="min-w-0 flex-1 text-sm">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={cx('text-ink-soft', title && 'mt-0.5')}>{children}</div>
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="-m-1 h-6 w-6 shrink-0 rounded text-ink-muted hover:bg-surface/60 hover:text-ink"
        >
          <X aria-hidden className="mx-auto size-4" />
          <span className="sr-only">Dismiss</span>
        </button>
      ) : null}
    </div>
  );
}
