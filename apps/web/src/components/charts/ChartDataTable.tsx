import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { TBody, TableFrame, Td, Th, THead, Tr } from '../ui/Table';

/**
 * The numbers behind a chart, collapsed by default.
 *
 * An SVG conveys nothing to a screen reader, so every chart in this app is
 * paired with its underlying figures in a real table. Keeping it in a
 * `<details>` means sighted users are not shown the same data twice while
 * assistive technology can still reach all of it — and `<details>` is keyboard
 * operable with no JavaScript.
 */

export interface ChartDataColumn<T> {
  readonly key: string;
  readonly header: string;
  readonly align?: 'left' | 'right';
  readonly cell: (row: T) => ReactNode;
}

export interface ChartDataTableProps<T> {
  caption: string;
  rows: readonly T[];
  columns: readonly ChartDataColumn<T>[];
  rowKey: (row: T) => string;
  /** Long series are truncated in the table; charts still plot every point. */
  maxRows?: number;
}

export function ChartDataTable<T>({
  caption,
  rows,
  columns,
  rowKey,
  maxRows = 60,
}: ChartDataTableProps<T>) {
  const visible = rows.slice(0, maxRows);
  const hidden = rows.length - visible.length;

  return (
    <details className="group border-t border-line">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-6 py-3 text-sm font-medium text-ink-muted hover:text-ink">
        <ChevronRight
          aria-hidden
          className="size-4 transition-transform group-open:rotate-90"
        />
        View data table
      </summary>

      <TableFrame className="border-t border-line">
        <caption className="sr-only">{caption}</caption>
        <THead>
          <tr>
            {columns.map((column) => (
              <Th key={column.key} align={column.align ?? 'left'}>
                {column.header}
              </Th>
            ))}
          </tr>
        </THead>
        <TBody>
          {visible.map((row) => (
            <Tr key={rowKey(row)}>
              {columns.map((column) => (
                <Td key={column.key} align={column.align ?? 'left'}>
                  {column.cell(row)}
                </Td>
              ))}
            </Tr>
          ))}
        </TBody>
      </TableFrame>

      {hidden > 0 ? (
        <p className="px-6 py-3 text-xs text-ink-faint">
          Showing the first {visible.length} of {rows.length} rows. The chart plots all of them.
        </p>
      ) : null}
    </details>
  );
}
