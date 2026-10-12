import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Unit tests for the web app.
 *
 * jsdom covers the browser APIs the lib layer touches (localStorage, fetch,
 * EventSource are stubbed in test/setup.ts). Component tests render the
 * presentational certificate renderer - the one piece where a regression would
 * silently change what a printed certificate looks like.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
  },
});
