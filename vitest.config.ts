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
    // svelte/package.json exposes a `browser` export condition pointing at
    // index-client.js (where mount/render live). Vitest defaults to the
    // `default` condition, which is index-server.js → mount() throws
    // `lifecycle_function_unavailable`. Force `browser` so component
    // rendering tests work under jsdom.
    conditions: ['browser'],
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['tests/ui/**/*.test.ts'],
    setupFiles: [],
  },
});
