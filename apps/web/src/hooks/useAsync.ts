import { type DependencyList, useCallback, useEffect, useState } from 'react';
import { isAbortError } from '../api/http';

/**
 * One request, its lifecycle, and nothing else.
 *
 * This is the whole reason the workspace carries no data-fetching library: what
 * a page needs is a status, the last good data, an abort on unmount and a way to
 * refetch. Previous data is kept while a refetch is in flight so a filter change
 * updates the numbers without collapsing the layout first.
 */

export type AsyncStatus = 'loading' | 'success' | 'error';

export interface AsyncResult<T> {
  readonly status: AsyncStatus;
  readonly data: T | undefined;
  readonly error: unknown;
  /** True while refetching with data already on screen. */
  readonly isRefreshing: boolean;
  readonly refresh: () => void;
}

interface State<T> {
  status: AsyncStatus;
  data: T | undefined;
  error: unknown;
}

/**
 * `deps` is the request identity, exactly as with `useMemo`: list every value the
 * loader reads. The loader itself is intentionally not a dependency, so an inline
 * arrow function does not restart the request on every render.
 */
export function useAsync<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
): AsyncResult<T> {
  const [state, setState] = useState<State<T>>({
    status: 'loading',
    data: undefined,
    error: undefined,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;

    setState((previous) => ({ status: 'loading', data: previous.data, error: undefined }));

    load(controller.signal).then(
      (data) => {
        if (live) setState({ status: 'success', data, error: undefined });
      },
      (error: unknown) => {
        // An abort is this effect being cleaned up, not a failure to report.
        if (live && !isAbortError(error)) {
          setState((previous) => ({ status: 'error', data: previous.data, error }));
        }
      },
    );

    return () => {
      live = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  return {
    status: state.status,
    data: state.data,
    error: state.error,
    isRefreshing: state.status === 'loading' && state.data !== undefined,
    refresh,
  };
}
