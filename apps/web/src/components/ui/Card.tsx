import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';

/** The one card surface: white, hairline border, rounded-xl, restrained shadow. */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={cx('rounded-xl border border-line bg-surface shadow-card', className)}
    >
      {children}
    </section>
  );
}

export interface CardHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Cards inside a page section are h3; a card that *is* the section is h2. */
  level?: 2 | 3;
  divided?: boolean;
}

export function CardHeader({
  title,
  description,
  actions,
  level = 2,
  divided = false,
}: CardHeaderProps) {
  const Heading = level === 2 ? 'h2' : 'h3';

  return (
    <div
      className={cx(
        'flex flex-wrap items-start justify-between gap-4 px-6 py-4',
        divided && 'border-b border-line',
      )}
    >
      <div className="min-w-0">
        <Heading className="text-base font-semibold text-ink">{title}</Heading>
        {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('px-6 pb-6', className)}>{children}</div>;
}

export function CardFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx('border-t border-line px-6 py-4', className)}>{children}</div>
  );
}
