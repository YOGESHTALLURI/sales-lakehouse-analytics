import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Health checks are injected in tests, so no service needs to be running.
    testTimeout: 10_000,
  },
});
