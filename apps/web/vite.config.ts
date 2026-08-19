import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The API has no CORS middleware, so a browser on :5173 cannot call :4000
// directly. Proxying keeps every request same-origin and means the app uses the
// same relative paths in development and in the container build.
const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/health': { target: API_TARGET, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    css: false,
    // Component tests exercise the fixture transport directly (setup.ts calls
    // resetFixtures) and must never depend on a reachable backend. Forcing this
    // here keeps the suite hermetic regardless of which way VITE_API_FIXTURES
    // defaults for `dev`/`build` — that default is a separate, deliberate
    // decision made in src/api/client.ts.
    env: { VITE_API_FIXTURES: '1' },
  },
});
