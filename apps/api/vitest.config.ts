import { defineConfig } from 'vitest/config';

// Default suite: no service needs to be running. Dependency probes are injected
// and the migration loader is exercised against temporary directories, so this
// suite is safe for CI without Docker.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**'],
    testTimeout: 10_000,
  },
});
