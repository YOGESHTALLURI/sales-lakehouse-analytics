import type { ReactNode, ThHTMLAttributes } from 'react';
import { cx } from '../../lib/cx';

/**
 * Table primitives, so column padding, alignment and row separators are decided
 * once. Wide tables scroll inside their own container rather than pushing the
 * page sideways.
 */

export function TableFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="w-full min-w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

/** Visually hidden caption, so a screen reader gets the table's purpose. */
export function TableCaption({ children }: { children: ReactNode }) {
  return <caption className="sr-only">{children}</caption>;
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-y border-line bg-surface-sunken/60 text-xs uppercase tracking-wide text-ink-muted">
      {children}
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-line">{children}</tbody>;
}

export type Align = 'left' | 'right' | 'center';

const ALIGN: Readonly<Record<Align, string>> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

export interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  align?: Align;
  children?: ReactNode;
}

export function Th({ align = 'left', className, children, ...rest }: ThProps) {
  return (
    <th
      scope="col"
      className={cx('px-4 py-2.5 font-medium', ALIGN[align], className)}
      {...rest}
    >
      {children}
    </th>
  );
}

export interface TdProps {
  align?: Align;
  className?: string;
  colSpan?: number;
  children?: ReactNode;
}

export function Td({ align = 'left', className, colSpan, children }: TdProps) {
  return (
    <td className={cx('px-4 py-3 text-ink-soft', ALIGN[align], className)} colSpan={colSpan}>
      {children}
    </td>
  );
}

/** A row header cell — the first cell of a row, naming what the row is about. */
export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cx('hover:bg-surface-hover', className)}>{children}</tr>;
}
