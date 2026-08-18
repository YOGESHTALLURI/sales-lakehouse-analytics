import { defineConfig } from 'vitest/config';

// Integration suite: requires the Compose stack (`docker compose up -d postgres`).
// Each spec provisions its own throwaway database, so specs cannot interfere
// with each other or with the development database.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Creating and dropping databases concurrently is needless contention.
    fileParallelism: false,
  },
});
