import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [svelte({ hot: false })],
  resolve: {
    alias: {
      '$lib': resolve(__dirname, 'src/lib'),
      '$types': resolve(__dirname, 'src/types'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['tests/ui/**/*.test.ts'],
    setupFiles: [],
  },
});
