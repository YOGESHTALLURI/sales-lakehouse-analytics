import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { resetFixtures } from '../src/api/fixtures/transport';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // Fixtures hold mutable state — created rows, the published warehouse, run
  // history — so a test that creates an order must not change what the next one
  // sees.
  resetFixtures();
});

// Recharts measures its container before it renders anything. jsdom implements
// neither ResizeObserver nor layout, so without these the charts render empty and
// assertions about them would pass for the wrong reason.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub);

Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 960 });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 320 });

// jsdom does not implement matchMedia, which Recharts' responsive container and
// the reduced-motion query both consult.
vi.stubGlobal(
  'matchMedia',
  (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
);
