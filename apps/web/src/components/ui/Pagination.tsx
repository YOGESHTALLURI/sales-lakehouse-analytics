import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatCount } from '../../lib/format';
import { BareSelect } from './Field';
import { Button } from './Button';

/**
 * Offset pagination over a `{ limit, offset, total }` envelope.
 *
 * The page count comes from the API's `total`, never from the number of rows on
 * screen — with 10,001 orders the difference is the entire feature.
 */

const PAGE_SIZES = [25, 50, 100, 200] as const;

const PAGE_SIZE_OPTIONS = PAGE_SIZES.map((size) => ({
  value: String(size),
  label: `${size} per page`,
}));

export interface PaginationProps {
  limit: number;
  offset: number;
  total: number;
  /** What the rows are, for the summary line: "orders", "customers". */
  noun: string;
  onOffsetChange: (offset: number) => void;
  onLimitChange: (limit: number) => void;
  disabled?: boolean;
}

export function Pagination({
  limit,
  offset,
  total,
  noun,
  onOffsetChange,
  onLimitChange,
  disabled = false,
}: PaginationProps) {
  const first = total === 0 ? 0 : offset + 1;
  const last = Math.min(offset + limit, total);
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="text-sm text-ink-muted" data-numeric>
        Showing <span className="font-medium text-ink-soft">{formatCount(first)}</span>–
        <span className="font-medium text-ink-soft">{formatCount(last)}</span> of{' '}
        <span className="font-medium text-ink-soft">{formatCount(total)}</span> {noun}
      </p>

      <div className="flex items-center gap-2">
        <BareSelect
          label="Rows per page"
          className="h-9 w-auto"
          value={String(limit)}
          disabled={disabled}
          options={PAGE_SIZE_OPTIONS}
          onChange={(event) => onLimitChange(Number(event.target.value))}
        />

        <span className="px-2 text-sm text-ink-muted" data-numeric>
          Page {formatCount(page)} of {formatCount(pages)}
        </span>

        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || offset === 0}
          onClick={() => onOffsetChange(Math.max(0, offset - limit))}
        >
          <ChevronLeft aria-hidden className="size-4" />
          Previous
        </Button>

        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || last >= total}
          onClick={() => onOffsetChange(offset + limit)}
        >
          Next
          <ChevronRight aria-hidden className="size-4" />
        </Button>
      </div>
    </div>
  );
}
