import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setScenario } from '../src/api/fixtures/scenario';
import { renderApp } from './support/render';

/**
 * The dashboard's four states, and the run that moves it between two of them.
 *
 * `warehouseReady: false` is the state a fresh clone opens on, so it gets the
 * most attention here: it must read as an instruction, not a failure, and it must
 * resolve itself when a pipeline run succeeds.
 *
 * Every query below goes through a role and an accessible name. That keeps the
 * tests readable, and it means a change that breaks them is usually a change that
 * broke the page for a screen reader too.
 */

const NOT_BUILT = /the warehouse has not been built yet/i;

function statCard(label: string): HTMLElement {
  return screen.getByRole('group', { name: label });
}

/**
 * A controllable clock for the run lifecycle.
 *
 * Only the timer functions the app uses are faked, and interaction goes through
 * `fireEvent` rather than `user-event`: user-event's own scheduling does not
 * survive vitest's fake timers, and Testing Library's `waitFor` detects Jest's
 * fake timers but not vitest's, so it would wait in real time while this clock
 * stood still.
 */
function useTestClock(): void {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  vi.setSystemTime(new Date('2026-08-18T10:00:00.000Z'));
}

/** Advance the fake clock and let every resolved promise flush into React. */
async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function clickRunPipeline(): void {
  const notice = screen.getByRole('region', { name: NOT_BUILT });
  fireEvent.click(within(notice).getByRole('button', { name: /run pipeline/i }));
}

describe('the dashboard before any pipeline run', () => {
  beforeEach(() => setScenario('empty-warehouse'));

  it('explains that the warehouse is unbuilt rather than showing an error', async () => {
    renderApp('/');

    expect(await screen.findByRole('region', { name: NOT_BUILT })).toBeInTheDocument();

    // Zeros are the honest values here: the contract says every measure is 0
    // until a run publishes, and the API never substitutes PostgreSQL results.
    await waitFor(() => expect(within(statCard('Total revenue')).getByText('₹0')).toBeInTheDocument());
    expect(within(statCard('Orders')).getByText('0')).toBeInTheDocument();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers the run control inside the explanation', async () => {
    renderApp('/');

    const notice = await screen.findByRole('region', { name: NOT_BUILT });
    expect(within(notice).getByRole('button', { name: /run pipeline/i })).toBeEnabled();
  });
});

describe('running the pipeline from the dashboard', () => {
  beforeEach(() => setScenario('empty-warehouse'));

  it('polls while the run is active and refreshes the dashboard when it succeeds', async () => {
    useTestClock();

    renderApp('/');
    await settle();

    clickRunPipeline();
    await settle();

    // While a run is active the sidebar says so and the control refuses another.
    expect(screen.getAllByText(/pipeline running/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /run in progress/i })).toBeDisabled();

    // Past the run's duration: the polling loop sees it settle and the provider
    // bumps the publish token, which re-runs every analytics query.
    await settle(10_000);

    expect(screen.getByText(/warehouse up to date/i)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: NOT_BUILT })).toBeNull();
    expect(within(statCard('Total revenue')).queryByText('₹0')).not.toBeInTheDocument();
  });

  it('stops polling once the run has settled', async () => {
    useTestClock();

    renderApp('/');
    await settle();

    clickRunPipeline();
    await settle(10_000);

    // A settled run must leave no interval behind. Anything still pending here
    // would poll the API forever.
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the dashboard when analytics fail', () => {
  beforeEach(() => setScenario('error'));

  it('reports the failure and offers a retry', async () => {
    renderApp('/');

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    expect(within(alerts[0]!).getByText(/the warehouse could not be read/i)).toBeInTheDocument();
    expect(within(alerts[0]!).getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});

describe('the dashboard with a published warehouse', () => {
  beforeEach(() => setScenario('ready'));

  it('shows every measure the plan requires', async () => {
    renderApp('/');

    await screen.findByRole('group', { name: 'Total revenue' });

    for (const label of ['Total revenue', 'Orders', 'Units sold', 'Active customers', 'Average order value']) {
      expect(statCard(label)).toBeInTheDocument();
    }
  });

  it('pairs each chart with the numbers behind it', async () => {
    renderApp('/');

    // A screen reader gets nothing from an SVG, so the figures behind every
    // chart must also be reachable as a real table.
    const tables = await screen.findAllByText(/view data table/i);
    expect(tables.length).toBeGreaterThanOrEqual(2);
  });

  it('reports revenue in rupees, grouped in lakhs', async () => {
    renderApp('/');

    await waitFor(() =>
      expect(within(statCard('Total revenue')).queryByText('₹0')).not.toBeInTheDocument(),
    );

    const value = within(statCard('Total revenue')).getByText(/^₹[\d,]+$/);
    // ₹4,28,300 — two-digit groups above the thousand, not ₹428,300.
    expect(value.textContent).toMatch(/^₹\d{1,2}(,\d{2})*,\d{3}$/);
  });
});
