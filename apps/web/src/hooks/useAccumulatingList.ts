import { type DependencyList, useCallback, useEffect, useState } from 'react';
import { isAbortError } from '../api/http';
import type { Page } from '../api/types';

/**
 * Load a long list one page at a time, keeping everything loaded so far.
 *
 * The order form needs to choose from 501 customers and 100 products, and the
 * contract has no search parameter on either list — so the picker loads pages and
 * filters what it holds. Requesting the documented maximum of 200 keeps that to a
 * couple of clicks rather than a dozen.
 */

const PAGE_SIZE = 200;

export interface AccumulatingList<T> {
  readonly rows: readonly T[];
  readonly total: number;
  readonly hasMore: boolean;
  readonly loading: boolean;
  readonly error: unknown;
  readonly loadMore: () => void;
}

export function useAccumulatingList<T>(
  fetchPage: (offset: number, limit: number, signal: AbortSignal) => Promise<Page<T>>,
  deps: DependencyList,
): AccumulatingList<T> {
  const [rows, setRows] = useState<readonly T[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(undefined);

  // A filter change invalidates everything accumulated, so the list restarts.
  useEffect(() => {
    setRows([]);
    setTotal(0);
    setOffset(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;

    setLoading(true);
    setError(undefined);

    fetchPage(offset, PAGE_SIZE, controller.signal).then(
      (page) => {
        if (!live) return;
        setLoading(false);
        setTotal(page.pagination.total);
        setRows((previous) => (offset === 0 ? page.data : [...previous, ...page.data]));
      },
      (caught: unknown) => {
        if (!live || isAbortError(caught)) return;
        setLoading(false);
        setError(caught);
      },
    );

    return () => {
      live = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, ...deps]);

  const loadMore = useCallback(() => setOffset((current) => current + PAGE_SIZE), []);

  return {
    rows,
    total,
    hasMore: rows.length < total,
    loading,
    error,
    loadMore,
  };
}
