import { useEffect, useRef } from 'react';

/**
 * Call `tick` on an interval while `active`.
 *
 * The callback is held in a ref so a fresh closure each render does not restart
 * the interval, and the interval is cleared whenever `active` goes false or the
 * component unmounts — which is what stops the pipeline panel polling forever
 * after a run settles.
 */
export function usePolling(tick: () => void, intervalMs: number, active: boolean): void {
  const latest = useRef(tick);
  latest.current = tick;

  useEffect(() => {
    if (!active) return;

    const timer = setInterval(() => latest.current(), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, active]);
}
