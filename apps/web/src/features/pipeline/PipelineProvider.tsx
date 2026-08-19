import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../../api/client';
import { isAbortError } from '../../api/http';
import type { PipelineStatus } from '../../api/types';
import { useAsync } from '../../hooks/useAsync';
import { usePolling } from '../../hooks/usePolling';

/**
 * Pipeline status, shared by the sidebar indicator, the overview card and the
 * pipeline page.
 *
 * One provider owns the polling loop so three components cannot each start their
 * own. `publishToken` increments when a run succeeds; analytics queries list it
 * as a dependency, which is what makes the dashboard refresh at the moment the
 * warehouse is replaced rather than on a timer.
 */

const POLL_INTERVAL_MS = 2_000;

interface PipelineContextValue {
  readonly status: PipelineStatus | undefined;
  readonly isLoading: boolean;
  readonly error: unknown;
  readonly refresh: () => void;

  readonly isRunning: boolean;
  readonly warehouseReady: boolean;

  readonly start: () => void;
  readonly isStarting: boolean;
  readonly startError: unknown;
  readonly dismissStartError: () => void;

  readonly publishToken: number;
}

const PipelineContext = createContext<PipelineContextValue | undefined>(undefined);

export function PipelineProvider({ children }: { children: ReactNode }) {
  const { status, data, error, refresh } = useAsync(
    (signal) => api.pipelineStatus(signal),
    [],
  );

  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<unknown>(undefined);
  const [publishToken, setPublishToken] = useState(0);

  // The API enqueues a run rather than executing it inline (running the ETL
  // in-process would put Python in the Node API, and starting a container would
  // need the Docker socket). A run therefore starts `queued` and moves to
  // `running` once the worker claims it — both count as active here, or the
  // button would stay enabled and polling would not start for the queued window.
  const currentStatus = data?.current?.status;
  const isRunning = currentStatus === 'queued' || currentStatus === 'running';

  // Poll only while a run is active. The interval is torn down when the run
  // settles and when this provider unmounts.
  usePolling(refresh, POLL_INTERVAL_MS, isRunning);

  // A new successful run means a new warehouse file. Comparing run ids rather
  // than counting refreshes means the token moves once per publish.
  const lastSuccessId = data?.lastSuccessful?.runId;
  const seenSuccessId = useRef<string | undefined>(undefined);
  const initialised = useRef(false);

  useEffect(() => {
    if (!initialised.current) {
      initialised.current = true;
      seenSuccessId.current = lastSuccessId;
      return;
    }

    if (lastSuccessId !== undefined && lastSuccessId !== seenSuccessId.current) {
      seenSuccessId.current = lastSuccessId;
      setPublishToken((token) => token + 1);
    }
  }, [lastSuccessId]);

  const start = useCallback(() => {
    setIsStarting(true);
    setStartError(undefined);

    api.runPipeline().then(
      () => {
        setIsStarting(false);
        refresh();
      },
      (caught: unknown) => {
        setIsStarting(false);
        if (isAbortError(caught)) return;
        setStartError(caught);
        // A 409 means someone else started a run; showing it is more useful
        // than showing the request that lost the race.
        refresh();
      },
    );
  }, [refresh]);

  const value = useMemo<PipelineContextValue>(
    () => ({
      status: data,
      isLoading: status === 'loading' && data === undefined,
      error,
      refresh,
      isRunning,
      warehouseReady: data?.lastSuccessful !== null && data?.lastSuccessful !== undefined,
      start,
      isStarting,
      startError,
      dismissStartError: () => setStartError(undefined),
      publishToken,
    }),
    [data, status, error, refresh, isRunning, start, isStarting, startError, publishToken],
  );

  return <PipelineContext.Provider value={value}>{children}</PipelineContext.Provider>;
}

export function usePipeline(): PipelineContextValue {
  const context = useContext(PipelineContext);
  if (!context) throw new Error('usePipeline must be used inside a PipelineProvider.');
  return context;
}
