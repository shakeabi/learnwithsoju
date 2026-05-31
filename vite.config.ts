import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [svelte()],
  // Each surface becomes a self-contained bundle emitted into
  // extension/<surface>/main.js (or extension/pages/<surface>/main.js for the
  // 4 pages). emptyOutDir is critical false — we must not wipe extension/.
  //
  // Task 1 note: outDir is temporarily 'dist' (gitignored) while only the
  // __placeholder entry exists. Task 2 swaps it back to 'extension' as soon
  // as the first real surface (options) lands.
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    assetsDir: '',
    cssCodeSplit: true,
    sourcemap: true,
    rollupOptions: {
      // Entries are added per surface in later tasks (options, notepad,
      // morpheme-inspector, popup, overlay). For Task 1 a placeholder keeps
      // rollup happy until a real surface lands; the output is emitted to
      // dist/ (gitignored) so nothing lands under extension/.
      input: { __placeholder: resolve(__dirname, 'src/__placeholder.ts') },
      output: {
        // Each entry chunk lands at its surface's main.js path. Shared chunks
        // (Svelte runtime, lib/*) get inlined into each entry because we want
        // each surface bundle to be self-contained — Chrome MV3 can't share
        // ES modules across pages cleanly without listing them as
        // web_accessible_resources.
        entryFileNames: '[name]/main.js',
        chunkFileNames: '[name]/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          // CSS imported by a component lands next to that surface's main.js.
          if (assetInfo.name?.endsWith('.css')) return '[name]/main.css';
          return '[name]/[name][extname]';
        },
        manualChunks: undefined,
        inlineDynamicImports: false,
      },
    },
    target: 'es2022',
    minify: 'esbuild',
  },
  resolve: {
    alias: {
      '$lib': resolve(__dirname, 'src/lib'),
      '$types': resolve(__dirname, 'src/types'),
    },
  },
});
