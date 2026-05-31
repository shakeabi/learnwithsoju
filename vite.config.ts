import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [svelte()],
  // Each surface becomes a self-contained bundle emitted into
  // extension/<surface>/main.js (or extension/pages/<surface>/main.js for the
  // 4 pages). emptyOutDir is critical false — we must not wipe extension/.
  build: {
    outDir: 'extension',
    emptyOutDir: false,
    assetsDir: '',
    cssCodeSplit: true,
    // Sourcemaps disabled: the built bundle is committed to extension/ so the
    // user can load the extension from the repo without a build step. Shipping
    // .map files inflates the commit by ~9× per source change. Re-enable
    // locally if needed when debugging.
    sourcemap: false,
    rollupOptions: {
      input: {
        'pages/options/options': resolve(__dirname, 'src/pages/options/main.ts'),
      },
      output: {
        // The input key is used as the chunk name; with `[name]/main.js` we
        // get extension/pages/options/options/main.js — wrong. Use `[name].js`
        // instead and bake the path into the input key (without trailing
        // basename), then override the basename in a hook.
        entryFileNames: (chunk) => {
          // chunk.name is the input key, e.g. 'pages/options/options'.
          // Strip the trailing basename and emit 'main.js' in that dir.
          const parts = chunk.name.split('/');
          parts.pop();
          return `${parts.join('/')}/main.js`;
        },
        chunkFileNames: (chunk) => {
          const parts = (chunk.name || 'shared').split('/');
          parts.pop();
          const dir = parts.join('/') || 'shared';
          return `${dir}/[name]-[hash].js`;
        },
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            // Emit alongside main.js. Vite's CSS-per-entry mode means each
            // entry gets one css asset; we route it to the entry's dir.
            // We can't read the entry from assetInfo directly, so we use the
            // file basename mapping — the css filename matches the entry name.
            return 'pages/options/main.css';
          }
          return '[name][extname]';
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
