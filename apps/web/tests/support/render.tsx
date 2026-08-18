import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '../../src/app/App';
import { PipelineProvider } from '../../src/features/pipeline/PipelineProvider';

/**
 * Mount the real application at a given route.
 *
 * `MemoryRouter` rather than `BrowserRouter` so navigation and URL-held filter
 * state are exercised without touching jsdom's history.
 */
export function renderApp(path = '/'): RenderResult {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PipelineProvider>
        <AppRoutes />
      </PipelineProvider>
    </MemoryRouter>,
  );
}
