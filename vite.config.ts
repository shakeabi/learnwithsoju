import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

// Per-surface input keys. The key encodes the output directory + basename:
// 'pages/options/options' → entry emits at extension/pages/options/main.js
// and its CSS at extension/pages/options/main.css. Add a row per surface
// as they migrate (notepad, morpheme-inspector, popup, overlay).
const inputs: Record<string, string> = {
  'pages/options/options': resolve(__dirname, 'src/pages/options/main.ts'),
  'pages/notepad/notepad': resolve(__dirname, 'src/pages/notepad/main.ts'),
};

// Map of entry basename → output directory, derived once from `inputs`.
// Used by assetFileNames to route CSS to the matching surface dir, because
// Rollup names the CSS asset after the entry's basename (e.g. 'options.css'
// for input key 'pages/options/options'), not the full input key.
const dirByBasename: Record<string, string> = Object.fromEntries(
  Object.keys(inputs).map((key) => {
    const parts = key.split('/');
    const basename = parts.pop() ?? '';
    return [basename, parts.join('/')];
  })
);

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
      input: inputs,
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
          // CSS assets: route to the entry's directory as main.css. Rollup
          // names the CSS asset after the entry's basename, so we look the
          // basename up in dirByBasename (built from `inputs` above). This
          // generalizes across all surfaces — adding an entry to `inputs`
          // automatically wires its CSS to the matching dir.
          if (assetInfo.name?.endsWith('.css')) {
            const basename = assetInfo.name.replace(/\.css$/, '');
            const dir = dirByBasename[basename];
            if (dir !== undefined) {
              return dir ? `${dir}/main.css` : 'main.css';
            }
            // Unknown CSS asset — emit under its original name at the root
            // so the build looks visibly wrong rather than silently
            // overwriting another surface's main.css.
            return `${basename}.css`;
          }
          return '[name][extname]';
        },
        // Shared Svelte runtime is extracted by Rollup into a single chunk
        // under shared/ — each page's main.js imports it via a relative
        // path (`../../shared/disclose-version-<hash>.js`). Per-entry CSS
        // stays inlined into each page's main.css because tokens.css uses
        // `@import` rather than a JS `import` (see pages/*/styles/tokens.css
        // for the why). The shared chunk's hash changes only when the
        // Svelte runtime itself changes, so committed-output churn is low.
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
