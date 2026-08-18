import { RefreshCw, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { describeError } from '../../lib/describeError';
import { cx } from '../../lib/cx';
import { Button } from './Button';

/**
 * Empty and error states, so every panel presents the same shape when it has
 * nothing to show. Both are deliberately quiet: an icon, a sentence, and the one
 * action that resolves the situation.
 */

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cx('flex flex-col items-center px-6 py-12 text-center', className)}>
      <span className="mb-4 flex size-10 items-center justify-center rounded-lg border border-line bg-surface-sunken">
        <Icon aria-hidden className="size-5 text-ink-muted" strokeWidth={1.75} />
      </span>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description ? (
        <p className="mt-1 max-w-md text-sm text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ error, onRetry, className }: ErrorStateProps) {
  const { title, message, retryable } = describeError(error);

  return (
    <div
      role="alert"
      className={cx('flex flex-col items-center px-6 py-12 text-center', className)}
    >
      <span className="mb-4 flex size-10 items-center justify-center rounded-lg border border-critical-line bg-critical-surface">
        <TriangleIcon />
      </span>
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 max-w-md text-sm text-ink-muted">{message}</p>
      {onRetry && retryable ? (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw aria-hidden className="size-4" />
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Inline so the error surface does not import two icons for one glyph. */
function TriangleIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5 text-critical"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}
