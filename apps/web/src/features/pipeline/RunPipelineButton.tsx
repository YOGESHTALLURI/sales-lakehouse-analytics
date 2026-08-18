import { Play, RefreshCw } from 'lucide-react';
import { Button, type ButtonSize, type ButtonVariant } from '../../components/ui/Button';
import { usePipeline } from './PipelineProvider';

/**
 * The run control.
 *
 * Disabled while a run is active, which is the documented single-run rule made
 * visible. The API still arbitrates: if another client starts a run first, the
 * `409` comes back and is surfaced by whichever panel shows `startError`.
 */
export function RunPipelineButton({
  variant = 'primary',
  size = 'md',
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const { start, isStarting, isRunning, status } = usePipeline();
  const hasRun = status?.lastSuccessful !== null && status?.lastSuccessful !== undefined;

  return (
    <Button
      variant={variant}
      size={size}
      onClick={start}
      loading={isStarting}
      disabled={isRunning}
    >
      {isStarting || isRunning ? null : hasRun ? (
        <RefreshCw aria-hidden className="size-4" />
      ) : (
        <Play aria-hidden className="size-4" />
      )}
      {isRunning ? 'Run in progress' : hasRun ? 'Run pipeline again' : 'Run pipeline'}
    </Button>
  );
}
