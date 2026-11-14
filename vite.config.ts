/// <reference types="vitest" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: '/netrunner-web/',
  plugins: [preact()],
  server: { port: 5173, host: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
  },
});
