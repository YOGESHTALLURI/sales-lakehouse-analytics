import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

/**
 * List state — filters, page size, offset — kept in the URL.
 *
 * Deep-linking a filtered page and having the back button undo a filter both fall
 * out of this for free, and it is why the workspace carries a router at all
 * rather than local `useState` per page.
 */

export interface QueryState {
  get(key: string): string | null;
  getNumber(key: string, fallback: number): number;
  /** Merge updates; `undefined` and `''` remove the parameter entirely. */
  set(updates: Readonly<Record<string, string | number | undefined>>): void;
}

export function useQueryState(): QueryState {
  const [params, setParams] = useSearchParams();

  const set = useCallback(
    (updates: Readonly<Record<string, string | number | undefined>>) => {
      const next = new URLSearchParams(params);

      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, String(value));
      }

      setParams(next);
    },
    [params, setParams],
  );

  return useMemo<QueryState>(
    () => ({
      get: (key) => params.get(key),
      getNumber: (key, fallback) => {
        const raw = params.get(key);
        if (raw === null) return fallback;
        const value = Number(raw);
        return Number.isFinite(value) && value >= 0 ? value : fallback;
      },
      set,
    }),
    [params, set],
  );
}
