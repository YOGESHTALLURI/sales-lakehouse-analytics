import { describe, expect, it } from 'vitest';
import type { PipelineRunStatus } from '../src/api/types';
import { runStatusLabel, runStatusTone } from '../src/features/pipeline/runPresentation';

/**
 * `queued` exists because the API enqueues a run for the ETL worker rather than
 * executing it inline — running the pipeline in-process would put Python in the
 * Node API, and starting a container would need the Docker socket. A run
 * therefore spends its first moment or two as `queued` before the worker claims
 * it and moves it to `running`.
 *
 * The contract fixtures never produce `queued` (they settle a run on a fixed
 * delay rather than modelling the worker's claim), so nothing here exercises
 * this status through the app's normal test suite. This file is what would have
 * caught the regression: `PipelineRunStatus` gained `queued` without every
 * consumer of it being updated, so a queued run rendered as if no run had ever
 * started — the button stayed enabled, and polling never began.
 */

const ALL_STATUSES: PipelineRunStatus[] = ['queued', 'running', 'succeeded', 'failed'];

describe('runStatusLabel and runStatusTone', () => {
  it('has a real presentation for every status the contract can report', () => {
    // Record<PipelineRunStatus, ...> makes a missing key a compile error, but
    // says nothing about the label or tone actually being right. Asserting them
    // here is what pins the value, not just its presence.
    for (const status of ALL_STATUSES) {
      expect(runStatusLabel(status)).toBeTruthy();
      expect(runStatusTone(status)).toBeTruthy();
    }
  });

  it('labels queued and running distinctly, so a user can tell them apart', () => {
    expect(runStatusLabel('queued')).toBe('Queued');
    expect(runStatusLabel('running')).toBe('Running');
    expect(runStatusLabel('queued')).not.toBe(runStatusLabel('running'));
  });

  it('gives queued the same tone as running, because both are active', () => {
    // Both are "in flight" from the caller's point of view — the worker usually
    // claims a queued run within a couple of seconds, and there is no
    // per-stage detail to show anything more specific in the meantime.
    expect(runStatusTone('queued')).toBe(runStatusTone('running'));
  });

  it('gives succeeded and failed their own, different tones', () => {
    const tones = new Set([
      runStatusTone('queued'),
      runStatusTone('succeeded'),
      runStatusTone('failed'),
    ]);

    expect(tones.size).toBe(3);
  });
});
