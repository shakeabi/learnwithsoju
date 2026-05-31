# Svelte UI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the 4 extension pages and the in-page shadow-DOM lookup popup from vanilla JS to Svelte 5 + TypeScript, in 7 sequential commits on the `svelte-rewrite` branch, leaving the extension loadable and functional after each commit.

**Architecture:** Hybrid Vite build — `src/` holds Svelte+TS sources, Vite emits bundles into `extension/<surface>/main.js`. Manifest stays hand-edited; plain JS in extension/ (background.js, content.js bridge, adapters, vendor/mecab-ko) is untouched. Components communicate with background.js via typed wrappers around `chrome.runtime.sendMessage`. The in-page overlay mounts into a shadow root and exposes a `window.__lwsOverlay` global that content.js drives imperatively.

**Tech Stack:** Svelte 5 (runes), Vite 6, TypeScript 5.x, @sveltejs/vite-plugin-svelte 5.x, Vitest 2.x, @testing-library/svelte 5.x, jsdom 25.x.

---

## Task 1: Build infrastructure

**Goal:** Land the Vite + Svelte + TypeScript build, the `src/types` and `src/lib` skeletons, a Vitest harness, and a working settings store — without migrating any UI yet. Extension must still load and work identically after this commit.

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `src/types/messages.ts`
- Create: `src/types/settings.ts`
- Create: `src/types/overlay.ts`
- Create: `src/lib/messages.ts`
- Create: `src/lib/storage.ts`
- Create: `src/lib/cache.ts`
- Create: `src/lib/styles/page-shell.css`
- Create: `src/app.d.ts`
- Create: `tests/ui/storage.test.ts`
- Create: `.gitignore` modification (add `node_modules/`, `dist/`, etc. if missing)

- [ ] **Step 1.1: Inspect existing package.json scripts**

Read `package.json` and confirm the existing `build`, `build:chrome`, `build:firefox` scripts package the extension into `dist/` zips. These distribution scripts must keep working under a new name (`package`, `package:chrome`, `package:firefox`) because `npm run build` is being repurposed to run Vite (per the spec).

- [ ] **Step 1.2: Replace package.json**

Replace `package.json` with:

```json
{
  "name": "learnwithsoju",
  "version": "0.1.0",
  "private": true,
  "description": "Korean hover dictionary Chrome extension. The extension itself ships in extension/; this package.json drives the Vite/Svelte build and the Node test harness.",
  "type": "module",
  "license": "AGPL-3.0-or-later",
  "author": "abishake",
  "homepage": "https://github.com/abishake/learnwithsoju#readme",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/abishake/learnwithsoju.git"
  },
  "bugs": {
    "url": "https://github.com/abishake/learnwithsoju/issues"
  },
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch",
    "test": "node --test 'tests/**/*.test.js'",
    "test:ui": "vitest run",
    "package:chrome": "bash scripts/build-chrome.sh",
    "package:firefox": "bash scripts/build-firefox.sh",
    "package": "npm run package:chrome && npm run package:firefox"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^5.0.0",
    "@testing-library/svelte": "^5.0.0",
    "@xmldom/xmldom": "^0.9.5",
    "jsdom": "^25.0.0",
    "svelte": "^5.0.0",
    "svelte-check": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 1.3: Install deps**

Run: `npm install`

Expected: completes without errors, creates/updates `package-lock.json` and `node_modules/`.

- [ ] **Step 1.4: Confirm existing node tests still pass**

Run: `npm test`

Expected output: tests from `parsers.test.js`, `lemmatizer.test.js`, `api.test.js`, `grammar-glosses.test.js`, `cache.test.js`, `nnp-synthesis.test.js` all pass (whatever the current count is; the migration must not regress this number).

- [ ] **Step 1.5: Create .gitignore additions**

Read existing `.gitignore`. If `node_modules/` and `dist/` aren't already ignored, add them:

```
node_modules/
dist/
.vite/
*.log
```

(Don't ignore `extension/` — build output is committed.)

- [ ] **Step 1.6: Create tsconfig.json**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "allowSyntheticDefaultImports": true,
    "skipLibCheck": true,
    "types": ["svelte", "vite/client", "chrome", "node"]
  },
  "include": ["src/**/*.ts", "src/**/*.svelte", "tests/ui/**/*.ts"],
  "exclude": ["node_modules", "extension", "dist"]
}
```

Note: `@types/chrome` and `@types/node` are not added as devDeps because the chrome global is only referenced from `src/lib/messages.ts` and `src/lib/storage.ts`, which are typed at the call boundary. If TS complains about `chrome` not being defined, declare it as `any` in `src/app.d.ts` (Step 1.7).

- [ ] **Step 1.7: Create src/app.d.ts (ambient declarations)**

Create `src/app.d.ts`:

```ts
// Ambient declarations for the Chrome extension API and Svelte/CSS imports.
//
// We intentionally don't pull in @types/chrome — only a tiny surface of the
// extension API is reached from Svelte components (chrome.runtime.sendMessage,
// chrome.storage.sync, chrome.storage.onChanged, chrome.runtime.getURL,
// chrome.runtime.getManifest, chrome.runtime.openOptionsPage, chrome.tabs.query,
// chrome.tabs.sendMessage). Declaring it as `any` here keeps the boundary
// narrow and avoids type drift against a published @types package.

declare const chrome: any;

declare module '*.css' {
  const content: string;
  export default content;
}

declare module '*.svg' {
  const src: string;
  export default src;
}
```

- [ ] **Step 1.8: Create vite.config.ts**

Create `vite.config.ts`. This is the multi-entry build configuration; surfaces are added in subsequent tasks (the Task 1 commit has only the infrastructure — no entries are defined yet, so build is a no-op).

```ts
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
    sourcemap: true,
    rollupOptions: {
      // Entries are added per surface in later tasks (options, notepad,
      // morpheme-inspector, popup, overlay). For Task 1 this stays empty so
      // `npm run build` is a no-op until a surface lands.
      input: {},
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
```

- [ ] **Step 1.9: Create vitest.config.ts**

Create `vitest.config.ts`:

```ts
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
```

- [ ] **Step 1.10: Create src/types/messages.ts**

Read `extension/background.js` lines 408-500 to confirm the message types: `lookup`, `lookupHanja`, `ping`, `warmup`, `openOptions`, `clearCache`, `cacheCounts`, `mecab-inspect`.

Create `src/types/messages.ts`:

```ts
// Type definitions for every chrome.runtime.sendMessage contract between
// Svelte UI surfaces and the plain-JS background service worker
// (extension/background.js, message dispatcher around lines 408–500).
//
// The background handlers stay in plain JS — runtime is the actual contract
// boundary. This file documents the shapes we expect and gives the typed
// wrappers in src/lib/messages.ts something to enforce at the call site.

// ---- lookup ----
// Background returns the full parsed lookup payload: tokens (mecab), grouped
// dictionary candidates (per query), raw KRDict + OpenDict XML for lazy
// re-parsing on tab switches, plus error fields when something failed. The
// shape is large and depends on parsed XML — we keep it `unknown` here and
// shape it where consumed (overlay App.svelte) rather than mirroring the
// payload in TS where it would drift.
export interface LookupRequest {
  type: 'lookup';
  surface: string;
}
export type LookupResponse =
  | { error: 'NO_API_KEY' | 'FETCH_FAILED' | 'INTERNAL' | string; message?: string; surface?: string }
  | LookupSuccess;

// LookupSuccess is intentionally permissive — the overlay consumes specific
// fields (`tokens`, `groups`, `unrelated`, `krXmls`, `odXml`, `lemma`, etc.)
// and the precise shape is documented in extension/background.js. We expose
// the fields the overlay reaches into; everything else passes through as
// unknown.
export interface LookupSuccess {
  surface: string;
  lemma?: string;
  tokens?: unknown[];
  groups?: unknown[];
  unrelated?: unknown[];
  krXmls?: unknown[];
  odXml?: unknown;
  error?: undefined;
  // permits the additional fields the parser pipeline attaches
  [k: string]: unknown;
}

// ---- lookupHanja ----
export interface LookupHanjaRequest {
  type: 'lookupHanja';
  chars: string;
}
export type LookupHanjaResponse =
  | { chars: string; error: string; message?: string }
  | { chars: string; hanjas: unknown[]; error?: undefined };

// ---- ping ----
export interface PingRequest { type: 'ping'; }
export interface PingResponse { ok: true; }

// ---- warmup ----
export interface WarmupRequest { type: 'warmup'; }
export interface WarmupResponse { ok: true; }

// ---- openOptions ----
export interface OpenOptionsRequest { type: 'openOptions'; }
export interface OpenOptionsResponse { ok: true; }

// ---- clearCache ----
export type ClearCacheTarget = 'lookup' | 'hanja' | 'dict' | 'all';
export interface ClearCacheRequest {
  type: 'clearCache';
  target: ClearCacheTarget;
}
export interface ClearCacheResponse {
  ok: boolean;
  cleared?: { lookup?: boolean; hanja?: boolean; dict?: boolean };
  error?: string;
}

// ---- cacheCounts ----
export interface CacheCountsRequest { type: 'cacheCounts'; }
export interface CacheCounts {
  lookup: number;
  hanja: number;
  krdict: number;
  opendict: number;
}
export interface CacheCountsResponse {
  ok: boolean;
  counts?: CacheCounts;
  error?: string;
}

// ---- mecab-inspect ----
// Used by morpheme-inspector page. Background returns three sections:
// singlePath (best mecab tokenization), nbestPaths (top-N), candidates
// (lemma candidates derived from n-best). Token shape is the serializeToken
// output in extension/background.js — surface, pos, type, firstPos, lastPos,
// decomp, reading, features.
export interface MecabInspectRequest {
  type: 'mecab-inspect';
  text: string;
  nbest?: number;
}
export interface MecabToken {
  surface: string;
  pos: string;
  type: string;
  firstPos: string;
  lastPos: string;
  decomp: string;
  reading: string;
  features: string;
}
export interface MecabNbestPath {
  cost: number;
  tokens: MecabToken[];
}
export interface MecabInspectResponse {
  singlePath?: MecabToken[];
  nbestPaths?: MecabNbestPath[];
  candidates?: string[];
  error?: string;
}

// Discriminated union for the rare case where a caller needs to match on type.
export type AnyMessageRequest =
  | LookupRequest
  | LookupHanjaRequest
  | PingRequest
  | WarmupRequest
  | OpenOptionsRequest
  | ClearCacheRequest
  | CacheCountsRequest
  | MecabInspectRequest;
```

- [ ] **Step 1.11: Create src/types/settings.ts**

Read `extension/pages/options/options.js` lines 1-10 to confirm the storage keys actually used: `krdictApiKey`, `opendictApiKey`, `dualSubsYouTube`, `dualSubsNetflix`, `secondaryLang`, `askAiPrompt`, `askAiProvider`, `askAiChatGptTemporary`.

Create `src/types/settings.ts`:

```ts
// Settings schema — every chrome.storage.sync key the extension reads or
// writes from a UI surface. Background can write additional keys (e.g.
// internal flags); those don't appear here because the UI doesn't touch them.
//
// Key names match the actual storage keys (see extension/pages/options/options.js
// KEYS map and extension/content.js STORAGE_KEYS map).

export interface Settings {
  /** KRDict API key — required for lookups. */
  krdictApiKey: string;
  /** OpenDict API key — optional fallback. */
  opendictApiKey: string;
  /** Enable YouTube dual-subs adapter. Default true. */
  dualSubsYouTube: boolean;
  /** Enable Netflix dual-subs adapter. Default true. */
  dualSubsNetflix: boolean;
  /** Secondary subtitle language ISO code. Default 'en'. */
  secondaryLang: string;
  /** Custom Ask-AI prompt template. Empty/undefined = use DEFAULT_ASK_AI_PROMPT. */
  askAiPrompt: string;
  /** Selected Ask-AI provider key (see extension/core/ai-providers.js). */
  askAiProvider: string;
  /** When provider is ChatGPT, append ?temporary-chat=true to the URL. */
  askAiChatGptTemporary: boolean;
}

export const SETTINGS_DEFAULTS: Settings = {
  krdictApiKey: '',
  opendictApiKey: '',
  dualSubsYouTube: true,
  dualSubsNetflix: true,
  secondaryLang: 'en',
  askAiPrompt: '',
  askAiProvider: 'chatgpt',
  askAiChatGptTemporary: false,
};

// All settings keys, used by the store to subset chrome.storage.onChanged
// events to ones we actually care about.
export const SETTINGS_KEYS = Object.keys(SETTINGS_DEFAULTS) as Array<keyof Settings>;

// Storage area for settings. The 4 pages all use sync; per-site disable list
// lives in chrome.storage.local (popup-only) and isn't part of this schema.
export const SETTINGS_AREA = 'sync' as const;
```

- [ ] **Step 1.12: Create src/types/overlay.ts**

Create `src/types/overlay.ts`. The payload shape is the LookupSuccess from messages.ts plus the sentence and rendering hints content.js passes in.

```ts
// Types shared between content.js (the bridge) and the overlay Svelte
// component tree. The bridge stays in plain JS and treats these as `any` at
// runtime; this file documents what overlay components expect.

import type { LookupSuccess } from './messages';

/** What content.js extracts from the page around the hovered word. */
export interface SentenceContext {
  before: string;
  word: string;
  after: string;
}

/** The full payload the bridge passes to window.__lwsOverlay.show(). */
export interface OverlayPayload {
  /** Lookup result from background.js (parsed payload, unknown XML shape). */
  lookup: LookupSuccess;
  /** Sentence extracted from the DOM (or null on hover-without-block). */
  sentence: SentenceContext | null;
  /** Anchor rect in document coordinates for positioning. */
  anchor: { top: number; left: number; bottom: number; right: number; width: number; height: number };
  /** User's secondary language code from chrome.storage.sync. */
  secondaryLang: string;
  /** Default-lang preference ('en' or 'ko'). */
  defLang: 'en' | 'ko';
  /** Ask-AI provider key and (effective) prompt template. */
  askAiProvider: string;
  askAiPromptTemplate: string;
  askAiChatGptTemporary: boolean;
  /** When true, repositions the popup at the anchor. False = keep current
   *  position (sentence-word click case). */
  reposition: boolean;
}

/** Loading / error overlay frames that content.js can show instead of a full lookup. */
export type OverlayFrame =
  | { kind: 'loading'; surface: string; anchor: OverlayPayload['anchor']; reposition: boolean }
  | { kind: 'error'; message: string; details?: string; action?: { label: string; onClick: () => void }; anchor: OverlayPayload['anchor']; reposition: boolean }
  | { kind: 'payload'; payload: OverlayPayload };

/** The window global content.js calls. */
export interface OverlayApi {
  show(frame: OverlayFrame): void;
  hide(): void;
  /** Partial state update — e.g. lookup-status text while loading. */
  update(patch: { lookupStatus?: string }): void;
}

declare global {
  interface Window {
    __lwsOverlay?: OverlayApi;
  }
}
```

- [ ] **Step 1.13: Create src/lib/messages.ts**

Create `src/lib/messages.ts` — one typed wrapper per handler:

```ts
import type {
  LookupRequest, LookupResponse,
  LookupHanjaRequest, LookupHanjaResponse,
  PingResponse,
  WarmupResponse,
  OpenOptionsResponse,
  ClearCacheRequest, ClearCacheResponse, ClearCacheTarget,
  CacheCountsResponse,
  MecabInspectRequest, MecabInspectResponse,
} from '$types/messages';

/**
 * Typed wrappers around chrome.runtime.sendMessage. The plain-JS background
 * handlers (extension/background.js) are the actual contract boundary; this
 * file is the single source of truth for what the UI promises to send.
 *
 * Each wrapper returns a Promise that resolves to the typed response. We
 * don't reject on background errors — the response object carries an `error`
 * field instead, matching the existing JS contract. Network/transport errors
 * (extension reloading mid-message) reject as usual.
 */

function send<TReq, TRes>(req: TReq): Promise<TRes> {
  return chrome.runtime.sendMessage(req) as Promise<TRes>;
}

export function lookup(surface: string): Promise<LookupResponse> {
  const req: LookupRequest = { type: 'lookup', surface };
  return send<LookupRequest, LookupResponse>(req);
}

export function lookupHanja(chars: string): Promise<LookupHanjaResponse> {
  const req: LookupHanjaRequest = { type: 'lookupHanja', chars };
  return send<LookupHanjaRequest, LookupHanjaResponse>(req);
}

export function ping(): Promise<PingResponse> {
  return send({ type: 'ping' });
}

export function warmup(): Promise<WarmupResponse> {
  return send({ type: 'warmup' });
}

export function openOptions(): Promise<OpenOptionsResponse> {
  return send({ type: 'openOptions' });
}

export function clearCache(target: ClearCacheTarget): Promise<ClearCacheResponse> {
  const req: ClearCacheRequest = { type: 'clearCache', target };
  return send<ClearCacheRequest, ClearCacheResponse>(req);
}

export function cacheCounts(): Promise<CacheCountsResponse> {
  return send({ type: 'cacheCounts' });
}

export function mecabInspect(text: string, nbest = 5): Promise<MecabInspectResponse> {
  const req: MecabInspectRequest = { type: 'mecab-inspect', text, nbest };
  return send<MecabInspectRequest, MecabInspectResponse>(req);
}
```

- [ ] **Step 1.14: Create src/lib/storage.ts**

Create `src/lib/storage.ts` — Svelte 5 `$state`-backed settings store:

```ts
import { SETTINGS_DEFAULTS, SETTINGS_KEYS, SETTINGS_AREA, type Settings } from '$types/settings';

/**
 * Reactive settings store backed by chrome.storage.sync.
 *
 * Usage from a Svelte component:
 *   import { settings, setSetting } from '$lib/storage';
 *   const s = settings.value;        // reactive read (re-runs in $effect)
 *   await setSetting('secondaryLang', 'ja');
 *
 * Hydration: the first import triggers hydrate() which reads all settings
 * keys from chrome.storage.sync. The promise is exposed as `settingsReady`
 * for components that want to await it on mount.
 *
 * Live updates: chrome.storage.onChanged fires when sync writes happen (from
 * any tab / the options page). We patch the rune in place so all subscribers
 * re-run.
 *
 * Defaults: a missing key reads as SETTINGS_DEFAULTS[key]. Writing a value
 * that equals the default still persists it — we don't auto-prune, matching
 * existing options.js behaviour (except askAiPrompt, where the empty case is
 * special-cased by ApiKeySection / AdvancedSection at the call site).
 */

class SettingsStore {
  // $state must be declared in a Svelte runes context. In a .ts file we use
  // the raw API: $state.raw for the seed value, wrapped in a getter/setter so
  // components see a reactive surface.
  #value = $state<Settings>({ ...SETTINGS_DEFAULTS });

  get value(): Settings {
    return this.#value;
  }

  // Internal patch — used by hydrate and onChanged. Mutates the inner state
  // so subscribers re-run.
  patch(partial: Partial<Settings>) {
    for (const k of Object.keys(partial) as Array<keyof Settings>) {
      const v = partial[k];
      if (v !== undefined) {
        // assignment to a $state object triggers reactivity at the field level
        (this.#value as any)[k] = v;
      }
    }
  }
}

export const settings = new SettingsStore();

let hydrated: Promise<void> | null = null;

export function settingsReady(): Promise<void> {
  if (hydrated) return hydrated;
  hydrated = (async () => {
    try {
      const raw = await chrome.storage[SETTINGS_AREA].get(SETTINGS_KEYS);
      const patch: Partial<Settings> = {};
      for (const k of SETTINGS_KEYS) {
        if (raw && Object.prototype.hasOwnProperty.call(raw, k)) {
          patch[k] = raw[k];
        }
      }
      settings.patch(patch);
    } catch (err) {
      console.warn('[lws] storage.ts: hydrate failed:', err);
    }
  })();
  return hydrated;
}

// Install onChanged listener once. Idempotent: subsequent imports re-use the
// already-installed listener.
let listenerInstalled = false;
function ensureListener() {
  if (listenerInstalled) return;
  listenerInstalled = true;
  try {
    chrome.storage.onChanged.addListener((changes: any, area: string) => {
      if (area !== SETTINGS_AREA) return;
      const patch: Partial<Settings> = {};
      for (const k of SETTINGS_KEYS) {
        if (changes && Object.prototype.hasOwnProperty.call(changes, k)) {
          patch[k] = changes[k].newValue;
        }
      }
      if (Object.keys(patch).length > 0) settings.patch(patch);
    });
  } catch (err) {
    console.warn('[lws] storage.ts: onChanged listener install failed:', err);
  }
}
ensureListener();
// Kick hydration immediately on import — components that don't await
// settingsReady() still get up-to-date values shortly after mount.
settingsReady();

/** Persist a single setting through to chrome.storage.sync. */
export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  // Optimistic local update so the UI reflects immediately.
  settings.patch({ [key]: value } as Partial<Settings>);
  try {
    await chrome.storage[SETTINGS_AREA].set({ [key]: value });
  } catch (err) {
    console.warn('[lws] storage.ts: setSetting failed:', key, err);
    throw err;
  }
}

/** Remove a single setting key (so the default re-applies on next read). */
export async function removeSetting<K extends keyof Settings>(key: K): Promise<void> {
  settings.patch({ [key]: SETTINGS_DEFAULTS[key] } as Partial<Settings>);
  try {
    await chrome.storage[SETTINGS_AREA].remove(key as string);
  } catch (err) {
    console.warn('[lws] storage.ts: removeSetting failed:', key, err);
    throw err;
  }
}
```

- [ ] **Step 1.15: Create src/lib/cache.ts**

Create `src/lib/cache.ts`:

```ts
import { cacheCounts as rawCacheCounts, clearCache as rawClearCache } from './messages';
import type { CacheCounts, ClearCacheTarget } from '$types/messages';

/**
 * Cache wrappers — thin layer over messages.ts that surfaces just the data
 * components need (the counts dict, the success flag).
 */

export async function getCounts(): Promise<CacheCounts | null> {
  try {
    const res = await rawCacheCounts();
    return res.ok && res.counts ? res.counts : null;
  } catch (err) {
    console.warn('[lws] cache.ts: getCounts failed:', err);
    return null;
  }
}

export async function clear(target: ClearCacheTarget): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await rawClearCache(target);
    return { ok: !!res.ok, error: res.error };
  } catch (err) {
    return { ok: false, error: (err as Error).message || String(err) };
  }
}
```

- [ ] **Step 1.16: Create src/lib/styles/page-shell.css**

Create `src/lib/styles/page-shell.css` — ported tokens + base form/button styles from `extension/pages/options/options.css` lines 1-279 (everything except the `.advanced` `<details>` styles and the cache-buttons selectors, which move into per-component blocks in Task 2):

```css
/* page-shell.css — shared design tokens + base form/button/header styles
 * for the 4 extension pages (options, notepad, morpheme-inspector, popup).
 *
 * Ported verbatim from the original extension/pages/options/options.css
 * with no semantic changes — variable names, color values, spacing are
 * all 1:1. Component-specific selectors live in per-component <style>
 * blocks in the Svelte components.
 */

:root {
  color-scheme: light dark;
  --bg: #fafafc;
  --card: #ffffff;
  --fg: #1a1a24;
  --muted: #5b6172;
  --border: #e3e5ec;
  --accent: #5b6cf3;
  --accent-fg: #ffffff;
  --error: #c93a3a;
  --success: #1f8a4e;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #15151c;
    --card: #1e1e2e;
    --fg: #e8e8f0;
    --muted: #97a0b8;
    --border: rgba(255, 255, 255, 0.08);
    --accent: #7d8cff;
    --error: #ff7a7a;
    --success: #4dd07d;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Pretendard", "Apple SD Gothic Neo", sans-serif;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.5;
}

main {
  max-width: 640px;
  margin: 0 auto;
  padding: 32px 24px 64px;
}

header h1 {
  margin: 0;
  font-size: 26px;
  letter-spacing: -0.01em;
}

.subtitle {
  margin: 4px 0 24px;
  color: var(--muted);
  font-size: 14px;
}

.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px 22px;
  margin-bottom: 20px;
}

.card h2 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
}

.hint {
  margin: 0 0 18px;
  font-size: 13px;
  color: var(--muted);
}

.hint code {
  background: rgba(120, 140, 200, 0.12);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
}

.field {
  display: block;
  margin-bottom: 18px;
}

.field .label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 6px;
}

.required, .optional {
  font-size: 11px;
  font-weight: 400;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
}

.required {
  background: rgba(201, 58, 58, 0.12);
  color: var(--error);
}

.optional {
  background: rgba(120, 140, 200, 0.12);
  color: var(--muted);
}

.experimental {
  font-size: 11px;
  font-weight: 400;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(245, 196, 106, 0.18);
  color: #b07a18;
}
@media (prefers-color-scheme: dark) {
  .experimental { color: #f5c46a; }
}

.field-note {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.45;
}

.field input[type=password],
.field input[type=text],
.field select,
.field textarea {
  width: 100%;
  padding: 9px 11px;
  font: inherit;
  font-size: 14px;
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 7px;
  outline: none;
}

.field textarea {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.5;
  resize: vertical;
  min-height: 120px;
}

.field input:focus,
.field select:focus,
.field textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(125, 140, 255, 0.18);
}

.field-link {
  display: inline-block;
  margin-top: 6px;
  font-size: 12px;
  color: var(--accent);
  text-decoration: none;
}

.field-link:hover {
  text-decoration: underline;
}

.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}

button {
  padding: 8px 14px;
  font: inherit;
  font-size: 13px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--fg);
  border-radius: 7px;
  cursor: pointer;
}

button:hover {
  border-color: var(--accent);
}

button.primary {
  background: var(--accent);
  color: var(--accent-fg);
  border-color: var(--accent);
}

button.primary:hover {
  filter: brightness(1.05);
}

.status {
  font-size: 13px;
}

.status.ok { color: var(--success); }
.status.err { color: var(--error); }

.checkbox {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 14px;
  cursor: pointer;
  margin-bottom: 8px;
}
.checkbox:last-child {
  margin-bottom: 0;
}
.checkbox em.note {
  display: block;
  margin-top: 2px;
  font-style: normal;
  font-size: 12px;
  color: var(--muted);
}

footer {
  margin-top: 28px;
  font-size: 12px;
  color: var(--muted);
}

footer a {
  color: var(--accent);
  text-decoration: none;
}

footer a:hover {
  text-decoration: underline;
}

.version {
  margin-top: 4px;
}
```

- [ ] **Step 1.17: Create tests/ui/ directory and storage round-trip test**

Run: `mkdir -p tests/ui`

Create `tests/ui/storage.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

// We import the module lazily inside each test after stubbing chrome, because
// src/lib/storage.ts kicks off hydration on first import. Resetting the module
// registry between tests gives each test a fresh hydration cycle against its
// own stub.

function makeChromeStub(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const listeners: Array<(changes: any, area: string) => void> = [];
  return {
    chrome: {
      storage: {
        sync: {
          async get(keys: string | string[] | null) {
            if (keys === null || keys === undefined) {
              return Object.fromEntries(store);
            }
            const arr = Array.isArray(keys) ? keys : [keys];
            const out: Record<string, unknown> = {};
            for (const k of arr) {
              if (store.has(k)) out[k] = store.get(k);
            }
            return out;
          },
          async set(obj: Record<string, unknown>) {
            const changes: Record<string, { newValue: unknown; oldValue?: unknown }> = {};
            for (const [k, v] of Object.entries(obj)) {
              changes[k] = { newValue: v, oldValue: store.get(k) };
              store.set(k, v);
            }
            for (const l of listeners) l(changes, 'sync');
          },
          async remove(key: string) {
            const changes: Record<string, { newValue?: unknown; oldValue?: unknown }> = {
              [key]: { newValue: undefined, oldValue: store.get(key) },
            };
            store.delete(key);
            for (const l of listeners) l(changes, 'sync');
          },
        },
        onChanged: {
          addListener(fn: (changes: any, area: string) => void) {
            listeners.push(fn);
          },
        },
      },
    },
    // Helper: emit a fake onChanged from another tab without going through set.
    emit(changes: any) {
      for (const l of listeners) l(changes, 'sync');
    },
    backing: store,
  };
}

describe('settings store (src/lib/storage.ts)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('hydrates from chrome.storage.sync on first import', async () => {
    const stub = makeChromeStub({ secondaryLang: 'ja', dualSubsYouTube: false });
    vi.stubGlobal('chrome', stub.chrome);
    const mod = await import('../../src/lib/storage');
    await mod.settingsReady();
    expect(mod.settings.value.secondaryLang).toBe('ja');
    expect(mod.settings.value.dualSubsYouTube).toBe(false);
    // Untouched keys fall back to defaults
    expect(mod.settings.value.dualSubsNetflix).toBe(true);
    expect(mod.settings.value.askAiProvider).toBe('chatgpt');
  });

  it('setSetting writes to chrome.storage.sync', async () => {
    const stub = makeChromeStub({});
    vi.stubGlobal('chrome', stub.chrome);
    const mod = await import('../../src/lib/storage');
    await mod.settingsReady();
    await mod.setSetting('secondaryLang', 'fr');
    expect(stub.backing.get('secondaryLang')).toBe('fr');
    expect(mod.settings.value.secondaryLang).toBe('fr');
  });

  it('onChanged events update the store live', async () => {
    const stub = makeChromeStub({ secondaryLang: 'en' });
    vi.stubGlobal('chrome', stub.chrome);
    const mod = await import('../../src/lib/storage');
    await mod.settingsReady();
    expect(mod.settings.value.secondaryLang).toBe('en');

    stub.emit({ secondaryLang: { newValue: 'de', oldValue: 'en' } });

    expect(mod.settings.value.secondaryLang).toBe('de');
  });

  it('removeSetting reverts to default and writes through', async () => {
    const stub = makeChromeStub({ secondaryLang: 'ja' });
    vi.stubGlobal('chrome', stub.chrome);
    const mod = await import('../../src/lib/storage');
    await mod.settingsReady();
    await mod.removeSetting('secondaryLang');
    expect(stub.backing.has('secondaryLang')).toBe(false);
    expect(mod.settings.value.secondaryLang).toBe('en');
  });
});
```

- [ ] **Step 1.18: Run UI tests to verify they pass**

Run: `npm run test:ui`

Expected output:

```
 ✓ tests/ui/storage.test.ts (4 tests)
   ✓ settings store (src/lib/storage.ts) > hydrates from chrome.storage.sync on first import
   ✓ settings store (src/lib/storage.ts) > setSetting writes to chrome.storage.sync
   ✓ settings store (src/lib/storage.ts) > onChanged events update the store live
   ✓ settings store (src/lib/storage.ts) > removeSetting reverts to default and writes through

 Test Files  1 passed (1)
      Tests  4 passed (4)
```

- [ ] **Step 1.19: Run vite build to verify config parses**

Run: `npm run build`

Expected output: Vite completes successfully. Since `rollupOptions.input` is `{}`, no chunks are emitted. The output may include a "no input files" warning but the exit code must be 0. If Vite exits non-zero because of the empty input, replace `input: {}` with a placeholder dummy input that emits to `dist/__placeholder.js` and add `dist/` to `.gitignore`:

```ts
input: { __placeholder: resolve(__dirname, 'src/__placeholder.ts') },
```

…and create `src/__placeholder.ts` with `export {};` (this file is deleted in Task 2 when the options entry replaces it).

If the build succeeds with empty input, prefer the empty case.

- [ ] **Step 1.20: Run node test suite once more to confirm no regression**

Run: `npm test`

Expected output: all existing node tests still pass (parsers, lemmatizer, api, grammar-glosses, cache, nnp-synthesis — exact count unchanged from Step 1.4).

- [ ] **Step 1.21: Manual Chrome verification**

1. Open `chrome://extensions`
2. Confirm learnwithsoju is loaded (or load it via "Load unpacked" pointing at `extension/`)
3. Click the reload icon for the extension
4. Open any page with Korean text
5. Hover a Korean word — confirm the popup appears and the lookup works as before
6. Open the options page — confirm it loads and renders identically to before this commit

Expected: no behavioral change. This commit only adds source and config; nothing in `extension/` was modified.

- [ ] **Step 1.22: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts \
  src/app.d.ts \
  src/types/messages.ts src/types/settings.ts src/types/overlay.ts \
  src/lib/messages.ts src/lib/storage.ts src/lib/cache.ts \
  src/lib/styles/page-shell.css \
  tests/ui/storage.test.ts \
  .gitignore
```

If Step 1.19 needed the placeholder workaround, also `git add src/__placeholder.ts`.

Commit message (HEREDOC):

```bash
git commit -m "$(cat <<'EOF'
build: add Svelte + Vite + TypeScript infrastructure

Adds package.json deps (Svelte 5, Vite 6, TS 5.x, Vitest 2.x,
@testing-library/svelte, jsdom), tsconfig.json, vite.config.ts
configured for multi-entry emit into extension/, vitest config,
and the src/types + src/lib skeleton (typed message wrappers,
reactive settings store, cache wrappers, shared page-shell tokens).

No UI surfaces migrated yet. extension/ untouched apart from
new build infrastructure files.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Run `git status` after commit to verify success (working tree clean, branch ahead of origin by 1).

---

## Task 2: Pilot — options/ migration to Svelte 5

**Goal:** Replace `extension/pages/options/options.js` (346 lines) and `options.css` (279 lines) with a Svelte 5 App + 4 child components, wire the options entry into Vite, keep behavior identical, document the build in DEVELOPMENT.md.

**Files:**
- Create: `src/pages/options/main.ts`
- Create: `src/pages/options/App.svelte`
- Create: `src/pages/options/ApiKeySection.svelte`
- Create: `src/pages/options/SubtitleSection.svelte`
- Create: `src/pages/options/AdvancedSection.svelte`
- Create: `src/pages/options/CacheSection.svelte`
- Create: `src/pages/options/styles/tokens.css`
- Create: `src/lib/askAiPrompt.ts`
- Modify: `vite.config.ts` (add options entry)
- Modify: `extension/pages/options/options.html`
- Delete: `extension/pages/options/options.js`
- Delete: `extension/pages/options/options.css`
- Create: `tests/ui/options/App.test.ts`
- Modify: `docs/DEVELOPMENT.md` (add Build section)

- [ ] **Step 2.1: Create shared askAiPrompt module**

Read `extension/pages/options/options.js` lines 14-49 to capture the `DEFAULT_ASK_AI_PROMPT` text verbatim.

Create `src/lib/askAiPrompt.ts`:

```ts
// Default Ask-AI prompt template. Mirrored from extension/content.js
// (DEFAULT_ASK_AI_PROMPT, lines 39-73) and extension/pages/options/options.js
// (DEFAULT_ASK_AI_PROMPT, lines 14-49). The three copies must stay in sync;
// content.js is plain JS so we can't share this constant across the
// JS/TS boundary without restructuring. When editing one, edit all three.
//
// Placeholders: {sentence}, {word}, {language}.

export const DEFAULT_ASK_AI_PROMPT = `You are a Korean language expert helping a {language} learner. The focus word is \`{word}\` (in backticks). The sentence is "{sentence}".

Reply in {language} using this structure. Skip a section only if it genuinely doesn't apply — never add sections, preamble, or closing remarks. Keep early sections tight; the deep dive comes at the end.

**Quick Summary**
- **Meaning here:** one short {language} sentence — what \`{word}\` means *in this specific sentence*
- **Dictionary lemma:** the base form if it differs from the surface
- **POS:** part of speech (noun, verb, adjective, particle, adverb, etc.); for verbs/adjectives include inflectional class if it matters (regular / ㅂ-irregular / ㄷ-irregular / 르-irregular / 으-stem / etc.)
- **Frequency:** Very common / Common / Uncommon / Rare — plus rough TOPIK level if you can place it
- **Register:** formal speech / polite / casual / honorific-only / written-only / slang / textbook-only — whichever applies (multiple if relevant)

**Translation**
One natural {language} sentence translation of the full input sentence.

**Breakdown**
Markdown table. Columns: Korean | Lemma | POS | Meaning. One row per surface word, left to right.

**About \`{word}\`**
- **Common usages:** 2–3 typical contexts or collocations the word appears in, each with a Korean example and one-line {language} gloss
- **Similar words:** 2–3 synonyms a native would actually use in place of \`{word}\`, with the nuance difference for each (don't just list — explain when each is preferred)
- **More natural alternatives:** if \`{word}\` is awkward, textbook-stiff, or overly formal/casual for this sentence, suggest what a native speaker would more naturally say here. If \`{word}\` is already natural, say so in one line and skip this.
- **Common forms:** for verbs/adjectives only — list the most-used conjugated forms (past, present polite, present formal, attributive (관형사형), and one or two key connectives like -아/어서 or -(으)면) with a Korean example and short gloss for each. For nouns and particles, skip this.

**Grammar of \`{word}\`** (including patterns that extend into the next word or two)
Focus on \`{word}\` first, then expand outward — Korean grammar patterns frequently span more than one word: auxiliary verb constructions (\`-아/어 보다\`, \`-아/어 주다\`, \`-고 있다\`, \`-아/어 버리다\`, \`-아/어 놓다\`), dependent-noun constructions (\`-(으)ㄴ 적이 있다\`, \`-기 때문에\`, \`-(으)ㄹ 때\`, \`-(으)ㄹ 수 있다\`), connective + auxiliary chains, and serial-verb combinations. If \`{word}\` is the stem-end of one of these, the pattern still belongs to \`{word}\` and must be explained here even though it physically continues into the next word(s). Don't treat the trailing auxiliary/dependent-noun as someone else's problem.

Cover every grammatical feature touching the focus word: morphological decomposition (stem + each suffix/auxiliary in order), tense/aspect/mood, speech level, attached particles, and every grammar pattern that starts at, terminates at, or spans \`{word}\`. For each pattern, use a sub-heading and include:
  - Pattern in code-ticks (e.g. \`-아/어 보다\`) and its literal meaning
  - The actual surface text in *this* sentence that realizes the pattern (e.g. \`가 봤어요\`) — quote it directly so the user sees where the pattern lives
  - Nuance / when a native uses it
  - One short example sentence in a different context, with its translation
  - Register or common collocations if notable

Order patterns from outermost (whole-clause level / spans multiple words) to innermost (closest to the stem). Don't skip the "obvious" ones — be thorough.

No greeting, no "let me know if...", no recap. Be ready for follow-up questions.`;
```

- [ ] **Step 2.2: Create src/pages/options/styles/tokens.css**

Create `src/pages/options/styles/tokens.css` — options-page-specific styles that don't belong in the shared shell. This file holds the `.advanced` <details> chrome and the cache-buttons layout. Both come from `extension/pages/options/options.css` lines 161-190 and 150-159.

```css
/* Options-page-specific styles (on top of page-shell.css tokens).
 * The `.advanced` <details> styling and the cache-button layout are
 * options-specific and live here rather than in page-shell.css.
 * Ported from extension/pages/options/options.css lines 150-190. */

.advanced {
  /* `details.card` — keep card chrome but reset the disclosure widget
   * so the summary feels like a section header instead of a list item. */
}
.advanced > summary {
  list-style: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  user-select: none;
}
.advanced > summary::-webkit-details-marker { display: none; }
.advanced > summary > h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.advanced > summary::before {
  content: "▸";
  color: var(--muted);
  font-size: 12px;
  transition: transform 0.15s ease;
}
.advanced[open] > summary::before {
  transform: rotate(90deg);
}
.advanced[open] > summary {
  margin-bottom: 14px;
}

.cache-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}

.cache-everything-details > summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--muted);
  margin-top: 6px;
}
.cache-everything-details > summary::-webkit-details-marker { display: none; }
.cache-everything-details[open] > summary {
  margin-bottom: 6px;
}
```

- [ ] **Step 2.3: Create src/pages/options/main.ts (mount entry)**

Create `src/pages/options/main.ts`:

```ts
import { mount } from 'svelte';
import '$lib/styles/page-shell.css';
import './styles/tokens.css';
import App from './App.svelte';

const target = document.getElementById('lws-options-root');
if (!target) {
  throw new Error('[lws] options: #lws-options-root not found');
}

mount(App, { target });
```

- [ ] **Step 2.4: Create src/pages/options/App.svelte (orchestration root)**

Create `src/pages/options/App.svelte`:

```svelte
<script lang="ts">
  import ApiKeySection from './ApiKeySection.svelte';
  import SubtitleSection from './SubtitleSection.svelte';
  import AdvancedSection from './AdvancedSection.svelte';
  import CacheSection from './CacheSection.svelte';
  import { settingsReady } from '$lib/storage';

  // Kick hydration on mount. settingsReady() is idempotent so it's safe to
  // call from anywhere; doing it here lets us surface a brief "loading…"
  // state if hydration takes longer than one paint frame.
  let ready = $state(false);
  $effect(() => {
    settingsReady().then(() => {
      ready = true;
    });
  });

  // Version pulled from the manifest at mount — used in the footer.
  let version = $state('');
  $effect(() => {
    try {
      version = `v${chrome.runtime.getManifest().version}`;
    } catch {
      version = '';
    }
  });
</script>

<main>
  <header>
    <h1>learnwithsoju</h1>
    <p class="subtitle">Korean hover dictionary — settings</p>
  </header>

  {#if !ready}
    <p class="hint">Loading settings…</p>
  {:else}
    <ApiKeySection />
    <SubtitleSection />
    <AdvancedSection />
    <CacheSection />

    <footer>
      <p>
        Source &amp; issues:
        <a href="https://github.com/abishake/learnwithsoju" target="_blank" rel="noreferrer">github.com/abishake/learnwithsoju</a>
      </p>
      <p class="version">{version}</p>
    </footer>
  {/if}
</main>
```

- [ ] **Step 2.5: Create src/pages/options/ApiKeySection.svelte**

Create `src/pages/options/ApiKeySection.svelte`:

```svelte
<script lang="ts">
  import { settings, setSetting } from '$lib/storage';

  let statusText = $state('');
  let statusKind = $state<'' | 'ok' | 'err'>('');
  let statusTimer: ReturnType<typeof setTimeout> | null = null;

  function setStatus(text: string, kind: '' | 'ok' | 'err' = '') {
    statusText = text;
    statusKind = kind;
    if (statusTimer) clearTimeout(statusTimer);
    if (text && kind) {
      statusTimer = setTimeout(() => {
        if (statusText === text) {
          statusText = '';
          statusKind = '';
        }
      }, 4000);
    }
  }

  // The Save button persists both keys atomically. The KRDict key is the
  // hot path (every lookup), so we surface success/error inline rather than
  // saving on every keystroke.
  async function save() {
    try {
      await setSetting('krdictApiKey', settings.value.krdictApiKey.trim());
      await setSetting('opendictApiKey', settings.value.opendictApiKey.trim());
      setStatus('Saved.', 'ok');
    } catch (err) {
      console.warn('[lws] options ApiKeySection: save failed', err);
      setStatus(`Save failed: ${(err as Error).message || err}`, 'err');
    }
  }

  // Live test against the KRDict API — same query options.js used previously.
  async function testKrdict() {
    const key = settings.value.krdictApiKey.trim();
    if (!key) {
      setStatus('Enter a KRDict key first.', 'err');
      return;
    }
    setStatus('Testing…', '');
    try {
      const url = new URL('https://krdict.korean.go.kr/api/search');
      url.searchParams.set('key', key);
      url.searchParams.set('q', '사람');
      url.searchParams.set('part', 'word');
      url.searchParams.set('translated', 'y');
      url.searchParams.set('trans_lang', '1');
      // KRDict requires num >= 10; sending 1 gets an "invalid num" error.
      url.searchParams.set('num', '10');
      const res = await fetch(url.toString());
      const text = await res.text();
      if (/<error[\s>]/i.test(text)) {
        const codeMatch = text.match(/<error_code>(.*?)<\/error_code>/);
        const msgMatch = text.match(/<message>(.*?)<\/message>/);
        setStatus(`Error ${codeMatch ? codeMatch[1] : '?'}: ${msgMatch ? msgMatch[1] : 'unknown'}`, 'err');
        return;
      }
      if (/<item[\s>]/i.test(text)) {
        setStatus('Key works ✓', 'ok');
      } else {
        setStatus('Got a response but no items — key may still be valid.', 'ok');
      }
    } catch (err) {
      setStatus(`Network error: ${(err as Error).message || err}`, 'err');
    }
  }
</script>

<section class="card">
  <h2>API keys</h2>
  <p class="hint">
    Both APIs are free. The same NIKL account can register both.
    Keys are stored locally in <code>chrome.storage.sync</code> and never sent anywhere except the dictionary servers themselves.
  </p>

  <label class="field">
    <span class="label">KRDict API key <span class="required">required</span></span>
    <input
      type="password"
      autocomplete="off"
      spellcheck="false"
      placeholder="Paste your KRDict key"
      bind:value={settings.value.krdictApiKey}
    />
    <a class="field-link" href="https://krdict.korean.go.kr/eng/openApi/openApiRegister" target="_blank" rel="noreferrer">
      Get a key →
    </a>
  </label>

  <label class="field">
    <span class="label">
      OpenDict API key
      <span class="optional">optional</span>
      <span class="experimental" title="OpenDict integration is experimental — coverage and quality may vary.">experimental</span>
    </span>
    <input
      type="password"
      autocomplete="off"
      spellcheck="false"
      placeholder="Paste your OpenDict key (used as fallback when KRDict has no entry)"
      bind:value={settings.value.opendictApiKey}
    />
    <a class="field-link" href="https://opendict.korean.go.kr/service/openApiRegister" target="_blank" rel="noreferrer">
      Get a key →
    </a>
    <p class="field-note">
      ⚠ OpenDict registration may require a Korean phone number for SMS verification.
      Used only when KRDict returns no result; community-edited dictionary, so quality varies.
    </p>
  </label>

  <div class="actions">
    <button type="button" class="primary" onclick={save}>Save</button>
    <button type="button" onclick={testKrdict}>Test KRDict key</button>
    <span class="status {statusKind}" aria-live="polite">{statusText}</span>
  </div>
</section>
```

- [ ] **Step 2.6: Create src/pages/options/SubtitleSection.svelte**

Create `src/pages/options/SubtitleSection.svelte` — toggles + secondary-language dropdown. The 19 dropdown options are lifted verbatim from `extension/pages/options/options.html` lines 72-90.

```svelte
<script lang="ts">
  import { settings, setSetting } from '$lib/storage';

  const SECONDARY_LANG_OPTIONS: Array<{ value: string; label: string }> = [
    { value: 'en', label: 'English' },
    { value: 'ja', label: 'Japanese' },
    { value: 'zh', label: 'Chinese (Simplified)' },
    { value: 'zh-TW', label: 'Chinese (Traditional)' },
    { value: 'es', label: 'Spanish' },
    { value: 'fr', label: 'French' },
    { value: 'de', label: 'German' },
    { value: 'it', label: 'Italian' },
    { value: 'pt', label: 'Portuguese' },
    { value: 'ru', label: 'Russian' },
    { value: 'ar', label: 'Arabic' },
    { value: 'hi', label: 'Hindi' },
    { value: 'id', label: 'Indonesian' },
    { value: 'vi', label: 'Vietnamese' },
    { value: 'th', label: 'Thai' },
    { value: 'tr', label: 'Turkish' },
    { value: 'nl', label: 'Dutch' },
    { value: 'pl', label: 'Polish' },
    { value: 'off', label: 'Off (Korean only)' },
  ];

  async function onYouTubeToggle(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).checked;
    await setSetting('dualSubsYouTube', v);
  }

  async function onNetflixToggle(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).checked;
    await setSetting('dualSubsNetflix', v);
  }

  async function onSecondaryLangChange(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    await setSetting('secondaryLang', v);
  }
</script>

<section class="card">
  <h2>Behaviour</h2>
  <label class="checkbox">
    <input type="checkbox" checked={settings.value.dualSubsYouTube} onchange={onYouTubeToggle} />
    <span>Dual subtitles on YouTube
      <em class="note">replaces YouTube's captions with a Korean + secondary-language overlay</em>
    </span>
  </label>

  <label class="checkbox">
    <input type="checkbox" checked={settings.value.dualSubsNetflix} onchange={onNetflixToggle} />
    <span>Dual subtitles on Netflix
      <em class="note">replaces Netflix's captions with a Korean + secondary-language overlay</em>
    </span>
  </label>

  <label class="field">
    <span class="label">Default secondary subtitle language</span>
    <select value={settings.value.secondaryLang} onchange={onSecondaryLangChange}>
      {#each SECONDARY_LANG_OPTIONS as opt (opt.value)}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
    <p class="field-note">
      The toolbar popup lets you override this per-video (YouTube) or per-title (Netflix) when more than one secondary track is available.
    </p>
  </label>
</section>
```

- [ ] **Step 2.7: Create src/pages/options/AdvancedSection.svelte**

Create `src/pages/options/AdvancedSection.svelte` — AI provider select, Ask-AI prompt textarea, ChatGPT-temporary toggle, morpheme-inspector link. The AI provider list is loaded dynamically from `extension/core/ai-providers.js` via `chrome.runtime.getURL` (as in the original options.js).

```svelte
<script lang="ts">
  import { settings, setSetting, removeSetting } from '$lib/storage';
  import { DEFAULT_ASK_AI_PROMPT } from '$lib/askAiPrompt';

  type ProviderEntry = { key: string; name: string };
  let providers = $state<ProviderEntry[]>([]);
  let promptStatus = $state('');
  let promptStatusKind = $state<'' | 'ok' | 'err'>('');
  let promptStatusTimer: ReturnType<typeof setTimeout> | null = null;

  // The morpheme inspector link can't be baked at build time — chrome.runtime.getURL
  // depends on the runtime extension ID.
  let inspectorUrl = $state('#');
  $effect(() => {
    try {
      inspectorUrl = chrome.runtime.getURL('pages/morpheme-inspector/morpheme-inspector.html');
    } catch {
      inspectorUrl = '#';
    }
  });

  // Load the provider list once on mount. Dynamic import via chrome.runtime.getURL
  // — same pattern as the original options.js (loads from extension/core/ai-providers.js).
  $effect(() => {
    (async () => {
      try {
        const url = chrome.runtime.getURL('core/ai-providers.js');
        const mod = await import(/* @vite-ignore */ url);
        const list: ProviderEntry[] = [];
        const dict = mod.AI_PROVIDERS || {};
        for (const [key, def] of Object.entries(dict)) {
          list.push({ key, name: (def as any).name || key });
        }
        providers = list;
        // Force the stored provider to a known one if the current value isn't valid.
        const fallback = mod.DEFAULT_ASK_AI_PROVIDER || list[0]?.key;
        if (fallback && !dict[settings.value.askAiProvider]) {
          await setSetting('askAiProvider', fallback);
        }
      } catch (err) {
        console.warn('[lws] options AdvancedSection: failed to load ai-providers.js', err);
      }
    })();
  });

  function setPromptStatus(text: string, kind: '' | 'ok' | 'err') {
    promptStatus = text;
    promptStatusKind = kind;
    if (promptStatusTimer) clearTimeout(promptStatusTimer);
    if (text && kind) {
      promptStatusTimer = setTimeout(() => {
        if (promptStatus === text) {
          promptStatus = '';
          promptStatusKind = '';
        }
      }, 2500);
    }
  }

  async function onProviderChange(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    await setSetting('askAiProvider', v);
  }

  async function onChatGptTempToggle(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).checked;
    await setSetting('askAiChatGptTemporary', v);
  }

  // On blur (change), persist the prompt. Empty value or value equal to the
  // default → remove the storage key so a future default change re-applies.
  async function onPromptChange(e: Event) {
    const v = (e.currentTarget as HTMLTextAreaElement).value.trim();
    try {
      if (!v || v === DEFAULT_ASK_AI_PROMPT) {
        await removeSetting('askAiPrompt');
        setPromptStatus('Reset to default.', 'ok');
      } else {
        await setSetting('askAiPrompt', v);
        setPromptStatus('Saved.', 'ok');
      }
    } catch (err) {
      console.warn('[lws] options AdvancedSection: prompt save failed', err);
      setPromptStatus(`Save failed: ${(err as Error).message || err}`, 'err');
    }
  }

  async function resetPrompt() {
    await removeSetting('askAiPrompt');
    setPromptStatus('Reset to default.', 'ok');
  }

  // Derived: effective prompt text shown in the textarea — current setting
  // if non-empty, else the default.
  let displayedPrompt = $derived(
    settings.value.askAiPrompt && settings.value.askAiPrompt.length > 0
      ? settings.value.askAiPrompt
      : DEFAULT_ASK_AI_PROMPT
  );

  let isChatGpt = $derived(settings.value.askAiProvider === 'chatgpt');
</script>

<details class="card advanced">
  <summary><h2>Advanced</h2></summary>
  <p class="hint">
    Power-user settings. Defaults are sensible — tweak only if you know what you want.
  </p>

  <label class="field">
    <span class="label">AI service for "Ask AI" pill</span>
    <select value={settings.value.askAiProvider} onchange={onProviderChange}>
      {#each providers as p (p.key)}
        <option value={p.key}>{p.name}</option>
      {/each}
    </select>
    <p class="field-note">
      The pill opens this service in a new tab with the prompt below pre-filled.
    </p>
  </label>

  {#if isChatGpt}
    <label class="checkbox">
      <input type="checkbox" checked={settings.value.askAiChatGptTemporary} onchange={onChatGptTempToggle} />
      <span>Use temporary (ephemeral) ChatGPT chats
        <em class="note">appends <code>?temporary-chat=true</code> — chats aren't saved to history</em>
      </span>
    </label>
  {/if}

  <label class="field">
    <span class="label">"Ask AI" prompt template</span>
    <textarea
      spellcheck="false"
      rows="8"
      placeholder="Click Reset to load the default template."
      value={displayedPrompt}
      onchange={onPromptChange}
    ></textarea>
    <p class="field-note">
      Placeholders (substituted before opening the AI service):
      <code>{'{sentence}'}</code> the sentence with the focus word wrapped in backticks ·
      <code>{'{word}'}</code> just the focus word ·
      <code>{'{language}'}</code> your secondary-language name (e.g. "English").
    </p>
    <div class="actions">
      <button type="button" onclick={resetPrompt}>Reset to default</button>
      <span class="status {promptStatusKind}" aria-live="polite">{promptStatus}</span>
    </div>
  </label>

  <label class="field">
    <span class="label">Morpheme inspector</span>
    <p class="field-note">
      A developer/curious-learner tool. Tokenize Korean text and see every mecab field — POS tags, type, decomposition, n-best paths, and the lemma candidates that feed KRDict.
    </p>
    <a class="field-link" href={inspectorUrl} target="_blank" rel="noopener noreferrer">Open morpheme inspector →</a>
  </label>
</details>
```

- [ ] **Step 2.8: Create src/pages/options/CacheSection.svelte**

Create `src/pages/options/CacheSection.svelte` — 3 clear buttons + live counts:

```svelte
<script lang="ts">
  import { getCounts, clear } from '$lib/cache';
  import type { CacheCounts, ClearCacheTarget } from '$types/messages';

  let counts = $state<CacheCounts | null>(null);
  let statusText = $state('');
  let statusKind = $state<'' | 'ok' | 'err'>('');
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let busy = $state(false);

  const LABELS: Record<'lookup' | 'hanja' | 'all', string> = {
    lookup: 'Clear lookup results',
    hanja: 'Clear Hanja meanings',
    all: 'Clear everything incl. dict',
  };
  const SUCCESS: Record<'lookup' | 'hanja' | 'all', string> = {
    lookup: 'Lookup cache cleared.',
    hanja: 'Hanja cache cleared.',
    all: 'All caches cleared.',
  };

  function setStatus(text: string, kind: '' | 'ok' | 'err' = '') {
    statusText = text;
    statusKind = kind;
    if (statusTimer) clearTimeout(statusTimer);
    if (text && kind === 'ok') {
      statusTimer = setTimeout(() => {
        if (statusText === text) {
          statusText = '';
          statusKind = '';
        }
      }, 3000);
    }
  }

  async function refresh() {
    const c = await getCounts();
    counts = c;
  }

  // Initial load — runs once on mount.
  $effect(() => {
    refresh();
  });

  async function clearTarget(target: ClearCacheTarget) {
    if (busy) return;
    busy = true;
    setStatus('Clearing…', '');
    try {
      const res = await clear(target);
      const label = target === 'dict' ? 'all' : target;
      if (res.ok) {
        setStatus(SUCCESS[label as 'lookup' | 'hanja' | 'all'], 'ok');
      } else {
        setStatus(`Error: ${res.error || 'unknown'}`, 'err');
      }
    } finally {
      busy = false;
      await refresh();
    }
  }

  // Label includes the live count when known.
  let lookupLabel = $derived(
    counts && counts.lookup != null
      ? `${LABELS.lookup} (~${counts.lookup})`
      : LABELS.lookup
  );
  let hanjaLabel = $derived(
    counts && counts.hanja != null
      ? `${LABELS.hanja} (~${counts.hanja})`
      : LABELS.hanja
  );
  let allLabel = $derived(
    counts
      ? `${LABELS.all} (~${(counts.lookup ?? 0) + (counts.hanja ?? 0) + (counts.krdict ?? 0) + (counts.opendict ?? 0)})`
      : LABELS.all
  );
</script>

<section class="card">
  <h2>Cache</h2>
  <p class="hint">
    Lookup results store the full tokenized+grouped output per hovered surface
    form. Dict XMLs are raw API responses (expensive to refetch). Hanja meanings
    are pulled from hangulhanja.com.
  </p>
  <div class="cache-buttons">
    <button type="button" disabled={busy} onclick={() => clearTarget('lookup')}>{lookupLabel}</button>
    <button type="button" disabled={busy} onclick={() => clearTarget('hanja')}>{hanjaLabel}</button>
    <details class="cache-everything-details">
      <summary>More options</summary>
      <button type="button" disabled={busy} onclick={() => clearTarget('all')}>{allLabel}</button>
    </details>
  </div>
  <span class="status {statusKind}" aria-live="polite">{statusText}</span>
</section>
```

- [ ] **Step 2.9: Update vite.config.ts to add options entry**

Modify `vite.config.ts` — replace the empty `input: {}` block (or the placeholder from Step 1.19) with a real entry. Also configure the rollup output so the bundle lands at `extension/pages/options/main.js` rather than `extension/pages-options/main.js`.

The challenge: rollup's `entryFileNames: '[name]/main.js'` only produces flat top-level dirs. To emit into the nested `pages/options/` path, we set the input key to the full subpath (`pages/options/options`) and adjust `entryFileNames` to use the input key as a path.

Replace the `build.rollupOptions` block with:

```ts
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
```

Note: the `assetFileNames` hardcoded path works only because options is the sole entry. Tasks 3, 4, 5 will refactor this into a per-surface mapping. For now, keep it hardcoded.

If the placeholder from Step 1.19 was added, also delete `src/__placeholder.ts` here.

- [ ] **Step 2.10: Run build to verify output path**

Run: `npm run build`

Expected output: build succeeds. Verify:

```bash
ls extension/pages/options/main.js extension/pages/options/main.css
```

Both files exist.

- [ ] **Step 2.11: Rewrite extension/pages/options/options.html**

Replace `extension/pages/options/options.html` with:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>learnwithsoju — Settings</title>
  <link rel="stylesheet" href="main.css" />
</head>
<body>
  <div id="lws-options-root"></div>
  <script type="module" src="./main.js"></script>
</body>
</html>
```

- [ ] **Step 2.12: Delete the old options.js and options.css**

```bash
git rm extension/pages/options/options.js extension/pages/options/options.css
```

- [ ] **Step 2.13: Create tests/ui/options/App.test.ts**

Run: `mkdir -p tests/ui/options`

Create `tests/ui/options/App.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

function makeChromeStub(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const listeners: Array<(changes: any, area: string) => void> = [];
  return {
    chrome: {
      storage: {
        sync: {
          async get(keys: any) {
            if (keys === null || keys === undefined) return Object.fromEntries(store);
            const arr = Array.isArray(keys) ? keys : [keys];
            const out: Record<string, unknown> = {};
            for (const k of arr) if (store.has(k)) out[k] = store.get(k);
            return out;
          },
          async set(obj: Record<string, unknown>) {
            const changes: Record<string, any> = {};
            for (const [k, v] of Object.entries(obj)) {
              changes[k] = { newValue: v, oldValue: store.get(k) };
              store.set(k, v);
            }
            for (const l of listeners) l(changes, 'sync');
          },
          async remove(key: string) {
            const changes = { [key]: { newValue: undefined, oldValue: store.get(key) } };
            store.delete(key);
            for (const l of listeners) l(changes, 'sync');
          },
        },
        onChanged: {
          addListener(fn: any) { listeners.push(fn); },
        },
      },
      runtime: {
        sendMessage: vi.fn(async (msg: any) => {
          if (msg.type === 'cacheCounts') {
            return { ok: true, counts: { lookup: 12, hanja: 3, krdict: 100, opendict: 0 } };
          }
          if (msg.type === 'clearCache') {
            return { ok: true, cleared: { [msg.target]: true } };
          }
          return { ok: true };
        }),
        getManifest: () => ({ version: '0.1.0' }),
        getURL: (p: string) => `chrome-extension://test/${p}`,
        openOptionsPage: vi.fn(),
      },
    },
    backing: store,
  };
}

describe('options App.svelte', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('renders the 4 sections after settings hydrate', async () => {
    const stub = makeChromeStub({ krdictApiKey: 'abc', secondaryLang: 'ja' });
    vi.stubGlobal('chrome', stub.chrome);
    const { default: App } = await import('../../../src/pages/options/App.svelte');
    render(App);
    // Allow the hydration $effect to flush and the loading state to clear.
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByText('API keys')).toBeTruthy();
    expect(screen.getByText('Behaviour')).toBeTruthy();
    expect(screen.getByText('Cache')).toBeTruthy();
  });

  it('KRDict input reflects the settings store and writes back on Save', async () => {
    const stub = makeChromeStub({ krdictApiKey: 'initial' });
    vi.stubGlobal('chrome', stub.chrome);
    const { default: App } = await import('../../../src/pages/options/App.svelte');
    render(App);
    await new Promise((r) => setTimeout(r, 10));
    const inputs = document.querySelectorAll('input[type=password]');
    // First input is KRDict.
    const krInput = inputs[0] as HTMLInputElement;
    expect(krInput.value).toBe('initial');
    // Edit then save.
    await fireEvent.input(krInput, { target: { value: 'new-key' } });
    const saveBtn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save'
    ) as HTMLButtonElement;
    await fireEvent.click(saveBtn);
    await new Promise((r) => setTimeout(r, 10));
    expect(stub.backing.get('krdictApiKey')).toBe('new-key');
  });

  it('secondary-language dropdown writes through on change', async () => {
    const stub = makeChromeStub({ secondaryLang: 'en' });
    vi.stubGlobal('chrome', stub.chrome);
    const { default: App } = await import('../../../src/pages/options/App.svelte');
    render(App);
    await new Promise((r) => setTimeout(r, 10));
    const select = document.querySelector('select') as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: 'fr' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(stub.backing.get('secondaryLang')).toBe('fr');
  });

  it('cache section populates counts and clears on click', async () => {
    const stub = makeChromeStub({});
    vi.stubGlobal('chrome', stub.chrome);
    const { default: App } = await import('../../../src/pages/options/App.svelte');
    render(App);
    await new Promise((r) => setTimeout(r, 20));
    // Lookup clear button shows the count (~12) from the cacheCounts stub.
    const clearLookup = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.startsWith('Clear lookup results')
    ) as HTMLButtonElement;
    expect(clearLookup.textContent).toContain('~12');
    await fireEvent.click(clearLookup);
    await new Promise((r) => setTimeout(r, 10));
    // The stub recorded a clearCache message with target='lookup'.
    const sendMessage = (chrome as any).runtime.sendMessage as ReturnType<typeof vi.fn>;
    const clearCalls = sendMessage.mock.calls.filter(
      ([m]: any) => m.type === 'clearCache' && m.target === 'lookup'
    );
    expect(clearCalls.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2.14: Run UI tests**

Run: `npm run test:ui`

Expected output: 4 tests in `storage.test.ts` + 4 tests in `options/App.test.ts` all pass.

```
 Test Files  2 passed (2)
      Tests  8 passed (8)
```

- [ ] **Step 2.15: Run node tests**

Run: `npm test`

Expected output: original 6 test files still pass; total test count unchanged from Task 1.

- [ ] **Step 2.16: Document the build in DEVELOPMENT.md**

Read `DEVELOPMENT.md` (or `docs/DEVELOPMENT.md` if it lives there) to find the right section. If a top-level `## Build` or `## Development` heading doesn't exist, add a new top-level section before the existing content. If one exists, append the Svelte/Vite info to it.

Add this section:

```markdown
## Build (Svelte / Vite)

The extension's UI (4 pages and the in-page overlay) is built from
Svelte + TypeScript sources under `src/` and emitted into `extension/`.
Vendor JS in `extension/` (background.js, content.js, adapters, mecab-ko)
is plain JS and untouched by the build.

### Scripts

| Script | Purpose |
|---|---|
| `npm run build` | One-shot Vite build, emits `extension/<surface>/main.js` |
| `npm run dev` | Vite build in `--watch` mode (rebuilds on source change) |
| `npm test` | Node test harness — covers plain-JS code in `extension/` |
| `npm run test:ui` | Vitest — covers Svelte components and `src/lib` |
| `npm run package:chrome` | Zip extension/ for Chrome Web Store submission |
| `npm run package:firefox` | Zip extension/ for AMO submission |
| `npm run package` | Both store zips |

### Source layout

```
src/
├── types/        Shared TS types (message contracts, settings schema, overlay payload)
├── lib/          Reusable modules — typed message wrappers, settings store, cache helpers
│   └── styles/   Shared page-shell tokens (CSS variables + base form styles)
├── pages/        One subfolder per extension page (options, notepad, etc.)
└── overlay/      In-page shadow-DOM lookup popup
```

### Build output

Bundles land at:

- `extension/pages/<surface>/main.js` + `main.css` for the 4 pages
- `extension/overlay/main.js` + `main.css` for the in-page overlay

These files are committed to git so the extension stays loadable from
`extension/` without a build step. After editing any `src/` file, run
`npm run build` (or `npm run dev`) and commit both the source change
and the regenerated bundle.
```

- [ ] **Step 2.17: Verify build output is fresh after the rewrite**

Run: `npm run build`

Expected: rebuild succeeds. `git status` shows `extension/pages/options/main.js` and `extension/pages/options/main.css` as modified (the freshly-emitted bundle reflects the current sources).

- [ ] **Step 2.18: Manual Chrome verification**

1. Open `chrome://extensions`
2. Click "Reload" on learnwithsoju
3. Click "Details" → "Extension options"
4. Verify the page renders identically: 4 sections, "Save"/"Test KRDict key" buttons, dual-subs toggles, secondary-lang dropdown, Advanced disclosure, cache buttons with live counts.
5. Edit the KRDict key, click Save — confirm "Saved." appears. Reload the options page — confirm the new value persisted.
6. Toggle "Dual subtitles on YouTube" — confirm no error. Reload — confirm the toggle state persisted.
7. Change the secondary language — confirm it persists on reload.
8. Click "Test KRDict key" with no key — confirm error appears. With a real key — confirm "Key works ✓".
9. Open the Advanced disclosure — confirm AI provider dropdown loads, prompt textarea shows the default text, "Reset to default" works.
10. Click each cache-clear button — confirm "Cache cleared" appears and the count number updates.
11. Click "Open morpheme inspector" link — confirm a new tab opens to the inspector.

No console errors expected in the options-page DevTools.

- [ ] **Step 2.19: Commit**

```bash
git add package.json package-lock.json vite.config.ts \
  src/lib/askAiPrompt.ts \
  src/pages/options/main.ts \
  src/pages/options/App.svelte \
  src/pages/options/ApiKeySection.svelte \
  src/pages/options/SubtitleSection.svelte \
  src/pages/options/AdvancedSection.svelte \
  src/pages/options/CacheSection.svelte \
  src/pages/options/styles/tokens.css \
  extension/pages/options/options.html \
  extension/pages/options/main.js \
  extension/pages/options/main.css \
  tests/ui/options/App.test.ts \
  DEVELOPMENT.md
```

(If `DEVELOPMENT.md` is at `docs/DEVELOPMENT.md`, adjust the path. If the placeholder from Step 1.19 was used and removed in Step 2.9, also `git rm src/__placeholder.ts`.)

If sourcemap files (`main.js.map`, `main.css.map`) were emitted, add them too — or set `build.sourcemap: false` in vite.config.ts and rebuild.

Commit (deletion of old files was already staged in Step 2.12):

```bash
git commit -m "$(cat <<'EOF'
options: migrate to Svelte 5

Replaces options.js (346L) and options.css (279L) with a Svelte 5
App.svelte + 4 child components (ApiKeySection, SubtitleSection,
AdvancedSection, CacheSection). Settings flow through the reactive
store in src/lib/storage.ts; messages flow through the typed wrappers
in src/lib/messages.ts.

options.html keeps its existing path; <body> reduced to a mount-point
div + module script tag. Build output committed at
extension/pages/options/main.js.

DEVELOPMENT.md updated with the new build workflow.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: notepad/ migration to Svelte 5

**Goal:** Replace `extension/pages/notepad/notepad.js` (21 lines) and the inline styles in `notepad.html` with a Svelte 5 App + HoverableTarget component, leaving the content.js wrap-on-mutation pipeline untouched (it still scans the `<div id="notepad-target">` because the new component keeps the same id + class).

**Files:**
- Create: `src/pages/notepad/main.ts`
- Create: `src/pages/notepad/App.svelte`
- Create: `src/pages/notepad/HoverableTarget.svelte`
- Create: `src/pages/notepad/styles/tokens.css`
- Modify: `vite.config.ts` (add notepad entry, refactor assetFileNames)
- Modify: `extension/pages/notepad/notepad.html`
- Delete: `extension/pages/notepad/notepad.js`

- [ ] **Step 3.1: Inspect current notepad behavior**

Read `extension/pages/notepad/notepad.html` and `notepad.js` to confirm:

- Textarea with id `notepad-input`
- Target div with id `notepad-target`, class `notepad-target lws-sentence-root`, aria-live="polite"
- 150 ms debounce from `input` to `target.textContent = value`
- content.js loaded after notepad.js as `<script src="../../content.js"></script>`
- content.css loaded for `.lws-word` underline styling

These behaviors must all survive the migration. The component owns the target div — content.js's mutation observer will see it and start wrapping immediately.

- [ ] **Step 3.2: Refactor vite.config.ts to support multiple page entries cleanly**

Replace the entire `vite.config.ts` with this multi-entry-friendly version (Tasks 4 and 5 will add their entries to the same `INPUT_MAP`):

```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

// Each entry key encodes the output subpath under extension/. So 'pages/options/options'
// emits to extension/pages/options/main.js, and 'overlay/overlay' emits to extension/overlay/main.js.
//
// Convention: key = '<dir>/<basename>' where <basename> matches the trailing path segment
// of <dir>. The emit hook below strips the trailing basename to compute the output dir.
const INPUT_MAP: Record<string, string> = {
  'pages/options/options': resolve(__dirname, 'src/pages/options/main.ts'),
  'pages/notepad/notepad': resolve(__dirname, 'src/pages/notepad/main.ts'),
};

function entryDir(name: string): string {
  const parts = name.split('/');
  parts.pop();
  return parts.join('/');
}

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: 'extension',
    emptyOutDir: false,
    assetsDir: '',
    cssCodeSplit: true,
    sourcemap: false,
    rollupOptions: {
      input: INPUT_MAP,
      output: {
        entryFileNames: (chunk) => `${entryDir(chunk.name)}/main.js`,
        chunkFileNames: (chunk) => `${entryDir(chunk.name || 'shared') || 'shared'}/[name]-[hash].js`,
        // CSS assets — Vite emits one per entry that imports CSS. The asset
        // name is derived from the entry name; we route the css to the same
        // dir as the entry's main.js.
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name || '';
          if (!name.endsWith('.css')) return '[name][extname]';
          // The asset's source file path tells us which entry it belongs to.
          // For Svelte/Vite, the css asset name matches the entry key's basename.
          // We map the basename back to its dir using INPUT_MAP keys.
          const base = name.replace(/\.css$/, '');
          for (const key of Object.keys(INPUT_MAP)) {
            const keyParts = key.split('/');
            if (keyParts[keyParts.length - 1] === base) {
              return `${entryDir(key)}/main.css`;
            }
          }
          // Fallback — emit at root with original name.
          return name;
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
```

Note: `sourcemap: false` is intentional — sourcemap files would pollute the committed `extension/` tree. Reviewers needing them can flip to `true` locally.

- [ ] **Step 3.3: Create src/pages/notepad/styles/tokens.css**

Read `extension/pages/notepad/notepad.html` lines 13-30 to capture the `.notepad-target` style. Create `src/pages/notepad/styles/tokens.css`:

```css
/* Notepad-specific styles on top of page-shell.css.
 * The `.notepad-target` block holds the committed text and supplies the
 * `.lws-word` underline anchor surface. `pre-wrap` preserves paste
 * formatting; min-height keeps the empty state stable. Ported from
 * extension/pages/notepad/notepad.html lines 13-30. */

.notepad-target {
  white-space: pre-wrap;
  font-size: 16px;
  line-height: 1.7;
  padding: 16px;
  min-height: 100px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg);
}
```

- [ ] **Step 3.4: Create src/pages/notepad/main.ts**

Create `src/pages/notepad/main.ts`:

```ts
import { mount } from 'svelte';
import '$lib/styles/page-shell.css';
import './styles/tokens.css';
import App from './App.svelte';

const target = document.getElementById('lws-notepad-root');
if (!target) {
  throw new Error('[lws] notepad: #lws-notepad-root not found');
}

mount(App, { target });
```

- [ ] **Step 3.5: Create src/pages/notepad/HoverableTarget.svelte**

Create `src/pages/notepad/HoverableTarget.svelte`. The component renders the target div with the exact id + class the original page used, so content.js's mutation observer sees it unchanged and wraps Korean text as before.

```svelte
<script lang="ts">
  // The hoverable target — content.js's mutation observer treats any text
  // added under this div as wrappable. `lws-sentence-root` is a hard ceiling
  // for the sentence extraction walk-up (see content.js extractSentence) so
  // sibling instruction text in the page doesn't leak into the sentence
  // context.
  //
  // The textContent is set by the parent App.svelte via the `text` prop.
  // We render it inside a {#key} block so Svelte rebuilds the entire div
  // when text changes — that way content.js's MutationObserver sees a fresh
  // text node and re-wraps it cleanly (no stale .lws-word spans left over).
  //
  // We bypass Svelte's normal text reactivity (e.g. `{text}`) for one
  // reason: when text changes from "안녕" → "안녕하세요", Svelte's diff
  // updates the text content of the existing span, which would not invalidate
  // the existing .lws-word spans that content.js wrapped earlier. Forcing a
  // full re-render via {#key text} guarantees the wrap pipeline restarts.

  let { text }: { text: string } = $props();
</script>

{#key text}
  <div
    id="notepad-target"
    class="notepad-target lws-sentence-root"
    aria-live="polite"
  >{text}</div>
{/key}
```

- [ ] **Step 3.6: Create src/pages/notepad/App.svelte**

Create `src/pages/notepad/App.svelte`:

```svelte
<script lang="ts">
  import HoverableTarget from './HoverableTarget.svelte';

  let inputText = $state('');
  let committedText = $state('');
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let textareaEl: HTMLTextAreaElement | undefined;

  // 150 ms debounce so each keystroke doesn't trigger a content.js
  // re-wrap pass — matches the original notepad.js behaviour.
  function onInput(e: Event) {
    inputText = (e.currentTarget as HTMLTextAreaElement).value;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      committedText = inputText;
    }, 150);
  }

  // Autofocus the textarea so the user can paste immediately on landing.
  $effect(() => {
    textareaEl?.focus();
  });
</script>

<main>
  <header>
    <h1>Notepad</h1>
    <p class="subtitle">Paste Korean text and hover any word to look it up.</p>
  </header>

  <section class="card">
    <label class="field">
      <span class="label">Paste text</span>
      <textarea
        bind:this={textareaEl}
        rows="8"
        spellcheck="false"
        placeholder="Paste Korean text here — it becomes hoverable as you type."
        value={inputText}
        oninput={onInput}
      ></textarea>
    </label>
  </section>

  <section class="card">
    <h2>Hoverable text</h2>
    <p class="hint">Korean words below are hoverable — the same dictionary popup you get on any webpage.</p>
    <HoverableTarget text={committedText} />
  </section>
</main>
```

- [ ] **Step 3.7: Rewrite extension/pages/notepad/notepad.html**

Replace `extension/pages/notepad/notepad.html` with:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>learnwithsoju — Notepad</title>
  <link rel="stylesheet" href="main.css" />
  <!-- content.css supplies the `.lws-word` underline + cursor on the
       hoverable target. content.js (loaded below) drives the mutation
       observer that wraps each Korean run into a `.lws-word` span when
       App.svelte writes new text into the target div. -->
  <link rel="stylesheet" href="../../content.css" />
</head>
<body>
  <div id="lws-notepad-root"></div>
  <script type="module" src="./main.js"></script>
  <!-- content.js runs as a chrome content_script on every webpage; we
       also load it here so the notepad target can reuse its full
       hover-popup pipeline (mecab tokenization, KRDict fetch,
       Shadow-DOM popup with tabs / morpheme breakdown / Hanja / Ask
       AI). It self-initialises, scans `document.body` for Korean,
       wraps `.lws-word` spans, and listens for clicks — same as on
       any other page. -->
  <script src="../../content.js"></script>
</body>
</html>
```

- [ ] **Step 3.8: Delete the old notepad.js**

```bash
git rm extension/pages/notepad/notepad.js
```

- [ ] **Step 3.9: Build**

Run: `npm run build`

Expected: build succeeds. Verify both files exist:

```bash
ls extension/pages/notepad/main.js extension/pages/notepad/main.css
```

- [ ] **Step 3.10: Run UI tests**

Run: `npm run test:ui`

Expected output: previous 8 tests still pass.

```
 Test Files  2 passed (2)
      Tests  8 passed (8)
```

- [ ] **Step 3.11: Run node tests**

Run: `npm test`

Expected: all existing node tests pass; count unchanged from Task 1.

- [ ] **Step 3.12: Manual Chrome verification**

1. Reload the extension at `chrome://extensions`
2. Navigate to `chrome-extension://<your-id>/pages/notepad/notepad.html` (or open it via the toolbar popup's notepad icon)
3. Confirm: textarea on top, "Hoverable text" card below with empty target div
4. Paste this Korean sentence: `오늘 학교에 갔어요`
5. Within ~150 ms, the bottom card should show `오늘 학교에 갔어요` with each Korean word underlined (the `.lws-word` style)
6. Hover `학교` — confirm the dictionary popup appears (this verifies content.js's mutation observer wrapped the new text correctly)
7. Type additional text into the textarea — confirm the hoverable target updates live (debounced)
8. Hover a word in the newly-added text — confirm the lookup still works (no stale wrap-state)

No console errors expected.

- [ ] **Step 3.13: Commit**

```bash
git add package.json package-lock.json vite.config.ts \
  src/pages/notepad/main.ts \
  src/pages/notepad/App.svelte \
  src/pages/notepad/HoverableTarget.svelte \
  src/pages/notepad/styles/tokens.css \
  extension/pages/notepad/notepad.html \
  extension/pages/notepad/main.js \
  extension/pages/notepad/main.css
```

```bash
git commit -m "$(cat <<'EOF'
notepad: migrate to Svelte 5

Replaces notepad.js (21L) with a Svelte 5 App.svelte + HoverableTarget
component. The textarea → target sync stays at 150 ms debounce; the
hoverable target keeps id `notepad-target` and class
`notepad-target lws-sentence-root` so content.js's mutation observer
keeps wrapping Korean text into `.lws-word` spans with no bridge changes.

vite.config.ts refactored to a multi-entry INPUT_MAP that Tasks 4–6
will extend. Build output at extension/pages/notepad/main.js.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: morpheme-inspector/ migration to Svelte 5

**Goal:** Replace `extension/pages/morpheme-inspector/morpheme-inspector.js` (175 lines) and `morpheme-inspector.css` (136 lines) with a Svelte 5 App + 3 table components. Live mecab debounce stays 200 ms; NOT_READY retry stays 500 ms.

**Files:**
- Create: `src/pages/morpheme-inspector/main.ts`
- Create: `src/pages/morpheme-inspector/App.svelte`
- Create: `src/pages/morpheme-inspector/TokenTable.svelte`
- Create: `src/pages/morpheme-inspector/SinglePathSection.svelte`
- Create: `src/pages/morpheme-inspector/NbestSection.svelte`
- Create: `src/pages/morpheme-inspector/CandidatesSection.svelte`
- Create: `src/pages/morpheme-inspector/styles/tokens.css`
- Modify: `vite.config.ts` (add inspector entry)
- Modify: `extension/pages/morpheme-inspector/morpheme-inspector.html`
- Delete: `extension/pages/morpheme-inspector/morpheme-inspector.js`
- Delete: `extension/pages/morpheme-inspector/morpheme-inspector.css`

- [ ] **Step 4.1: Inspect current behavior**

Read `extension/pages/morpheme-inspector/morpheme-inspector.js` lines 136-175 to confirm:
- 200 ms debounce on input change
- mecab-inspect message via `chrome.runtime.sendMessage`
- 500 ms retry on `error === 'NOT_READY'`
- Three rendered sections: Single best path, N-best paths, Lemma candidates
- Table columns: Surface, POS, Type, First pos, Last pos, Decomp, Reading, Full features

All preserved as-is in the migration.

- [ ] **Step 4.2: Update vite.config.ts to add the inspector entry**

Edit `vite.config.ts`, add this line to `INPUT_MAP`:

```ts
const INPUT_MAP: Record<string, string> = {
  'pages/options/options': resolve(__dirname, 'src/pages/options/main.ts'),
  'pages/notepad/notepad': resolve(__dirname, 'src/pages/notepad/main.ts'),
  'pages/morpheme-inspector/morpheme-inspector': resolve(__dirname, 'src/pages/morpheme-inspector/main.ts'),
};
```

- [ ] **Step 4.3: Create src/pages/morpheme-inspector/styles/tokens.css**

Read `extension/pages/morpheme-inspector/morpheme-inspector.css` (all 136 lines) and port it. Tokens (`--card`, `--border`, `--muted`, etc.) come from `page-shell.css` so no `:root` block is needed here.

Create `src/pages/morpheme-inspector/styles/tokens.css`:

```css
/* Morpheme-inspector-specific styles on top of page-shell.css tokens.
 * Ported verbatim from extension/pages/morpheme-inspector/morpheme-inspector.css. */

.inspector-section {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px 22px;
  margin-bottom: 20px;
}

.inspector-section h2 {
  margin: 0 0 14px;
  font-size: 16px;
  font-weight: 600;
}

.inspector-placeholder {
  color: var(--muted);
  font-size: 14px;
  margin: 0;
}

.inspector-error {
  color: var(--error);
  font-size: 14px;
  margin: 0;
}

.token-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.token-table th {
  text-align: left;
  font-weight: 600;
  padding: 6px 8px;
  border-bottom: 2px solid var(--border);
  color: var(--muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.token-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}

.token-table tr:last-child td {
  border-bottom: none;
}

.token-table .col-surface {
  font-weight: 600;
  font-size: 15px;
}

.token-table .col-features {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--muted);
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;
}

.token-table .col-decomp {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--accent);
}

.path-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 12px;
  overflow: hidden;
}

.path-card:last-child {
  margin-bottom: 0;
}

.path-card summary {
  list-style: none;
  cursor: pointer;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  user-select: none;
  background: var(--bg);
}

.path-card summary::-webkit-details-marker {
  display: none;
}

.path-card summary::before {
  content: "▸";
  color: var(--muted);
  font-size: 11px;
  transition: transform 0.15s ease;
}

.path-card[open] > summary::before {
  transform: rotate(90deg);
}

.path-card .path-body {
  padding: 0 14px 14px;
}

.candidates-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.candidate-chip {
  background: rgba(91, 108, 243, 0.1);
  color: var(--accent);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 13px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Pretendard", sans-serif;
}
```

- [ ] **Step 4.4: Create src/pages/morpheme-inspector/main.ts**

Create `src/pages/morpheme-inspector/main.ts`:

```ts
import { mount } from 'svelte';
import '$lib/styles/page-shell.css';
import './styles/tokens.css';
import App from './App.svelte';

const target = document.getElementById('lws-inspector-root');
if (!target) {
  throw new Error('[lws] morpheme-inspector: #lws-inspector-root not found');
}

mount(App, { target });
```

- [ ] **Step 4.5: Create src/pages/morpheme-inspector/TokenTable.svelte**

Create `src/pages/morpheme-inspector/TokenTable.svelte`:

```svelte
<script lang="ts">
  import type { MecabToken } from '$types/messages';

  let { tokens }: { tokens: MecabToken[] } = $props();

  const COLUMNS: Array<{ label: string; key: keyof MecabToken; cls?: string }> = [
    { label: 'Surface', key: 'surface', cls: 'col-surface' },
    { label: 'POS', key: 'pos' },
    { label: 'Type', key: 'type' },
    { label: 'First pos', key: 'firstPos' },
    { label: 'Last pos', key: 'lastPos' },
    { label: 'Decomp', key: 'decomp', cls: 'col-decomp' },
    { label: 'Reading', key: 'reading' },
    { label: 'Full features', key: 'features', cls: 'col-features' },
  ];
</script>

<table class="token-table">
  <thead>
    <tr>
      {#each COLUMNS as col (col.key)}
        <th>{col.label}</th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#each tokens as tok, i (i)}
      <tr>
        {#each COLUMNS as col (col.key)}
          <td class={col.cls || ''} title={col.key === 'features' ? (tok.features || '') : ''}>{tok[col.key] || ''}</td>
        {/each}
      </tr>
    {/each}
  </tbody>
</table>
```

- [ ] **Step 4.6: Create src/pages/morpheme-inspector/SinglePathSection.svelte**

Create `src/pages/morpheme-inspector/SinglePathSection.svelte`:

```svelte
<script lang="ts">
  import type { MecabToken } from '$types/messages';
  import TokenTable from './TokenTable.svelte';

  let { tokens }: { tokens: MecabToken[] } = $props();
</script>

<section class="inspector-section">
  <h2>Single best path</h2>
  {#if tokens.length === 0}
    <p class="inspector-placeholder">No tokens.</p>
  {:else}
    <TokenTable {tokens} />
  {/if}
</section>
```

- [ ] **Step 4.7: Create src/pages/morpheme-inspector/NbestSection.svelte**

Create `src/pages/morpheme-inspector/NbestSection.svelte`:

```svelte
<script lang="ts">
  import type { MecabNbestPath } from '$types/messages';
  import TokenTable from './TokenTable.svelte';

  let { paths }: { paths: MecabNbestPath[] } = $props();
</script>

<section class="inspector-section">
  <h2>N-best paths ({paths.length})</h2>
  {#if paths.length === 0}
    <p class="inspector-placeholder">No paths.</p>
  {:else}
    {#each paths as path, i (i)}
      <details class="path-card" open={i === 0}>
        <summary>Path #{i}  (cost={path.cost})</summary>
        <div class="path-body">
          <TokenTable tokens={path.tokens} />
        </div>
      </details>
    {/each}
  {/if}
</section>
```

- [ ] **Step 4.8: Create src/pages/morpheme-inspector/CandidatesSection.svelte**

Create `src/pages/morpheme-inspector/CandidatesSection.svelte`:

```svelte
<script lang="ts">
  let { candidates }: { candidates: string[] } = $props();
</script>

<section class="inspector-section">
  <h2>Lemma candidates</h2>
  {#if candidates.length === 0}
    <p class="inspector-placeholder">No candidates.</p>
  {:else}
    <ul class="candidates-list">
      {#each candidates as cand (cand)}
        <li class="candidate-chip">{cand}</li>
      {/each}
    </ul>
  {/if}
</section>
```

- [ ] **Step 4.9: Create src/pages/morpheme-inspector/App.svelte**

Create `src/pages/morpheme-inspector/App.svelte`:

```svelte
<script lang="ts">
  import { mecabInspect } from '$lib/messages';
  import type { MecabToken, MecabNbestPath } from '$types/messages';
  import SinglePathSection from './SinglePathSection.svelte';
  import NbestSection from './NbestSection.svelte';
  import CandidatesSection from './CandidatesSection.svelte';

  type ViewState =
    | { kind: 'placeholder'; text: string }
    | { kind: 'error'; text: string }
    | { kind: 'results'; singlePath: MecabToken[]; nbestPaths: MecabNbestPath[]; candidates: string[] };

  let inputText = $state('');
  let view = $state<ViewState>({ kind: 'placeholder', text: 'Enter Korean text to analyze.' });
  let textareaEl: HTMLTextAreaElement | undefined;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let activeRequestId = 0;

  // Autofocus on mount, matching the original morpheme-inspector.js.
  $effect(() => {
    textareaEl?.focus();
  });

  function onInput(e: Event) {
    inputText = (e.currentTarget as HTMLTextAreaElement).value;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => analyze(inputText), 200);
  }

  async function analyze(text: string) {
    if (retryTimer) clearTimeout(retryTimer);
    const trimmed = text.trim();
    if (!trimmed) {
      view = { kind: 'placeholder', text: 'Enter Korean text to analyze.' };
      return;
    }
    view = { kind: 'placeholder', text: 'Initializing mecab…' };
    const requestId = ++activeRequestId;
    let response;
    try {
      response = await mecabInspect(trimmed, 5);
    } catch (err) {
      if (requestId !== activeRequestId) return;
      console.warn('[lws] mecab-inspect send failed:', err);
      view = { kind: 'error', text: `Failed to analyze: ${(err as Error).message || err}` };
      return;
    }
    if (requestId !== activeRequestId) return;
    if (!response) {
      console.warn('[lws] mecab-inspect: empty response');
      view = { kind: 'error', text: 'Failed to analyze: no response from background' };
      return;
    }
    if (response.error) {
      if (response.error === 'NOT_READY') {
        // mecab still initializing — try again in 500 ms with the current input.
        retryTimer = setTimeout(() => analyze(inputText), 500);
        return;
      }
      console.warn('[lws] mecab-inspect error:', response.error);
      view = { kind: 'error', text: `Failed to analyze: ${response.error}` };
      return;
    }
    view = {
      kind: 'results',
      singlePath: response.singlePath || [],
      nbestPaths: response.nbestPaths || [],
      candidates: response.candidates || [],
    };
  }
</script>

<main>
  <header>
    <h1>Morpheme inspector</h1>
    <p class="subtitle">Tokenize Korean text and inspect every mecab field</p>
  </header>

  <section class="card">
    <label class="field">
      <span class="label">Input</span>
      <textarea
        bind:this={textareaEl}
        rows="4"
        spellcheck="false"
        placeholder="Paste or type Korean text — analysis updates live."
        value={inputText}
        oninput={onInput}
      ></textarea>
    </label>
  </section>

  {#if view.kind === 'placeholder'}
    <section class="inspector-section">
      <p class="inspector-placeholder">{view.text}</p>
    </section>
  {:else if view.kind === 'error'}
    <section class="inspector-section">
      <p class="inspector-error">{view.text}</p>
    </section>
  {:else}
    <SinglePathSection tokens={view.singlePath} />
    <NbestSection paths={view.nbestPaths} />
    <CandidatesSection candidates={view.candidates} />
  {/if}
</main>
```

- [ ] **Step 4.10: Rewrite extension/pages/morpheme-inspector/morpheme-inspector.html**

Replace `extension/pages/morpheme-inspector/morpheme-inspector.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Morpheme inspector</title>
  <link rel="stylesheet" href="main.css" />
</head>
<body>
  <div id="lws-inspector-root"></div>
  <script type="module" src="./main.js"></script>
</body>
</html>
```

- [ ] **Step 4.11: Delete the old inspector JS + CSS**

```bash
git rm extension/pages/morpheme-inspector/morpheme-inspector.js \
       extension/pages/morpheme-inspector/morpheme-inspector.css
```

- [ ] **Step 4.12: Build**

Run: `npm run build`

Expected: build succeeds. Verify:

```bash
ls extension/pages/morpheme-inspector/main.js extension/pages/morpheme-inspector/main.css
```

Both files exist.

- [ ] **Step 4.13: Run tests**

Run: `npm run test:ui && npm test`

Expected output: both suites pass. UI test count unchanged from Task 3 (8 tests in 2 files); node test count unchanged from Task 1.

- [ ] **Step 4.14: Manual Chrome verification**

1. Reload the extension at `chrome://extensions`
2. Open the options page → Advanced → "Open morpheme inspector" link
3. Confirm: page loads with the input textarea + "Enter Korean text to analyze." placeholder
4. Paste `오늘 학교에 갔어요`
5. Within ~200 ms, three sections render: "Single best path" table, "N-best paths (5)" with the first path expanded, "Lemma candidates" pills
6. Each token shows surface / POS / Type / First pos / Last pos / Decomp / Reading / Full features columns
7. Click a closed path-card summary — confirm it expands
8. Edit the input — confirm results update live (debounced)
9. Hover the "Full features" cell — confirm the tooltip shows the same text (title attribute)

No console errors expected.

- [ ] **Step 4.15: Commit**

```bash
git add vite.config.ts \
  src/pages/morpheme-inspector/main.ts \
  src/pages/morpheme-inspector/App.svelte \
  src/pages/morpheme-inspector/TokenTable.svelte \
  src/pages/morpheme-inspector/SinglePathSection.svelte \
  src/pages/morpheme-inspector/NbestSection.svelte \
  src/pages/morpheme-inspector/CandidatesSection.svelte \
  src/pages/morpheme-inspector/styles/tokens.css \
  extension/pages/morpheme-inspector/morpheme-inspector.html \
  extension/pages/morpheme-inspector/main.js \
  extension/pages/morpheme-inspector/main.css
```

```bash
git commit -m "$(cat <<'EOF'
morpheme-inspector: migrate to Svelte 5

Replaces morpheme-inspector.js (175L) and morpheme-inspector.css (136L)
with a Svelte 5 App + 4 components (TokenTable shared, SinglePathSection,
NbestSection, CandidatesSection). 200 ms input debounce and 500 ms
NOT_READY retry preserved. Background contract (mecab-inspect message)
unchanged — wrapped by src/lib/messages.ts mecabInspect().

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: popup/ (toolbar) migration to Svelte 5

**Goal:** Replace `extension/pages/popup/popup.js` (209 lines) and `popup.css` (217 lines) with a Svelte 5 App + 4 child components, preserving the per-site disable toggle (chrome.storage.local), adapter-section dynamic load (YouTube/Netflix popupModule), notepad/options icon links, Ko-fi banner, and the LINKS dict for future GitHub/Discord URLs.

**Files:**
- Create: `src/pages/popup/main.ts`
- Create: `src/pages/popup/App.svelte`
- Create: `src/pages/popup/SiteToggleRow.svelte`
- Create: `src/pages/popup/AdapterSection.svelte`
- Create: `src/pages/popup/LinksRow.svelte`
- Create: `src/pages/popup/KofiBanner.svelte`
- Create: `src/pages/popup/styles/tokens.css`
- Create: `src/pages/popup/links.ts`
- Modify: `vite.config.ts` (add popup entry)
- Modify: `extension/pages/popup/popup.html`
- Delete: `extension/pages/popup/popup.js`
- Delete: `extension/pages/popup/popup.css`

- [ ] **Step 5.1: Inspect current popup behavior**

Read `extension/pages/popup/popup.js` (full file, 209 lines) and confirm these behaviors must survive:

- Per-site disable list: `chrome.storage.local` key `disabledHosts` (NOT sync — per popup.js comment: sync was throttled and dropped per-site writes)
- Active site resolution: `chrome.tabs.query({active: true, currentWindow: true})`; if `tab.url` available use it, else fall back to `chrome.tabs.sendMessage(tab.id, {type: 'lws-site-info'})` against content.js
- Site toggle hidden on chrome:// / about:// pages (non-http(s) protocol)
- chrome.storage.onChanged listener keeps the toggle in sync if changed from another tab
- Adapter section: dynamic-imports `extension/adapters/<site>/popup.js` (via `chrome.runtime.getURL`) and calls its `renderSection({tab, href, container})` API
- "Open settings" icon button opens chrome.runtime.openOptionsPage() and closes the popup
- Notepad icon link: `chrome.runtime.getURL('pages/notepad/notepad.html')`, opens in new tab
- LINKS dict at top of file with empty placeholders for github/discord/kofi; LINK_META has SVG icons
- Empty-URL links render as `link-icon--disabled` placeholders with tooltip "X — coming soon"
- Ko-fi banner: red banner; if `LINKS.kofi` set use it, else render disabled

The body width is fixed at 260px (popup.css line 35).

- [ ] **Step 5.2: Add popup entry to vite.config.ts**

Edit `vite.config.ts`, add this line to `INPUT_MAP`:

```ts
const INPUT_MAP: Record<string, string> = {
  'pages/options/options': resolve(__dirname, 'src/pages/options/main.ts'),
  'pages/notepad/notepad': resolve(__dirname, 'src/pages/notepad/main.ts'),
  'pages/morpheme-inspector/morpheme-inspector': resolve(__dirname, 'src/pages/morpheme-inspector/main.ts'),
  'pages/popup/popup': resolve(__dirname, 'src/pages/popup/main.ts'),
};
```

- [ ] **Step 5.3: Create src/pages/popup/styles/tokens.css**

The popup uses a different token palette than the 4-page shell (different background, different accent shades — see popup.css lines 1-30). It also has a hard `[hidden]` rule. Rather than dragging these into `page-shell.css` (which the popup intentionally doesn't use because of size constraints), the popup ships its own tokens.

Create `src/pages/popup/styles/tokens.css`:

```css
/* Popup-specific tokens + base styles. The toolbar popup is 260px wide
 * and styles differently from the 4 settings/utility pages, so it
 * doesn't import page-shell.css. Ported verbatim from the original
 * extension/pages/popup/popup.css. */

:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #1a1a24;
  --muted: #5b6172;
  --border: #e3e5ec;
  --accent: #5b6cf3;
  --ok: #1f8a4e;
  --warn: #d39c2a;
  --err: #c93a3a;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1e1e2e;
    --fg: #e8e8f0;
    --muted: #97a0b8;
    --border: rgba(255, 255, 255, 0.08);
    --accent: #7d8cff;
    --ok: #4dd07d;
    --warn: #f5c46a;
    --err: #ff7a7a;
  }
}

* { box-sizing: border-box; }

/* Author rules like `.row { display: flex }` would otherwise tie with
 * the UA's `[hidden] { display: none }` (both 0,0,1,0 specificity) and
 * win on source order — making any `<div class="row" hidden>` render
 * visibly. Force the attribute to win. */
[hidden] { display: none !important; }

body {
  margin: 0;
  width: 260px;
  padding: 14px 16px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Pretendard", sans-serif;
  font-size: 13px;
  background: var(--bg);
  color: var(--fg);
}

header .brand {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

/* Stacked field: small uppercase label above an input/select.
 * Used by adapter sections (YouTube secondary-subs picker) so the
 * dropdown gets the full popup width. */
.field-stacked {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 12px;
}

.section-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}

/* Adapter sections (YouTube, Netflix) render their own content; we
 * provide the container chrome and the empty-state typography. */
.adapter-section {
  margin-top: 14px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

.yt-empty {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  font-style: italic;
}

.yt-sub-select {
  width: 100%;
  font: inherit;
  font-size: 13px;
  padding: 4px 6px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--fg);
}
```

- [ ] **Step 5.4: Create src/pages/popup/links.ts**

Create `src/pages/popup/links.ts`. The LINK_META icons stay SVG-as-string (they're injected via innerHTML) because that's how the original popup.js wrote them — each entry's `svg` field is exactly the string from popup.js lines 13 and 18.

```ts
// External links shown in the toolbar popup. Fill in when ready to publish;
// empty string renders a greyed-out placeholder with a "coming soon" tooltip.
//
// `kofi` is special-cased — it has its own dedicated banner component
// (KofiBanner.svelte) rather than appearing in the icon row.

export interface LinkMeta {
  title: string;
  placeholderTitle: string;
  /** Raw SVG markup. Bound via innerHTML in LinksRow.svelte. */
  svg: string;
}

export const LINKS: { github: string; discord: string; kofi: string } = {
  github: '', // e.g. 'https://github.com/abishake/learnwithsoju'
  discord: '', // e.g. 'https://discord.gg/xxxxxxx'
  kofi: '', // e.g. 'https://ko-fi.com/learnwithsoju'
};

export const LINK_META: { github: LinkMeta; discord: LinkMeta } = {
  github: {
    title: 'GitHub repository',
    placeholderTitle: 'GitHub — coming soon',
    svg: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>',
  },
  discord: {
    title: 'Discord',
    placeholderTitle: 'Discord — coming soon',
    svg: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.245.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>',
  },
};
```

- [ ] **Step 5.5: Create src/pages/popup/main.ts**

Create `src/pages/popup/main.ts`:

```ts
import { mount } from 'svelte';
import './styles/tokens.css';
import App from './App.svelte';

const target = document.getElementById('lws-popup-root');
if (!target) {
  throw new Error('[lws] popup: #lws-popup-root not found');
}

mount(App, { target });
```

- [ ] **Step 5.6: Create src/pages/popup/SiteToggleRow.svelte**

Create `src/pages/popup/SiteToggleRow.svelte`:

```svelte
<script lang="ts">
  // Per-site disable lives in chrome.storage.local — sync is throttled
  // (write-quota, eventual-consistency w/ the cloud) and was dropping
  // per-site writes. Local is per-device, which matches the semantics:
  // "for this browser, on this site, leave me alone."
  const DISABLED_HOSTS_KEY = 'disabledHosts';

  let { host }: { host: string } = $props();
  let enabled = $state(true);

  // Hydrate from chrome.storage.local on mount, plus subscribe to changes.
  $effect(() => {
    if (!host) return;
    (async () => {
      try {
        const data = await chrome.storage.local.get(DISABLED_HOSTS_KEY);
        applyFromList(data[DISABLED_HOSTS_KEY]);
      } catch (err) {
        console.warn('[lws] popup SiteToggleRow: hydrate failed', err);
      }
    })();

    const listener = (changes: any, area: string) => {
      if (area !== 'local') return;
      if (!(DISABLED_HOSTS_KEY in changes)) return;
      applyFromList(changes[DISABLED_HOSTS_KEY].newValue);
    };
    try {
      chrome.storage.onChanged.addListener(listener);
    } catch { /* ignore */ }

    return () => {
      try { chrome.storage.onChanged.removeListener(listener); } catch { /* ignore */ }
    };
  });

  function applyFromList(list: unknown) {
    const arr = Array.isArray(list) ? (list as string[]) : [];
    enabled = !arr.includes(host);
  }

  async function onToggle(e: Event) {
    if (!host) return;
    const wantsEnabled = (e.currentTarget as HTMLInputElement).checked;
    enabled = wantsEnabled;
    try {
      const data = await chrome.storage.local.get(DISABLED_HOSTS_KEY);
      const list: string[] = Array.isArray(data[DISABLED_HOSTS_KEY]) ? data[DISABLED_HOSTS_KEY] : [];
      const set = new Set(list);
      if (wantsEnabled) set.delete(host);
      else set.add(host);
      const next = Array.from(set).sort();
      await chrome.storage.local.set({ [DISABLED_HOSTS_KEY]: next });
    } catch (err) {
      console.warn('[lws] popup SiteToggleRow: write failed', err);
    }
  }
</script>

<div class="row">
  <label class="switch">
    <input type="checkbox" autocomplete="off" checked={enabled} onchange={onToggle} />
    <span class="slider"></span>
  </label>
  <span class="row-label">Enable on <span class="site-host">{host}</span></span>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
  }

  .row-label {
    font-size: 13px;
  }

  .site-host {
    color: var(--muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    word-break: break-all;
  }

  .switch {
    position: relative;
    display: inline-block;
    width: 38px;
    height: 22px;
    flex: 0 0 auto;
  }

  .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    position: absolute;
    inset: 0;
    background: var(--border);
    border-radius: 999px;
    transition: 0.18s;
    cursor: pointer;
  }

  .slider::before {
    content: "";
    position: absolute;
    width: 18px;
    height: 18px;
    left: 2px;
    top: 2px;
    background: white;
    border-radius: 50%;
    transition: 0.18s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }

  .switch input:checked + .slider {
    background: var(--accent);
  }

  .switch input:checked + .slider::before {
    transform: translateX(16px);
  }
</style>
```

- [ ] **Step 5.7: Create src/pages/popup/AdapterSection.svelte**

Create `src/pages/popup/AdapterSection.svelte`. Generic loader for per-site popupModule (`extension/adapters/<site>/popup.js`). Same pattern as original popup.js lines 122-146.

```svelte
<script lang="ts">
  // Looks up SITE_CONFIGS for the active tab's hostname; if it declares
  // a `popupModule`, dynamic-imports that module and hands it the section
  // container via the same renderSection({tab, href, container}) API the
  // original popup.js used. Adapters render their own DOM into the
  // container imperatively — keeping the adapter contract identical means
  // youtube/popup.js and netflix/popup.js need no migration changes.

  let { host, tab, href }: { host: string; tab: any; href: string } = $props();

  let containerEl: HTMLElement | undefined;
  let visible = $state(false);

  $effect(() => {
    if (!host || !tab || !containerEl) return;
    let cancelled = false;
    (async () => {
      let findSiteConfig: (h: string) => any;
      try {
        const mod = await import(/* @vite-ignore */ chrome.runtime.getURL('core/site-configs.js'));
        findSiteConfig = mod.findSiteConfig;
      } catch {
        return;
      }
      const cfg = findSiteConfig(host);
      if (!cfg || !cfg.popupModule) return;
      let popupMod;
      try {
        popupMod = await import(/* @vite-ignore */ chrome.runtime.getURL(cfg.popupModule));
      } catch {
        return;
      }
      if (!popupMod || typeof popupMod.renderSection !== 'function') return;
      if (cancelled || !containerEl) return;
      visible = true;
      try {
        await popupMod.renderSection({ tab, href, container: containerEl });
      } catch (err) {
        console.warn('[learnwithsoju] popupModule failed:', err);
      }
    })();
    return () => { cancelled = true; };
  });
</script>

<section class="adapter-section" hidden={!visible} bind:this={containerEl}></section>
```

- [ ] **Step 5.8: Create src/pages/popup/LinksRow.svelte**

Create `src/pages/popup/LinksRow.svelte`:

```svelte
<script lang="ts">
  import { LINKS, LINK_META } from './links';

  let notepadUrl = $state('#');

  $effect(() => {
    try {
      notepadUrl = chrome.runtime.getURL('pages/notepad/notepad.html');
    } catch {
      notepadUrl = '#';
    }
  });

  function openOptions(e: Event) {
    e.preventDefault();
    try {
      chrome.runtime.openOptionsPage();
    } catch { /* ignore */ }
    window.close();
  }

  // External links to render after the built-in icons. Key drives the
  // tooltip + svg lookup; URL is empty for "coming soon" placeholders.
  const EXTERNAL_KEYS: Array<'github' | 'discord'> = ['github', 'discord'];
</script>

<section class="links-row">
  <a
    class="link-icon"
    href={notepadUrl}
    target="_blank"
    rel="noopener noreferrer"
    title="Notepad — paste text to hover-look-up"
  >
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15z"/><path d="M8 2v20M12 7h6M12 11h6M12 15h4"/></svg>
  </a>
  <button type="button" class="link-icon" title="Open settings" onclick={openOptions}>
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
  </button>

  {#each EXTERNAL_KEYS as key (key)}
    {@const meta = LINK_META[key]}
    {@const url = LINKS[key]}
    {#if url}
      <a class="link-icon" href={url} target="_blank" rel="noopener noreferrer" title={meta.title}>
        {@html meta.svg}
      </a>
    {:else}
      <a class="link-icon link-icon--disabled" aria-disabled="true" title={meta.placeholderTitle}>
        {@html meta.svg}
      </a>
    {/if}
  {/each}
</section>

<style>
  .links-row {
    margin-top: 14px;
    border-top: 1px solid var(--border);
    padding-top: 12px;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    gap: 10px;
  }

  .link-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    background: transparent;
    border-radius: 4px;
    color: var(--muted);
    text-decoration: none;
    cursor: pointer;
    transition: color 0.12s ease, background 0.12s ease;
  }

  .link-icon:hover {
    color: var(--fg);
    background: rgba(120, 140, 200, 0.12);
  }

  .link-icon--disabled {
    opacity: 0.4;
    pointer-events: none;
    cursor: default;
  }
</style>
```

- [ ] **Step 5.9: Create src/pages/popup/KofiBanner.svelte**

Create `src/pages/popup/KofiBanner.svelte`:

```svelte
<script lang="ts">
  import { LINKS } from './links';

  let url = $state('');
  let enabled = $state(false);

  $effect(() => {
    url = LINKS.kofi || '';
    enabled = !!url;
  });
</script>

{#if enabled}
  <a class="kofi-banner" href={url} target="_blank" rel="noopener noreferrer" title="Support on Ko-fi">
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>
    <span>Support on Ko-fi</span>
  </a>
{:else}
  <a class="kofi-banner kofi-banner--disabled" aria-disabled="true" title="Support on Ko-fi — coming soon">
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>
    <span>Support on Ko-fi</span>
  </a>
{/if}

<style>
  .kofi-banner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin-top: 10px;
    width: 100%;
    padding: 7px 0;
    background: #ff5e5b;
    color: #ffffff;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    text-decoration: none;
    transition: filter 0.12s ease;
  }

  .kofi-banner:hover {
    filter: brightness(1.08);
  }

  .kofi-banner--disabled {
    opacity: 0.45;
    pointer-events: none;
    cursor: default;
  }
</style>
```

- [ ] **Step 5.10: Create src/pages/popup/App.svelte**

Create `src/pages/popup/App.svelte`. This is the orchestrator. It runs the resolveActiveSite() pipeline that the original popup.js had at lines 46-79.

```svelte
<script lang="ts">
  import SiteToggleRow from './SiteToggleRow.svelte';
  import AdapterSection from './AdapterSection.svelte';
  import LinksRow from './LinksRow.svelte';
  import KofiBanner from './KofiBanner.svelte';

  type Site = { tab: any; host: string; protocol: string; href: string };

  let site = $state<Site | null>(null);
  let showSite = $state(false);

  // Resolve the active tab's hostname. Tries tab.url first (works when
  // activeTab grant is in effect); falls back to messaging the content
  // script (which always knows its own location.hostname). Returns null
  // if both sources fail (e.g. chrome:// page with no content script).
  async function resolveActiveSite(): Promise<Site | null> {
    let tab: any;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = tabs?.[0];
    } catch (err) {
      console.log('[lws] popup resolveActiveSite: tabs.query failed', err);
      return null;
    }
    if (!tab) {
      console.log('[lws] popup resolveActiveSite: no active tab');
      return null;
    }
    if (tab.url) {
      try {
        const u = new URL(tab.url);
        return { tab, host: u.hostname.toLowerCase(), protocol: u.protocol, href: tab.url };
      } catch { /* fall through */ }
    }
    // Fallback: ask the content script directly.
    try {
      const reply = await chrome.tabs.sendMessage(tab.id, { type: 'lws-site-info' });
      if (reply && reply.host) {
        return {
          tab,
          host: String(reply.host).toLowerCase(),
          protocol: reply.protocol || 'https:',
          href: reply.href || '',
        };
      }
    } catch (err) {
      console.log('[lws] popup resolveActiveSite: content-script fallback failed', err);
    }
    return null;
  }

  $effect(() => {
    (async () => {
      const s = await resolveActiveSite();
      if (!s) return;
      if (s.protocol !== 'http:' && s.protocol !== 'https:') {
        console.log('[lws] popup: non-http(s) protocol', s.protocol);
        return;
      }
      if (!s.host) return;
      site = s;
      showSite = true;
    })();
  });
</script>

<header>
  <span class="brand">learnwithsoju</span>
</header>

{#if showSite && site}
  <SiteToggleRow host={site.host} />
  <AdapterSection host={site.host} tab={site.tab} href={site.href} />
{/if}

<LinksRow />
<KofiBanner />
```

- [ ] **Step 5.11: Rewrite extension/pages/popup/popup.html**

Replace `extension/pages/popup/popup.html` with:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="main.css" />
</head>
<body>
  <div id="lws-popup-root"></div>
  <script type="module" src="./main.js"></script>
</body>
</html>
```

- [ ] **Step 5.12: Delete the old popup JS + CSS**

```bash
git rm extension/pages/popup/popup.js extension/pages/popup/popup.css
```

- [ ] **Step 5.13: Build**

Run: `npm run build`

Expected: build succeeds. Verify:

```bash
ls extension/pages/popup/main.js extension/pages/popup/main.css
```

- [ ] **Step 5.14: Run tests**

Run: `npm run test:ui && npm test`

Expected: both suites still pass.

- [ ] **Step 5.15: Manual Chrome verification**

1. Reload the extension at `chrome://extensions`
2. Open any webpage with Korean text
3. Click the extension toolbar icon — confirm the 260px popup opens
4. Confirm "learnwithsoju" brand header at top
5. Confirm the site row appears with hostname displayed and toggle ON by default
6. Toggle OFF — confirm `chrome.storage.local` records the hostname (DevTools → Application → Storage → local). Re-open popup — toggle stays OFF
7. Toggle back ON — confirm it removes from the list
8. Open a YouTube video page — confirm the adapter section appears below the site toggle with the YouTube secondary-subs UI
9. Open a Netflix page — same, with Netflix adapter UI
10. Open a non-adapter site — confirm adapter section stays hidden
11. Open a `chrome://` page — confirm the site row stays hidden (only brand header + links row + banner visible)
12. Click the gear icon — options page opens, popup closes
13. Click the notepad icon — notepad opens in a new tab
14. The GitHub / Discord / Ko-fi icons render as disabled placeholders with tooltips (until LINKS in `src/pages/popup/links.ts` is filled in)

No console errors expected in the popup's DevTools (right-click the popup → Inspect).

- [ ] **Step 5.16: Commit**

```bash
git add vite.config.ts \
  src/pages/popup/main.ts \
  src/pages/popup/App.svelte \
  src/pages/popup/SiteToggleRow.svelte \
  src/pages/popup/AdapterSection.svelte \
  src/pages/popup/LinksRow.svelte \
  src/pages/popup/KofiBanner.svelte \
  src/pages/popup/links.ts \
  src/pages/popup/styles/tokens.css \
  extension/pages/popup/popup.html \
  extension/pages/popup/main.js \
  extension/pages/popup/main.css
```

```bash
git commit -m "$(cat <<'EOF'
popup: migrate to Svelte 5

Replaces popup.js (209L) and popup.css (217L) with a Svelte 5 App
+ 4 child components (SiteToggleRow, AdapterSection, LinksRow,
KofiBanner). Per-site disable still writes to chrome.storage.local
(not sync); adapter section still dynamic-imports each adapter's
popup.js and calls its renderSection({tab, href, container}) API
unchanged.

LINKS dict (github/discord/kofi URLs) and LINK_META icons moved to
src/pages/popup/links.ts; empty URLs render as greyed-out
placeholders with "coming soon" tooltips, same as before.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: overlay infrastructure (content.js surgery)

**Goal:** Delete the DOM construction functions from `content.js` (the imperative builders for sentence band, morpheme breakdown, tab strip, entries, related pills, dictionary sections, Hanja meanings, footers, examples, chips, etc.), reduce `ensurePopup()` to a thin shadow-host + script-injection mount, and stand up a minimal `src/overlay/App.svelte` skeleton that registers `window.__lwsOverlay`. The skeleton renders a placeholder only — the full component tree lands in Task 7. After this commit, hovering a word should fire show/hide on `window.__lwsOverlay` and the placeholder text should appear in the shadow root.

**Files:**
- Modify: `extension/content.js` (delete ~1000 lines of DOM construction, rewire ensurePopup + showPopup, replace `buildResultNode`/`buildErrorNode`/`buildLoadingNode` callsites with `window.__lwsOverlay.show(...)`)
- Create: `src/overlay/main.ts`
- Create: `src/overlay/App.svelte` (SKELETON — placeholder only)
- Modify: `vite.config.ts` (add overlay entry)
- Modify: `extension/manifest.json` (add `overlay/main.js` to web_accessible_resources)

- [ ] **Step 6.1: Capture the exact line ranges to delete from content.js**

The DOM construction is interleaved with bridge functions, so the deletion is split into three contiguous ranges. Run this from the repo root to confirm the current line numbers before editing:

```bash
grep -n '^  function \|^  async function ' extension/content.js | head -90
```

Expected key markers (from the current branch state at the time of plan writing):

| Range | Function span | What it does |
|---|---|---|
| **Range A:** lines 505–545 | `buildLoadingNode`, `setLookupStatus`, `clearLookupStatusTimers`, `scheduleLookupStatusSequence` | Loading frame DOM + status timers (timers move to overlay; status text becomes a `window.__lwsOverlay.update({ lookupStatus })` call from content.js) |
| **Range B:** lines 641–903 | `buildAiPill`, `buildSentenceNode`, `appendSentenceWords`, `onSentenceWordClick`, `buildDecompositionNode`, `buildMorphemeRow`, `buildMorphemeChip`, `SEJONG_TO_KOREAN_POS`, `displayPosKoreanToEnglishMaybe`, `buildInsightsNode`, `buildInsightTab`, `buildErrorNode` | Sentence band, morpheme breakdown, insights tab, error node |
| **Range C:** lines 909–1643 | `entryForSection`, `entryIdentity`, `materializeGroup`, `buildResultNode`, `buildTabBar`, `onPrimaryTabClick`, `buildTabBodyNode`, `buildSyntheticSectionNode`, `buildSectionNode`, `buildSectionHeader`, `buildRelatedTabRow`, `onRelatedTabClick`, `buildStripNode`, `makeToggleBtn`, `onToggleLang`, `rerenderActivePopup`, `buildSenseNode`, `appendExamplesToggle`, `buildOdSenseNode`, `SVG_NS`, `EXT_ICON_PATHS`, `buildExternalIcon`, `makeChip`, `makeHanjaChip`, `hanjaSession`, `buildHanjaMeaningsNode`, `buildHanjaErrorRow`, `renderHanjaMeanings`, `makePosChip`, `makePronChip`, `displayPos` | Tab strip + all dictionary entry rendering + Hanja meanings + chip helpers |

**Do not delete** anything outside these ranges. Specifically keep:
- `extractSentence` (lines 547-599) — bridge logic, used in `performLookup`
- `secondaryLangName`, `currentProvider`, `buildAskAiUrl` (lines 606-639) — data shaping, may still be useful (kept; the overlay will own the askAi URL eventually but for now content.js can keep passing it through)
- `showPopup` (lines 472-503) — rewritten in Step 6.4 to use the overlay API
- `positionPopup` (lines 442-470) — bridge logic, still needed by the overlay-side anchor calculation? **Yes, kept** — content.js still computes the anchor rect (the only realm that has the page DOM) and passes it to the overlay via `OverlayPayload.anchor`. The overlay positions itself relative to the rect.
- All event handlers, mutation observer, init logic, video pause/resume, storage listeners, adapter loading, etc.

Before deleting, **re-run the line-marker grep** and adjust the ranges below if the line numbers have drifted (e.g. a subsequent commit changed the bridge code). The function names are the stable identifiers.

- [ ] **Step 6.2: Also remove these unused bits from content.js**

After the three ranges are deleted, the following top-level state will be orphaned (no remaining reader). Remove their declarations too:

- Line 179: `let activeInsightTab = null;` — owned by overlay state
- Line 182: `let activeTab = { source: 'primary', index: 0 };` — owned by overlay
- Line 183: `let relatedExpanded = false;` — owned by overlay
- Line 188: `let expandedSectionByTab = new Map();` — owned by overlay
- Line 189: `let popupMinHeight = 0;` — owned by overlay
- Line 190: `let popupMinWidth = 0;` — owned by overlay
- Line 191: `let expandedExamples = new Set();` — owned by overlay
- Line 192: `let expandedHanja = new Set();` — owned by overlay
- Line 196: `let activeLoadingStatusEl = null;` — overlay tracks its own loading status now
- Line 197: `let lookupStatusTimers = [];` — overlay owns the status sequence
- Line 174: `let popupEl = null;` — no longer needed (shadow root only holds the mount point)

Keep:
- `popupHost`, `popupRoot` (still needed — content.js owns the shadow host)
- `popupPinned`, `popupPinnedSafetyTimer` (bridge state for pin/unpin)
- `pausedVideo`, `resumeVideoOnHide`, `suppressNextPauseEvent`, `videoPauseListener` (video pause/resume)
- `pendingRequestId`, `lastPayload`, `lastSentence`, `activeWordEl`, `hideTimer`, `hoverTimer`, `defLang`, `secondaryLang`, `askAiPromptTemplate`, `askAiProvider`, `askAiChatGptTemporary`, `hostDisabled`, `enabled` (all bridge state)

- [ ] **Step 6.3: Add a helper to inject the overlay bundle**

Add this function to `content.js` near `ensurePopup()` (immediately before it):

```js
  // Resolve to a Promise that fulfils once the overlay bundle has loaded
  // and registered `window.__lwsOverlay`. Idempotent — repeated calls
  // share the same promise. We import via dynamic import using the
  // chrome.runtime.getURL() of the overlay bundle so the script runs in
  // the same isolated content-script realm as content.js itself — that
  // way `window.__lwsOverlay` is reachable from here (chrome's content
  // scripts share the `window` of the page realm, but in MV3 content
  // scripts run in their own isolated world where they have their own
  // shared global scope keyed by extension id. Both content.js and the
  // overlay bundle, both injected by the same extension, end up in that
  // same isolated world).
  let overlayLoadPromise = null;
  function loadOverlayBundle() {
    if (overlayLoadPromise) return overlayLoadPromise;
    overlayLoadPromise = (async () => {
      try {
        const url = chrome.runtime.getURL('overlay/main.js');
        await import(url);
      } catch (err) {
        console.warn('[lws] content: overlay bundle load failed:', err);
        overlayLoadPromise = null;
        throw err;
      }
      // Wait one microtask so the bundle's top-level code (which calls
      // mount() and registers window.__lwsOverlay) has finished.
      await Promise.resolve();
      if (!window.__lwsOverlay) {
        throw new Error('overlay bundle loaded but window.__lwsOverlay missing');
      }
    })();
    return overlayLoadPromise;
  }
```

**Realm correction:** in MV3, content scripts get their own isolated `window` per-extension. Both `content.js` (a content_script) and the dynamically-imported `overlay/main.js` (a WAR loaded into the same content script via `import(chrome.runtime.getURL(...))`) live in that isolated world — `window.__lwsOverlay` set by one is visible to the other. The page's `window` is unaffected.

- [ ] **Step 6.4: Rewrite ensurePopup() and showPopup()**

Replace the existing `ensurePopup()` body (lines 309-339 in the original) and `showPopup()` body (lines 472-503) with these new versions. The shadow root now hosts a single `<div id="lws-overlay-root">` mount point; the overlay component is responsible for everything inside it (including positioning).

```js
  function ensurePopup() {
    if (popupHost) return popupHost;
    popupHost = document.createElement('div');
    popupHost.className = HOST_CLASS;
    popupHost.style.all = 'initial';
    // Anchored at the document origin (not the viewport) so the popup
    // scrolls with the page. The overlay component positions itself
    // absolutely inside the shadow root using anchor rects in document
    // coordinates (passed in via OverlayPayload.anchor).
    popupHost.style.position = 'absolute';
    popupHost.style.top = '0';
    popupHost.style.left = '0';
    popupHost.style.zIndex = '2147483647';
    popupHost.style.pointerEvents = 'none';
    popupRoot = popupHost.attachShadow({ mode: 'open' });
    const mountPoint = document.createElement('div');
    mountPoint.id = 'lws-overlay-root';
    popupRoot.appendChild(mountPoint);
    document.documentElement.appendChild(popupHost);
    // Mouse enter/leave on the host (the overlay component will route
    // its own internal events; we still need the host-level handlers
    // for the hide-on-leave timer that the bridge owns).
    popupHost.addEventListener('mouseenter', () => {
      cancelHide();
      unpinPopup();
    });
    popupHost.addEventListener('mouseleave', scheduleHide);
    return popupHost;
  }

  // showPopup is now a thin proxy that ensures the shadow host exists,
  // loads the overlay bundle if needed, and forwards the frame to
  // window.__lwsOverlay.show. The frame describes what to render
  // (loading / error / payload); the overlay component owns all DOM.
  async function showPopup(frame) {
    ensurePopup();
    try {
      await loadOverlayBundle();
    } catch (err) {
      // If the bundle won't load, log and bail — the user sees nothing,
      // which is better than a broken popup.
      console.warn('[lws] content: showPopup aborted, overlay unavailable', err);
      return;
    }
    if (!window.__lwsOverlay) {
      console.warn('[lws] content: window.__lwsOverlay missing after bundle load');
      return;
    }
    window.__lwsOverlay.show(frame);
    // Pause the video on the first show of a session (matches existing
    // behaviour). pauseVideoIfApplicable is idempotent.
    pauseVideoIfApplicable(frame && frame.anchor ? null : null);
  }

  function hidePopup() {
    if (window.__lwsOverlay && typeof window.__lwsOverlay.hide === 'function') {
      try { window.__lwsOverlay.hide(); } catch (err) {
        console.warn('[lws] content: overlay.hide failed', err);
      }
    }
    resumeVideoIfApplicable();
    activeWordEl = null;
    popupPinned = false;
    if (popupPinnedSafetyTimer) {
      clearTimeout(popupPinnedSafetyTimer);
      popupPinnedSafetyTimer = null;
    }
  }
```

Note: the original `pauseVideoIfApplicable(target)` took the anchor element. The overlay no longer knows about specific DOM elements — content.js still passes the originating anchor element when computing the frame. See Step 6.5 for how `performLookup` keeps a local `anchor` element handy.

- [ ] **Step 6.5: Rewrite performLookup() callsites that used to build DOM**

Find the existing `performLookup()` (lines 1645-1728 in the original). Three places in its body call DOM-building functions: `buildLoadingNode(surface)`, `buildErrorNode(...)`, `buildResultNode(response, { sentence })`. Replace each with the overlay-frame equivalent.

Replace `performLookup` with:

```js
  async function performLookup(target, opts = {}) {
    // Two entry points share this:
    //   (a) page hover/click: target = the .lws-word in the DOM. We extract
    //       the sentence from the surrounding DOM and reposition the popup
    //       at the new word.
    //   (b) sentence-word click inside the popup: target = null,
    //       opts.surface = the clicked 어절, opts.sentence = the rebuilt
    //       sentence with that 어절 as the hit. Popup stays at its current
    //       position so the user's reading flow isn't disrupted.
    const surface = opts.surface != null
      ? opts.surface
      : (target && target.dataset.surface);
    if (!surface) return;
    const anchor = target || activeWordEl;
    if (!anchor) return;
    const reposition = Boolean(target);
    const requestId = ++pendingRequestId;
    // Compute the anchor rect in document coordinates so the overlay
    // can position itself without seeing the original DOM element.
    const anchorRect = computeAnchorRect(anchor);

    await showPopup({
      kind: 'loading',
      surface,
      anchor: anchorRect,
      reposition,
    });
    scheduleLookupStatusSequence();

    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: 'lookup', surface });
    } catch (err) {
      clearLookupStatusTimers();
      if (requestId !== pendingRequestId) return;
      await showPopup({
        kind: 'error',
        message: 'Extension is reloading. Hover again in a moment.',
        anchor: anchorRect,
        reposition,
      });
      return;
    }
    clearLookupStatusTimers();
    if (requestId !== pendingRequestId) return;
    if (!response) {
      await showPopup({
        kind: 'error',
        message: 'No response from extension.',
        anchor: anchorRect,
        reposition,
      });
      return;
    }
    if (response.error === 'NO_API_KEY') {
      await showPopup({
        kind: 'error',
        message: 'Set your KRDict API key to use the dictionary.',
        anchor: anchorRect,
        reposition,
        action: {
          label: 'Open settings',
          // The action handler runs in the overlay realm but routes back
          // through chrome.runtime.sendMessage — same realm rules as any
          // background message. We send the action descriptor as data so
          // the overlay can fire it synchronously from a button click.
          actionType: 'openOptions',
        },
      });
      return;
    }
    if (response.error === 'FETCH_FAILED') {
      await showPopup({
        kind: 'error',
        message: "Couldn't reach the dictionary. Hover the word again to retry.",
        details: response.message,
        anchor: anchorRect,
        reposition,
      });
      return;
    }
    if (response.error) {
      await showPopup({
        kind: 'error',
        message: 'Lookup failed. Hover the word again to retry.',
        details: `${response.error}${response.message ? `: ${response.message}` : ''}`,
        anchor: anchorRect,
        reposition,
      });
      return;
    }
    lastPayload = response;
    const sentence = opts.sentence !== undefined
      ? opts.sentence
      : extractSentence(anchor);
    lastSentence = sentence;
    await showPopup({
      kind: 'payload',
      payload: {
        lookup: response,
        sentence,
        anchor: anchorRect,
        secondaryLang,
        defLang,
        askAiProvider,
        askAiPromptTemplate,
        askAiChatGptTemporary,
        reposition,
      },
    });
  }
```

- [ ] **Step 6.6: Add computeAnchorRect helper**

Add this near `positionPopup` in content.js (just below `positionPopup`'s closing brace):

```js
  function computeAnchorRect(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') {
      return { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 };
    }
    const r = el.getBoundingClientRect();
    // Convert from viewport-relative to document-relative coords by adding
    // scrollX/scrollY. The overlay positions itself in document coords
    // (the shadow host is at top: 0; left: 0 of the document).
    const sx = window.scrollX || window.pageXOffset || 0;
    const sy = window.scrollY || window.pageYOffset || 0;
    return {
      top: r.top + sy,
      left: r.left + sx,
      bottom: r.bottom + sy,
      right: r.right + sx,
      width: r.width,
      height: r.height,
    };
  }
```

The original `positionPopup` function can stay as-is for now; it's not called from anywhere after this rewrite, but leaving it avoids breaking Task 7's positioning logic if the overlay component wants to delegate back. Mark it deprecated by adding `/** @deprecated unused — kept for reference; will be removed in a later pass. */` above the function header.

- [ ] **Step 6.7: Rewire scheduleLookupStatusSequence to update the overlay**

The original `scheduleLookupStatusSequence` and `setLookupStatus` lived in Range A (Step 6.1) and called into the deleted `activeLoadingStatusEl`. Re-add a thinner pair that drives the overlay:

```js
  let lookupStatusTimers = [];
  function clearLookupStatusTimers() {
    for (const t of lookupStatusTimers) clearTimeout(t);
    lookupStatusTimers = [];
  }
  function setLookupStatus(key) {
    const label = LOOKUP_STAGE_LABELS[key];
    if (!label) {
      console.warn('[lws] setLookupStatus: unknown stage key', key);
    }
    if (window.__lwsOverlay && typeof window.__lwsOverlay.update === 'function') {
      try {
        window.__lwsOverlay.update({ lookupStatus: label || 'Looking up…' });
      } catch (err) {
        console.warn('[lws] setLookupStatus: overlay.update failed', err);
      }
    }
  }
  function scheduleLookupStatusSequence() {
    clearLookupStatusTimers();
    lookupStatusTimers.push(setTimeout(() => setLookupStatus('cache'), LOOKUP_STATUS_DELAY_MS));
    lookupStatusTimers.push(setTimeout(() => setLookupStatus('morpheme'), LOOKUP_STATUS_DELAY_MS + 150));
    lookupStatusTimers.push(setTimeout(() => setLookupStatus('krdict'), LOOKUP_STATUS_DELAY_MS + 450));
  }
```

Place these in the same area where the originals lived (right after `showPopup`). The `LOOKUP_STAGE_LABELS` and `LOOKUP_STATUS_DELAY_MS` constants at the top of the file (lines 10-19) stay.

- [ ] **Step 6.8: Apply Steps 6.1–6.7 to extension/content.js in one pass**

Execute the deletions and rewrites in one editing pass. The order:

1. Delete Range A (lines 505-545 — `buildLoadingNode` through `scheduleLookupStatusSequence`).
2. Delete Range B (lines 641-903 in original numbering — the sentence/morpheme/insights/error block).
3. Delete Range C (lines 909-1643 in original numbering — entry/tab/section/hanja/chip block).
4. Delete the orphaned `let` declarations from Step 6.2.
5. Add `loadOverlayBundle` (Step 6.3) and the new `ensurePopup` + `showPopup` + `hidePopup` (Step 6.4) at the locations the old ones occupied.
6. Add `computeAnchorRect` (Step 6.6) below `positionPopup`.
7. Replace `performLookup` (Step 6.5) at its existing location.
8. Add the new `scheduleLookupStatusSequence` + `setLookupStatus` + `clearLookupStatusTimers` (Step 6.7) in the space freed by Range A.

After: run `node --check extension/content.js` to verify the file still parses as valid JS.

Expected: no output (parses cleanly).

- [ ] **Step 6.9: Create src/overlay/main.ts (mount + global registration)**

Create `src/overlay/main.ts`:

```ts
import { mount } from 'svelte';
import App from './App.svelte';
import type { OverlayFrame, OverlayApi } from '$types/overlay';

/**
 * Mount the overlay Svelte component into the shadow root that content.js
 * has already prepared (it created `#lws-overlay-root` inside the
 * extension's shadow host). Then register the imperative API on
 * window.__lwsOverlay so content.js can drive show/hide/update from the
 * bridge realm.
 *
 * Realm note: in MV3, content scripts share an isolated `window` per
 * extension id. content.js (a content_script) and this bundle (loaded
 * via dynamic import of a web_accessible_resource) both run in that
 * isolated world, so this `window` is the same `window` content.js sees.
 */

// Look up the mount point. content.js attached the shadow root to the
// host element and put `<div id="lws-overlay-root">` inside it. We find
// it by traversing every shadow root on the page — the overlay host is
// the one with our specific id inside.
function findMountPoint(): HTMLElement | null {
  // Fast path: the host is a direct child of <html> with class `lws-host`.
  const hosts = document.documentElement.querySelectorAll('.lws-host');
  for (const host of hosts) {
    const root = (host as HTMLElement).shadowRoot;
    if (root) {
      const target = root.getElementById('lws-overlay-root');
      if (target) return target;
    }
  }
  return null;
}

const target = findMountPoint();
if (!target) {
  console.warn('[lws] overlay/main.ts: mount point not found');
} else {
  // App.svelte exposes its imperative API by writing to window.__lwsOverlay
  // during mount via $effect. We just mount and let it self-register.
  mount(App, { target });
}

// Defensive: if for any reason App.svelte didn't manage to register the
// global, install a no-op fallback so content.js's `if (window.__lwsOverlay)`
// guard treats the overlay as available but every call is a silent no-op.
setTimeout(() => {
  if (!window.__lwsOverlay) {
    const noop: OverlayApi = {
      show(_f: OverlayFrame) { /* no-op */ },
      hide() { /* no-op */ },
      update(_p) { /* no-op */ },
    };
    window.__lwsOverlay = noop;
    console.warn('[lws] overlay/main.ts: App.svelte did not register window.__lwsOverlay; installed no-op fallback');
  }
}, 0);
```

- [ ] **Step 6.10: Create src/overlay/App.svelte (SKELETON)**

Create `src/overlay/App.svelte`. This is intentionally minimal — it logs every call so manual verification can confirm content.js is reaching the overlay correctly. The full component tree replaces this skeleton in Task 7.

```svelte
<script lang="ts">
  import type { OverlayFrame, OverlayApi } from '$types/overlay';

  let currentFrame = $state<OverlayFrame | null>(null);
  let lookupStatus = $state<string>('');

  // Register the imperative API on window.__lwsOverlay so content.js can
  // drive the overlay from the bridge realm. This $effect runs once on
  // mount (no reactive deps) and removes the global on cleanup.
  $effect(() => {
    const api: OverlayApi = {
      show(frame: OverlayFrame) {
        console.log('[lws-overlay] show', frame);
        currentFrame = frame;
        lookupStatus = '';
      },
      hide() {
        console.log('[lws-overlay] hide');
        currentFrame = null;
        lookupStatus = '';
      },
      update(patch) {
        console.log('[lws-overlay] update', patch);
        if (patch.lookupStatus !== undefined) lookupStatus = patch.lookupStatus;
      },
    };
    window.__lwsOverlay = api;
    return () => {
      if (window.__lwsOverlay === api) {
        window.__lwsOverlay = undefined;
      }
    };
  });
</script>

{#if currentFrame}
  <div class="lws-overlay-skeleton" role="tooltip">
    <strong>overlay mount OK</strong>
    <div>frame.kind = {currentFrame.kind}</div>
    {#if currentFrame.kind === 'loading'}
      <div>surface = {currentFrame.surface}</div>
      <div>status = {lookupStatus || '(none)'}</div>
    {:else if currentFrame.kind === 'error'}
      <div>message = {currentFrame.message}</div>
      {#if currentFrame.details}<div>details = {currentFrame.details}</div>{/if}
    {:else if currentFrame.kind === 'payload'}
      <div>surface = {currentFrame.payload.lookup.surface || '(unknown)'}</div>
      <div>sentence = {currentFrame.payload.sentence?.word || '(none)'}</div>
    {/if}
  </div>
{/if}

<style>
  /* Bare-minimum styling so the placeholder is visible during 6a
   * verification. Task 7 replaces this with the full overlay styling. */
  .lws-overlay-skeleton {
    position: absolute;
    top: 8px;
    left: 8px;
    padding: 8px 12px;
    background: #1e1e2e;
    color: #e8e8f0;
    border: 2px solid #7d8cff;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 13px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    pointer-events: auto;
    z-index: 2147483647;
  }
</style>
```

- [ ] **Step 6.11: Update vite.config.ts to add the overlay entry**

Add the overlay entry to `INPUT_MAP`:

```ts
const INPUT_MAP: Record<string, string> = {
  'pages/options/options': resolve(__dirname, 'src/pages/options/main.ts'),
  'pages/notepad/notepad': resolve(__dirname, 'src/pages/notepad/main.ts'),
  'pages/morpheme-inspector/morpheme-inspector': resolve(__dirname, 'src/pages/morpheme-inspector/main.ts'),
  'pages/popup/popup': resolve(__dirname, 'src/pages/popup/main.ts'),
  'overlay/overlay': resolve(__dirname, 'src/overlay/main.ts'),
};
```

- [ ] **Step 6.12: Update manifest.json**

Modify `extension/manifest.json`. Add `"overlay/main.js"` and `"overlay/main.css"` to the existing `web_accessible_resources[0].resources` array:

```json
  "web_accessible_resources": [
    {
      "resources": [
        "core/popup-shadow.css",
        "core/parsers.js",
        "core/grammar-glosses.js",
        "core/site-configs.js",
        "core/ai-providers.js",
        "adapters/youtube/adapter.js",
        "adapters/youtube/page-hook.js",
        "adapters/netflix/adapter.js",
        "adapters/netflix/page-hook.js",
        "overlay/main.js",
        "overlay/main.css"
      ],
      "matches": ["<all_urls>"]
    }
  ]
```

(Note: `core/popup-shadow.css` stays here for now — Task 7 removes it.)

- [ ] **Step 6.13: Build**

Run: `npm run build`

Expected: build succeeds. Verify:

```bash
ls extension/overlay/main.js extension/overlay/main.css
```

Both files exist.

- [ ] **Step 6.14: Verify content.js still parses**

Run: `node --check extension/content.js`

Expected: no output (clean parse).

- [ ] **Step 6.15: Run tests**

Run: `npm run test:ui && npm test`

Expected: both suites pass; counts unchanged from Task 5.

- [ ] **Step 6.16: Manual Chrome verification (mount path only)**

1. Reload the extension at `chrome://extensions` — confirm no manifest errors
2. Open any page with Korean text (e.g. https://krdict.korean.go.kr)
3. Open DevTools console
4. Hover a Korean word
5. Confirm in the console:
   - `[lws-overlay] show {kind: 'loading', surface: '...', anchor: {...}, reposition: true}`
   - `[lws-overlay] update {lookupStatus: 'Checking cache…'}` (and similar status messages)
   - `[lws-overlay] show {kind: 'payload', payload: {...}}` (after the lookup completes)
6. Confirm the placeholder text appears: a dark blue-bordered box near the top-left of the document showing `overlay mount OK`, the frame kind, and surface
7. Move the mouse away — confirm `[lws-overlay] hide` logs after the 120ms hide delay
8. Verify the placeholder disappears
9. Open the page in DevTools Elements panel — find the `.lws-host` element under `<html>`; expand its shadow root; verify `<div id="lws-overlay-root">` exists and contains the Svelte-rendered placeholder
10. Test other pages (notepad, options, morpheme-inspector, popup) — confirm nothing regressed; popup still opens, options still saves, notepad still wraps Korean

The full popup rendering does NOT work yet — that's Task 7. This commit's success criterion is that the mount path works end-to-end (show/hide/update calls visible in console + placeholder visible in shadow root).

- [ ] **Step 6.17: Commit**

```bash
git add extension/content.js extension/manifest.json \
  vite.config.ts \
  src/overlay/main.ts src/overlay/App.svelte \
  extension/overlay/main.js extension/overlay/main.css
```

```bash
git commit -m "$(cat <<'EOF'
overlay: extract shadow-DOM popup from content.js (infra)

Removes ~1000 lines of imperative DOM construction from content.js
(buildSentenceNode, buildInsightsNode, buildMorphemeChip, tab strip
builders, dictionary entry builders, related-pills, footer). Adds
a minimal Svelte App.svelte mounted into the shadow root via
window.__lwsOverlay.show/hide/update.

Bridge logic in content.js (event routing, hover handling, selection,
video pause/resume, storage listeners) untouched. Overlay renders a
placeholder; full component tree lands in commit 6b.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: overlay components (full implementation)

**Goal:** Replace the skeleton `src/overlay/App.svelte` with the full 9-component overlay tree, port the 856 lines of `extension/core/popup-shadow.css` into a tokens.css plus per-component `<style>` blocks, delete the source CSS file and its manifest entry, and verify all f8afd99-era invariants (exclusive expand within tab, two-stage related reveal, entry-identity dedup) still hold.

**Files:**
- Modify: `src/overlay/App.svelte` (replace skeleton with full orchestration)
- Create: `src/overlay/SentenceBand.svelte`
- Create: `src/overlay/MorphemeBreakdown.svelte`
- Create: `src/overlay/TabStrip.svelte`
- Create: `src/overlay/DictionaryTab.svelte`
- Create: `src/overlay/EntrySection.svelte`
- Create: `src/overlay/RelatedPills.svelte`
- Create: `src/overlay/AskAiPanel.svelte`
- Create: `src/overlay/Footer.svelte`
- Create: `src/overlay/LoadingFrame.svelte`
- Create: `src/overlay/ErrorFrame.svelte`
- Create: `src/overlay/styles/tokens.css`
- Create: `src/overlay/lib/entries.ts` (entryIdentity, materializeGroup ported from content.js)
- Create: `src/overlay/lib/position.ts` (popup positioning logic, ported from content.js positionPopup)
- Create: `src/overlay/lib/askAiUrl.ts` (askAiUrl builder, ported from content.js buildAskAiUrl)
- Create: `src/overlay/lib/sentence.ts` (sentence-word click helper)
- Modify: `extension/manifest.json` (drop `core/popup-shadow.css` from web_accessible_resources)
- Delete: `extension/core/popup-shadow.css`
- Create: `tests/ui/overlay/App.test.ts`

- [ ] **Step 7.1: Create src/overlay/styles/tokens.css (port popup-shadow.css top tokens)**

Read `extension/core/popup-shadow.css` lines 1-92 to capture the `:host` token block, dark-mode override, `#lws-popup` chrome (width, scrollbar), and scrollbar selectors.

Create `src/overlay/styles/tokens.css`:

```css
/* Overlay shadow-root tokens + popup container styles.
 *
 * Ported from extension/core/popup-shadow.css lines 1-92. The :host
 * selector reaches the shadow-root host element; CSS variables defined
 * there cascade into every component <style> block. Component-specific
 * styles (sentence band, morpheme rows, tabs, entry cards, chips,
 * hanja meanings, etc.) live in the per-component <style> blocks in
 * the Svelte components — see Step 7.5 onward. */

:host, * {
  box-sizing: border-box;
}

:host {
  /* Light theme tokens (default) */
  --bg: #ffffff;
  --fg: #1a1a24;
  --muted: #5b6172;
  --soft: #eff1f6;
  --border: #e3e5ec;
  --border-strong: #d4d7e0;

  --chip-amber-bg: #fde4c5;
  --chip-amber-fg: #7a4a18;
  --chip-cyan-bg: #cfe7ed;
  --chip-cyan-fg: #1f5d68;
  --chip-soft-bg: #eff1f6;
  --chip-soft-fg: #5b6172;

  --highlight-bg: #fde4c5;
  --highlight-fg: #7a4a18;
  --stars: #e5a230;

  --popup-border: #b9c0d0;
  --shadow: 0 8px 28px rgba(20, 24, 50, 0.12), 0 2px 4px rgba(20, 24, 50, 0.08);
}

@media (prefers-color-scheme: dark) {
  :host {
    --bg: #1e1e2e;
    --fg: #e8e8f0;
    --muted: #97a0b8;
    --soft: rgba(255, 255, 255, 0.04);
    --border: rgba(255, 255, 255, 0.08);
    --border-strong: rgba(255, 255, 255, 0.14);

    --chip-amber-bg: rgba(247, 198, 136, 0.18);
    --chip-amber-fg: #f7c688;
    --chip-cyan-bg: rgba(155, 213, 224, 0.15);
    --chip-cyan-fg: #9bd5e0;
    --chip-soft-bg: rgba(255, 255, 255, 0.06);
    --chip-soft-fg: #b6bdcc;

    --highlight-bg: rgba(247, 198, 136, 0.22);
    --highlight-fg: #f7c688;
    --stars: #f5c46a;

    --popup-border: rgba(255, 255, 255, 0.18);
    --shadow: 0 12px 36px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.35);
  }
}

#lws-popup {
  /* Page-anchored (not viewport-anchored): the popup is part of the
     document and scrolls with the page. */
  position: absolute;
  width: max-content;
  min-width: 380px;
  max-width: min(520px, calc(100vw - 16px));
  max-height: 70vh;
  overflow-y: auto;
  background: var(--bg);
  color: var(--fg);
  border: 2px solid var(--popup-border);
  border-radius: 12px;
  box-shadow: var(--shadow);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
  font-size: 14px;
  line-height: 1.5;
  pointer-events: auto;
  user-select: text;
  -webkit-user-select: text;
}

#lws-popup::-webkit-scrollbar {
  width: 8px;
}
#lws-popup::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 4px;
}

/* Popup-body / loading / error frames */
.lws-popup-body {
  padding: 14px 18px;
}
.lws-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
}
.lws-loading-word {
  font-size: 15px;
  font-weight: 600;
  color: var(--fg);
}
.lws-loading-status {
  font-size: 12px;
  color: var(--muted);
}
.lws-error {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lws-error-msg {
  font-size: 14px;
  color: var(--fg);
}
.lws-error-detail {
  font-size: 12px;
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-word;
}
.lws-action-btn {
  align-self: flex-start;
  padding: 6px 12px;
  font: inherit;
  font-size: 12px;
  background: var(--chip-amber-bg);
  color: var(--chip-amber-fg);
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
}
.lws-action-btn:hover {
  filter: brightness(1.04);
}
```

- [ ] **Step 7.2: Create src/overlay/lib/entries.ts (dedup helpers ported from content.js)**

Read the original `entryForSection`, `entryIdentity`, `materializeGroup` (lines 909-953 of the pre-Task-6 content.js) — they're the f8afd99 dedup invariant. Port them to TS:

Create `src/overlay/lib/entries.ts`:

```ts
// Entry materialization + identity-based dedup. Lifted from content.js
// (pre-Task-6 lines 909-953). The dedup rule is the f8afd99 invariant:
// when two queries return the same dictionary entry, render it once.
//
// Identity = `${word}|${pos}|${first 80 chars of first sense's definition}`.
// Conservative: a few false negatives (re-render rather than swallow) are
// preferable to a false positive (swallow a real distinct entry).

export interface MaterializedEntry {
  entry: any;
  source: string;
}

export interface MaterializedGroup {
  word: string;
  entries: MaterializedEntry[];
}

/** Compute a stable identity for an entry. Returns null on shape errors. */
export function entryIdentity(e: any): string | null {
  try {
    const def = (e.senses && e.senses[0] && e.senses[0].definition) || '';
    return `${e.word || ''}|${e.pos || ''}|${def.slice(0, 80)}`;
  } catch (err) {
    console.warn('[lws] overlay entries: identity compute failed', err);
    return null;
  }
}

/**
 * Lazy parser cache holder. Attached to the lookup payload (which is
 * passed in by reference from content.js) so tab switches don't re-walk
 * the raw XML. The DOMParser and per-source parsers live in extension/core/parsers.js
 * — we load them at module init via chrome.runtime.getURL.
 */
let parsersPromise: Promise<{
  parseKrdictXml: (xml: string, DOMParser: typeof window.DOMParser) => any[];
  parseOpendictXml: (xml: string, DOMParser: typeof window.DOMParser) => any[];
}> | null = null;

function loadParsers() {
  if (parsersPromise) return parsersPromise;
  parsersPromise = (async () => {
    const url = chrome.runtime.getURL('core/parsers.js');
    const mod = await import(/* @vite-ignore */ url);
    return {
      parseKrdictXml: mod.parseKrdictXml,
      parseOpendictXml: mod.parseOpendictXml,
    };
  })();
  return parsersPromise;
}

/** Resolve a section ref (`{source, queryIdx, itemIdx}`) into the parsed entry. */
async function entryForSection(payload: any, section: { source: string; queryIdx?: number; itemIdx: number }): Promise<any | null> {
  if (!payload.__entryCache) payload.__entryCache = { kr: new Map(), od: null };
  const cache = payload.__entryCache;
  const { parseKrdictXml, parseOpendictXml } = await loadParsers();
  if (section.source === 'od') {
    if (!cache.od) cache.od = parseOpendictXml(payload.odXml, window.DOMParser);
    return cache.od[section.itemIdx] || null;
  }
  let arr = cache.kr.get(section.queryIdx);
  if (!arr) {
    const xml = Array.isArray(payload.krXmls) ? payload.krXmls[section.queryIdx!] : null;
    arr = parseKrdictXml(xml, window.DOMParser);
    cache.kr.set(section.queryIdx, arr);
  }
  return arr[section.itemIdx] || null;
}

/**
 * Materialize a group's sections into deduplicated entries.
 * The synthetic-nnp source bypasses dedup (each is unique by construction).
 */
export async function materializeGroup(payload: any, group: any): Promise<MaterializedGroup> {
  if (!group || !Array.isArray(group.sections)) return { word: group ? group.word : '', entries: [] };
  const entries: MaterializedEntry[] = [];
  const seen = new Set<string>();
  for (const s of group.sections) {
    if (s.source === 'synthetic-nnp') {
      entries.push({ entry: s, source: 'synthetic-nnp' });
      continue;
    }
    const e = await entryForSection(payload, s);
    if (!e) continue;
    const id = entryIdentity(e);
    if (id === null || !seen.has(id)) {
      entries.push({ entry: e, source: s.source });
      if (id !== null) seen.add(id);
    }
  }
  return { word: group.word, entries };
}
```

- [ ] **Step 7.3: Create src/overlay/lib/position.ts (popup positioning)**

Port the positioning logic from content.js `positionPopup` (pre-Task-6 lines 442-470). The overlay component computes its own position from the anchor rect content.js passed in.

Create `src/overlay/lib/position.ts`:

```ts
/**
 * Compute the popup's document-coords top/left given the anchor rect
 * and the popup's measured size. Below-anchor by default; flips above
 * when below would clip the viewport. Clamps horizontally to keep the
 * popup fully on-screen.
 *
 * Ported from content.js positionPopup (pre-Task-6 lines 442-470).
 */
export interface AnchorRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
}

export interface PopupSize {
  width: number;
  height: number;
}

export interface Position {
  top: number;
  left: number;
}

const GAP = 8;
const EDGE = 8;

export function computePosition(anchor: AnchorRect, size: PopupSize): Position {
  // Viewport scroll offsets — anchor is in document coords, the viewport
  // edge calculation needs them.
  const sx = window.scrollX || window.pageXOffset || 0;
  const sy = window.scrollY || window.pageYOffset || 0;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Preferred placement: below the anchor, left-aligned.
  let top = anchor.bottom + GAP;
  let left = anchor.left;

  // Flip above when below would clip the viewport bottom.
  const fitsBelow = (anchor.bottom + GAP + size.height) <= (sy + vh - EDGE);
  if (!fitsBelow) {
    const fitsAbove = (anchor.top - GAP - size.height) >= (sy + EDGE);
    if (fitsAbove) {
      top = anchor.top - GAP - size.height;
    } else {
      // Neither fits — pick the side with more room.
      const roomBelow = (sy + vh) - anchor.bottom;
      const roomAbove = anchor.top - sy;
      if (roomAbove > roomBelow) {
        top = Math.max(sy + EDGE, anchor.top - GAP - size.height);
      } else {
        top = anchor.bottom + GAP;
      }
    }
  }

  // Horizontal clamp: keep the popup fully on-screen.
  const minLeft = sx + EDGE;
  const maxLeft = sx + vw - size.width - EDGE;
  if (left < minLeft) left = minLeft;
  if (left > maxLeft) left = Math.max(minLeft, maxLeft);

  return { top, left };
}
```

- [ ] **Step 7.4: Create src/overlay/lib/askAiUrl.ts**

Port `buildAskAiUrl` from content.js (pre-Task-6 lines 618-638).

Create `src/overlay/lib/askAiUrl.ts`:

```ts
/**
 * Build the Ask-AI URL for the configured provider. The prompt template
 * (from settings) is substituted: {sentence}, {word}, {language}. The
 * URL goes to the provider (ChatGPT, Claude, Gemini, etc.) with the
 * filled prompt as a query parameter.
 *
 * Ported from content.js buildAskAiUrl (pre-Task-6 lines 618-638).
 * The provider table lives in extension/core/ai-providers.js — we load
 * it via chrome.runtime.getURL.
 */

import { DEFAULT_ASK_AI_PROMPT } from '$lib/askAiPrompt';

const SECONDARY_LANG_NAMES: Record<string, string> = {
  en: 'English',
  ja: 'Japanese',
  zh: 'Chinese',
  'zh-TW': 'Traditional Chinese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
  ar: 'Arabic',
  hi: 'Hindi',
  id: 'Indonesian',
  vi: 'Vietnamese',
  th: 'Thai',
  tr: 'Turkish',
  nl: 'Dutch',
  pl: 'Polish',
  off: 'English',
};

let providersPromise: Promise<any> | null = null;
function loadProviders(): Promise<any> {
  if (providersPromise) return providersPromise;
  providersPromise = (async () => {
    const url = chrome.runtime.getURL('core/ai-providers.js');
    const mod = await import(/* @vite-ignore */ url);
    return { AI_PROVIDERS: mod.AI_PROVIDERS, DEFAULT_ASK_AI_PROVIDER: mod.DEFAULT_ASK_AI_PROVIDER };
  })();
  return providersPromise;
}

export interface AskAiOpts {
  sentence: { before: string; word: string; after: string } | null;
  secondaryLang: string;
  askAiProvider: string;
  askAiPromptTemplate: string;
  askAiChatGptTemporary: boolean;
}

export async function buildAskAiUrl(opts: AskAiOpts): Promise<string> {
  const { AI_PROVIDERS, DEFAULT_ASK_AI_PROVIDER } = await loadProviders();
  const provider = AI_PROVIDERS[opts.askAiProvider] || AI_PROVIDERS[DEFAULT_ASK_AI_PROVIDER];
  if (!provider) return '#';

  const langName = SECONDARY_LANG_NAMES[opts.secondaryLang] || SECONDARY_LANG_NAMES['en'];
  const template = opts.askAiPromptTemplate && opts.askAiPromptTemplate.length > 0
    ? opts.askAiPromptTemplate
    : DEFAULT_ASK_AI_PROMPT;

  // Build the sentence string with the focus word wrapped in backticks.
  const s = opts.sentence;
  const sentenceText = s
    ? `${s.before}\`${s.word}\`${s.after}`
    : `\`${opts.sentence?.word || ''}\``;
  const word = s?.word || '';

  const prompt = template
    .replaceAll('{sentence}', sentenceText)
    .replaceAll('{word}', word)
    .replaceAll('{language}', langName);

  // Provider supplies its own URL builder.
  let url: string;
  if (typeof provider.buildUrl === 'function') {
    url = provider.buildUrl(prompt, { temporary: opts.askAiChatGptTemporary });
  } else {
    url = provider.url || '#';
  }
  return url;
}
```

- [ ] **Step 7.5: Create src/overlay/lib/sentence.ts (sentence-word click rebuilder)**

This helper rebuilds a `{before, word, after}` when the user clicks a word inside the sentence band (the popup re-anchors the lookup to the clicked word, same sentence).

Create `src/overlay/lib/sentence.ts`:

```ts
import type { SentenceContext } from '$types/overlay';

/**
 * When a user clicks a word inside the sentence band, rebuild the sentence
 * with that word as the focus. fullText = before + word + after; the new
 * sentence keeps the same text but moves the focus.
 */
export function sentenceFromWordClick(
  fullText: string,
  surface: string,
  offset: number
): SentenceContext {
  return {
    before: fullText.slice(0, offset),
    word: surface,
    after: fullText.slice(offset + surface.length),
  };
}
```

- [ ] **Step 7.6: Create LoadingFrame.svelte**

Create `src/overlay/LoadingFrame.svelte`:

```svelte
<script lang="ts">
  let { surface, status }: { surface: string; status: string } = $props();
</script>

<div class="lws-popup-body lws-loading">
  <span class="lws-loading-word">{surface}</span>
  <span class="lws-loading-status">{status}</span>
</div>
```

(Styles are in `tokens.css` — `.lws-loading`, `.lws-loading-word`, `.lws-loading-status`.)

- [ ] **Step 7.7: Create ErrorFrame.svelte**

Create `src/overlay/ErrorFrame.svelte`:

```svelte
<script lang="ts">
  import { openOptions } from '$lib/messages';

  let { message, details, action }: {
    message: string;
    details?: string;
    action?: { label: string; actionType?: string };
  } = $props();

  async function onAction() {
    if (!action) return;
    if (action.actionType === 'openOptions') {
      try {
        await openOptions();
      } catch (err) {
        console.warn('[lws] overlay ErrorFrame: openOptions failed', err);
      }
    }
  }
</script>

<div class="lws-popup-body lws-error">
  <div class="lws-error-msg">{message}</div>
  {#if details}
    <div class="lws-error-detail">{details}</div>
  {/if}
  {#if action}
    <button class="lws-action-btn" type="button" onclick={onAction}>{action.label}</button>
  {/if}
</div>
```

- [ ] **Step 7.8: Create SentenceBand.svelte**

Port the sentence band rendering from content.js `buildSentenceNode` + `appendSentenceWords` + `buildAiPill` (pre-Task-6 lines 641-738).

Create `src/overlay/SentenceBand.svelte`:

```svelte
<script lang="ts">
  import type { SentenceContext } from '$types/overlay';
  import { sentenceFromWordClick } from './lib/sentence';
  import { buildAskAiUrl, type AskAiOpts } from './lib/askAiUrl';

  let {
    sentence,
    askAi,
    onSentenceWordClick,
  }: {
    sentence: SentenceContext;
    askAi: AskAiOpts;
    onSentenceWordClick: (s: SentenceContext) => void;
  } = $props();

  // Chunk the before/after halves into clickable Korean words + plain runs.
  type Piece =
    | { kind: 'text'; text: string }
    | { kind: 'word'; text: string; offset: number };

  function chunk(text: string, baseOffset: number): Piece[] {
    const out: Piece[] = [];
    if (!text) return out;
    const chunkRe = /\S+/g;
    let lastEnd = 0;
    let m: RegExpExecArray | null;
    while ((m = chunkRe.exec(text)) !== null) {
      if (m.index > lastEnd) out.push({ kind: 'text', text: text.slice(lastEnd, m.index) });
      const piece = m[0];
      const start = piece.search(/[가-힣ᄀ-ᇿ㄰-㆏]/);
      if (start < 0) {
        out.push({ kind: 'text', text: piece });
      } else {
        let end = piece.length;
        while (end > start && !/[가-힣ᄀ-ᇿ㄰-㆏]/.test(piece.charAt(end - 1))) end--;
        if (start > 0) out.push({ kind: 'text', text: piece.slice(0, start) });
        const surface = piece.slice(start, end);
        const surfaceOffset = baseOffset + m.index + start;
        out.push({ kind: 'word', text: surface, offset: surfaceOffset });
        if (end < piece.length) out.push({ kind: 'text', text: piece.slice(end) });
      }
      lastEnd = m.index + piece.length;
    }
    if (lastEnd < text.length) out.push({ kind: 'text', text: text.slice(lastEnd) });
    return out;
  }

  let fullText = $derived(sentence.before + sentence.word + sentence.after);
  let beforePieces = $derived(chunk(sentence.before, 0));
  let afterPieces = $derived(chunk(sentence.after, sentence.before.length + sentence.word.length));

  let askAiHref = $state('#');
  $effect(() => {
    let cancelled = false;
    buildAskAiUrl(askAi).then((url) => {
      if (!cancelled) askAiHref = url;
    });
    return () => { cancelled = true; };
  });

  function onWordClick(piece: Extract<Piece, { kind: 'word' }>, e: Event) {
    e.stopPropagation();
    e.preventDefault();
    onSentenceWordClick(sentenceFromWordClick(fullText, piece.text, piece.offset));
  }

  function onWordKey(piece: Extract<Piece, { kind: 'word' }>, e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') onWordClick(piece, e);
  }
</script>

<div class="lws-sentence">
  <div class="lws-sentence-header">
    <span class="lws-sentence-label">Given sentence</span>
    <a class="lws-ai-pill" href={askAiHref} target="_blank" rel="noopener noreferrer" title="Open in AI service">
      <span class="lws-ai-pill-icon">★</span>
      Ask AI
    </a>
  </div>
  <div class="lws-sentence-text">
    {#each beforePieces as p, i (i)}
      {#if p.kind === 'text'}{p.text}{:else}<span
        class="lws-sentence-word"
        role="button"
        tabindex="0"
        title={`Look up ${p.text}`}
        onclick={(e) => onWordClick(p, e)}
        onkeydown={(e) => onWordKey(p, e)}
      >{p.text}</span>{/if}
    {/each}<span class="lws-sentence-hit">{sentence.word}</span>{#each afterPieces as p, i (i)}{#if p.kind === 'text'}{p.text}{:else}<span
      class="lws-sentence-word"
      role="button"
      tabindex="0"
      title={`Look up ${p.text}`}
      onclick={(e) => onWordClick(p, e)}
      onkeydown={(e) => onWordKey(p, e)}
    >{p.text}</span>{/if}{/each}
  </div>
</div>

<style>
  /* Ported from extension/core/popup-shadow.css lines 95-178. */
  .lws-sentence {
    padding: 12px 16px 10px;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
    line-height: 1.5;
  }
  .lws-sentence-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
    gap: 8px;
  }
  .lws-sentence-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .lws-ai-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 9px;
    font-size: 11px;
    font-weight: 600;
    background: var(--chip-amber-bg);
    color: var(--chip-amber-fg);
    border-radius: 999px;
    text-decoration: none;
    cursor: pointer;
    transition: filter 0.12s ease;
  }
  .lws-ai-pill:hover {
    filter: brightness(1.05);
  }
  .lws-ai-pill-icon {
    color: var(--stars);
    font-size: 11px;
  }
  .lws-sentence-text {
    color: var(--fg);
    word-break: break-word;
  }
  .lws-sentence-hit {
    background: var(--highlight-bg);
    color: var(--highlight-fg);
    padding: 1px 3px;
    border-radius: 3px;
    font-weight: 600;
  }
  .lws-sentence-word {
    cursor: pointer;
    border-radius: 3px;
    padding: 0 1px;
    transition: background 0.1s ease;
  }
  .lws-sentence-word:hover,
  .lws-sentence-word:focus-visible {
    background: rgba(91, 108, 243, 0.12);
    outline: none;
  }
</style>
```

- [ ] **Step 7.9: Create MorphemeBreakdown.svelte**

Port from content.js `buildDecompositionNode`, `buildMorphemeRow`, `buildMorphemeChip` (pre-Task-6 lines 751-820). The grammar-glosses module (`extension/core/grammar-glosses.js`) supplies `morphemeGloss` and `isContentMorpheme`.

Create `src/overlay/MorphemeBreakdown.svelte`:

```svelte
<script lang="ts">
  // Loaded once per module — same module the bridge uses (lookup gives us
  // tokens with surface + pos, and grammar-glosses tells us which are
  // content morphemes worth showing).
  let isContentMorpheme: (m: { form: string; pos: string }) => boolean;
  let morphemeGloss: (m: { form: string; pos: string }) => { en?: string; ko?: string } | null;
  let glossesReady = $state(false);
  $effect(() => {
    (async () => {
      const url = chrome.runtime.getURL('core/grammar-glosses.js');
      const mod = await import(/* @vite-ignore */ url);
      isContentMorpheme = mod.isContentMorpheme;
      morphemeGloss = mod.morphemeGloss;
      glossesReady = true;
    })();
  });

  let { tokens, defLang }: { tokens: any[]; defLang: 'en' | 'ko' } = $props();

  let morphemes = $derived.by(() => {
    if (!glossesReady) return [];
    return tokens
      .map((t: any) => ({ form: t.surface, pos: t.pos || '' }))
      .filter((m: { form: string; pos: string }) => m.form && isContentMorpheme(m));
  });

  // Returns null if fewer than 2 content morphemes — the breakdown is
  // skipped (the headword section already shows that info).
  let visible = $derived(morphemes.length >= 2);
</script>

{#if visible}
  <div class="lws-decomp">
    <div class="lws-decomp-stack">
      {#each morphemes as m, i (i)}
        <div class="lws-morph-row">
          {#if i > 0}<span class="lws-morph-op">+</span>{:else}<span class="lws-morph-op lws-morph-op-empty"></span>{/if}
          <div class="lws-morph">
            <span class="lws-morph-form">{m.form}</span>
            <span class="lws-morph-sep">·</span>
            <span class="lws-morph-tag">{m.pos}</span>
            {#if morphemeGloss(m) as g}
              <span class="lws-morph-gloss">{defLang === 'ko' ? (g.ko || g.en || '') : (g.en || g.ko || '')}</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  /* Ported from extension/core/popup-shadow.css lines 213-291. */
  .lws-decomp {
    padding: 10px 16px 12px;
    border-bottom: 1px solid var(--border);
  }
  .lws-decomp-stack {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .lws-morph-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .lws-morph-op {
    width: 10px;
    color: var(--muted);
    font-size: 12px;
    text-align: center;
    user-select: none;
  }
  .lws-morph-op-empty {
    visibility: hidden;
  }
  .lws-morph {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 3px 8px;
    background: var(--soft);
    border-radius: 6px;
    font-size: 12px;
  }
  .lws-morph-form {
    color: var(--fg);
    font-weight: 600;
  }
  .lws-morph-sep {
    color: var(--muted);
  }
  .lws-morph-tag {
    color: var(--chip-cyan-fg);
    background: var(--chip-cyan-bg);
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 11px;
  }
  .lws-morph-gloss {
    color: var(--muted);
    font-size: 11px;
    font-style: italic;
  }
</style>
```

- [ ] **Step 7.10: Create TabStrip.svelte**

Port from content.js `buildTabBar` + `buildRelatedTabRow` (pre-Task-6 lines 1019-1069 and 1237-1268).

Create `src/overlay/TabStrip.svelte`:

```svelte
<script lang="ts">
  let {
    groups,
    unrelated,
    activeTab,
    relatedExpanded,
    onPrimaryTabClick,
    onRelatedTabClick,
    onToggleRelated,
  }: {
    groups: Array<{ word: string; count?: number }>;
    unrelated: Array<{ word: string; count?: number }>;
    activeTab: { source: 'primary' | 'related'; index: number };
    relatedExpanded: boolean;
    onPrimaryTabClick: (idx: number) => void;
    onRelatedTabClick: (idx: number) => void;
    onToggleRelated: () => void;
  } = $props();
</script>

<div class="lws-tabs" role="tablist">
  {#each groups as g, i (i)}
    {@const isActive = activeTab.source === 'primary' && activeTab.index === i}
    <button
      type="button"
      class="lws-tab"
      class:lws-tab-active={isActive}
      role="tab"
      aria-selected={isActive ? 'true' : 'false'}
      onclick={() => onPrimaryTabClick(i)}
    >
      {g.word}
      {#if g.count != null && g.count > 1}<span class="lws-tab-count">{g.count}</span>{/if}
    </button>
  {/each}

  {#if unrelated.length > 0}
    <button
      type="button"
      class="lws-related-pill"
      class:lws-related-pill-open={relatedExpanded}
      aria-expanded={relatedExpanded ? 'true' : 'false'}
      onclick={onToggleRelated}
    >
      {relatedExpanded ? '−' : '+'} Related ({unrelated.length})
    </button>
  {/if}
</div>

{#if relatedExpanded && unrelated.length > 0}
  <div class="lws-related-tab-row" role="tablist">
    {#each unrelated as u, i (i)}
      {@const isActive = activeTab.source === 'related' && activeTab.index === i}
      <button
        type="button"
        class="lws-tab"
        class:lws-tab-active={isActive}
        role="tab"
        aria-selected={isActive ? 'true' : 'false'}
        onclick={() => onRelatedTabClick(i)}
      >
        {u.word}
        {#if u.count != null && u.count > 1}<span class="lws-tab-count">{u.count}</span>{/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  /* Ported from extension/core/popup-shadow.css lines 474-577. */
  .lws-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 8px 14px 0;
  }
  .lws-tab {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    font: inherit;
    font-size: 12px;
    background: var(--soft);
    color: var(--muted);
    border: 1px solid transparent;
    border-radius: 999px;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .lws-tab:hover:not([aria-selected="true"]) {
    background: rgba(120, 140, 200, 0.18);
  }
  .lws-tab[aria-selected="true"],
  .lws-tab.lws-tab-active {
    background: var(--accent, #5b6cf3);
    color: #ffffff;
    border-color: var(--accent, #5b6cf3);
    font-weight: 600;
  }
  .lws-tab-count {
    background: rgba(0, 0, 0, 0.18);
    color: inherit;
    padding: 0 5px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 700;
  }
  .lws-tab[aria-selected="true"] .lws-tab-count,
  .lws-tab.lws-tab-active .lws-tab-count {
    background: rgba(255, 255, 255, 0.25);
  }
  .lws-related-tab-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px 14px 0;
  }
  .lws-related-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    font: inherit;
    font-size: 11px;
    background: transparent;
    color: var(--muted);
    border: 1px dashed var(--border);
    border-radius: 999px;
    cursor: pointer;
  }
  .lws-related-pill:hover {
    background: rgba(120, 140, 200, 0.1);
  }
  .lws-related-pill.lws-related-pill-open {
    background: var(--soft);
    border-style: solid;
    color: var(--fg);
  }
</style>
```

- [ ] **Step 7.11: Create RelatedPills.svelte (deprecated — folded into TabStrip)**

Two-stage related reveal is now handled inside `TabStrip.svelte` (the `lws-related-pill` button + the conditional `lws-related-tab-row`). Skip creating a separate file. **Update the file list at the top of this task accordingly.**

- [ ] **Step 7.12: Create EntrySection.svelte**

Port the entry section rendering from content.js `buildSectionNode`, `buildSectionHeader`, `buildSenseNode`, `buildOdSenseNode`, `appendExamplesToggle`, `buildHanjaMeaningsNode`, `buildSyntheticSectionNode`, and the chip helpers (`makeChip`, `makePosChip`, `makePronChip`, `makeHanjaChip`).

This is the largest single component. Create `src/overlay/EntrySection.svelte`:

```svelte
<script lang="ts">
  import { lookupHanja } from '$lib/messages';

  let {
    entry,
    source,
    tabId,
    sectionIdx,
    isOpen,
    defLang,
    onToggle,
  }: {
    entry: any;
    source: string;
    tabId: string;
    sectionIdx: number;
    isOpen: boolean;
    defLang: 'en' | 'ko';
    onToggle: () => void;
  } = $props();

  // POS Korean → English mapping. Mirrors content.js posToEnglish (pre-Task-6).
  const POS_KO_TO_EN: Record<string, string> = {
    '명사': 'noun',
    '대명사': 'pronoun',
    '수사': 'numeral',
    '동사': 'verb',
    '형용사': 'adjective',
    '관형사': 'determiner',
    '부사': 'adverb',
    '조사': 'particle',
    '감탄사': 'interjection',
    '의존 명사': 'dependent noun',
    '보조 동사': 'auxiliary verb',
    '보조 형용사': 'auxiliary adjective',
    '접사': 'affix',
  };
  function displayPos(pos: string): string {
    if (!pos) return '';
    if (defLang === 'en' && POS_KO_TO_EN[pos]) return POS_KO_TO_EN[pos];
    return pos;
  }

  // Hanja meanings — lazy-loaded the first time the entry expands with an
  // origin field. Cached per session so re-expand doesn't re-fetch.
  let hanjaState = $state<{ loading: boolean; hanjas: any[] | null; error: string | null }>(
    { loading: false, hanjas: null, error: null }
  );
  $effect(() => {
    if (!isOpen) return;
    if (!entry.origin) return;
    if (hanjaState.hanjas || hanjaState.loading) return;
    hanjaState.loading = true;
    lookupHanja(entry.origin).then((res) => {
      if ('error' in res && res.error) {
        hanjaState = { loading: false, hanjas: null, error: res.message || res.error };
        return;
      }
      hanjaState = { loading: false, hanjas: (res as any).hanjas || [], error: null };
    }).catch((err) => {
      hanjaState = { loading: false, hanjas: null, error: (err as Error).message || String(err) };
    });
  });

  // Per-sense examples expand state.
  let expandedExamples = $state(new Set<string>());
  function toggleExamples(senseId: string) {
    if (expandedExamples.has(senseId)) expandedExamples.delete(senseId);
    else expandedExamples.add(senseId);
    expandedExamples = new Set(expandedExamples);
  }

  let isSynthetic = $derived(source === 'synthetic-nnp');
  let isOd = $derived(source === 'od');
</script>

{#if isSynthetic}
  <div class="lws-entry lws-section lws-section-open lws-synthetic">
    <div class="lws-headline">
      <span class="lws-word-form">{entry.word || ''}</span>
    </div>
    <div class="lws-meta-row">
      <span class="lws-chip lws-chip-cyan" title="Proper noun (name of a person, place, or thing)">고유명사</span>
      <span class="lws-chip lws-chip-soft">၊၊||၊ {entry.pronunciation || ''}</span>
    </div>
    <div class="lws-synthetic-badge">ℹ Proper noun</div>
    <div class="lws-senses">
      <div class="lws-sense lws-synthetic-body">
        <div class="lws-ko-def">{entry.definition || ''}</div>
      </div>
    </div>
  </div>
{:else}
  <div
    class="lws-entry lws-section"
    class:lws-section-open={isOpen}
    class:lws-section-closed={!isOpen}
    class:lws-od-entry={isOd}
  >
    <button
      type="button"
      class="lws-section-header"
      aria-expanded={isOpen ? 'true' : 'false'}
      onclick={onToggle}
    >
      <div class="lws-headline">
        <span class="lws-word-form">{entry.word || ''}</span>
        {#if entry.stars}<span class="lws-stars">{'★'.repeat(Number(entry.stars) || 0)}</span>{/if}
      </div>
      <div class="lws-meta-row">
        {#if entry.pos}<span class="lws-chip lws-chip-cyan">{displayPos(entry.pos)}</span>{/if}
        {#if entry.pronunciation}<span class="lws-chip lws-chip-soft">၊၊||၊ {entry.pronunciation}</span>{/if}
        {#if entry.origin}<span class="lws-chip lws-chip-amber">{entry.origin}</span>{/if}
      </div>
      <span class="lws-section-indicator">{isOpen ? '−' : '+'}</span>
    </button>

    {#if isOpen}
      {#if entry.origin}
        <div class="lws-hanja-meanings">
          {#if hanjaState.loading}
            <div class="lws-hanja-loading">Loading Hanja meanings…</div>
          {:else if hanjaState.error}
            <div class="lws-hanja-empty">Hanja lookup failed: {hanjaState.error}</div>
          {:else if hanjaState.hanjas && hanjaState.hanjas.length > 0}
            {#each hanjaState.hanjas as h, i (i)}
              <div class="lws-hanja-row">
                <div class="lws-hanja-row-char">{(h as any).char || ''}</div>
                <div class="lws-hanja-row-sino">{(h as any).sino || ''}</div>
                <div class="lws-hanja-row-summary">{(h as any).meaning || ''}</div>
              </div>
            {/each}
          {:else if hanjaState.hanjas}
            <div class="lws-hanja-empty">No Hanja entries.</div>
          {/if}
        </div>
      {/if}

      {#if Array.isArray(entry.senses) && entry.senses.length > 0}
        <div class="lws-senses">
          {#each entry.senses as sense, idx (idx)}
            {@const senseId = `${tabId}:${source}:${sectionIdx}:${idx}`}
            <div class="lws-sense">
              <span class="lws-sense-num">{idx + 1}.</span>
              {#if defLang === 'en' && sense.translation}
                <span class="lws-trans-word">{sense.translation.word || ''}</span>
                <span class="lws-trans-dfn">{sense.translation.definition || ''}</span>
              {:else}
                <div class="lws-ko-def">{sense.definition || ''}</div>
              {/if}
              {#if Array.isArray(sense.examples) && sense.examples.length > 0}
                <button
                  type="button"
                  class="lws-examples-toggle"
                  aria-expanded={expandedExamples.has(senseId) ? 'true' : 'false'}
                  onclick={() => toggleExamples(senseId)}
                >
                  {expandedExamples.has(senseId) ? 'Hide' : 'Show'} examples ({sense.examples.length})
                </button>
                {#if expandedExamples.has(senseId)}
                  <ul class="lws-examples">
                    {#each sense.examples as ex, eIdx (eIdx)}
                      <li>{typeof ex === 'string' ? ex : (ex.ko || ex.en || '')}</li>
                    {/each}
                  </ul>
                {/if}
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      {#if isOd}
        <div class="lws-section-label lws-beta">via OpenDict (community-edited)</div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  /* Ported from extension/core/popup-shadow.css lines 579-855 (the
   * entry / section / sense / hanja / synthetic / chip blocks that
   * compose a dictionary entry card). */
  .lws-entry {
    background: var(--bg);
  }
  .lws-entry + .lws-entry {
    border-top: 1px solid var(--border);
  }
  .lws-section-header {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
    grid-template-areas:
      "headline indicator"
      "meta meta";
    width: 100%;
    padding: 10px 16px;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    color: var(--fg);
    font: inherit;
    gap: 4px 12px;
  }
  .lws-section-header .lws-headline { grid-area: headline; }
  .lws-section-header .lws-section-indicator { grid-area: indicator; align-self: center; }
  .lws-section-header .lws-meta-row { grid-area: meta; }
  .lws-section-closed .lws-section-header {
    padding-bottom: 10px;
  }
  .lws-section-closed .lws-meta-row {
    margin-bottom: 0;
  }
  .lws-section-indicator {
    font-size: 16px;
    color: var(--muted);
    font-weight: 400;
    width: 18px;
    text-align: center;
  }
  .lws-headline {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .lws-word-form {
    font-size: 18px;
    font-weight: 700;
    color: var(--fg);
  }
  .lws-stars {
    color: var(--stars);
    font-size: 13px;
    letter-spacing: 1px;
  }
  .lws-meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }
  .lws-senses {
    padding: 4px 16px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .lws-sense {
    position: relative;
    padding-left: 22px;
    font-size: 13px;
    line-height: 1.5;
  }
  .lws-sense-num {
    position: absolute;
    left: 0;
    color: var(--muted);
    font-weight: 600;
    font-size: 12px;
  }
  .lws-trans-word {
    color: var(--fg);
    font-weight: 600;
    margin-right: 6px;
  }
  .lws-trans-dfn {
    color: var(--fg);
  }
  .lws-ko-def {
    color: var(--fg);
  }
  .lws-examples-toggle {
    display: inline-flex;
    margin-top: 4px;
    padding: 2px 8px;
    background: transparent;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 999px;
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  .lws-examples-toggle:hover {
    background: var(--soft);
    color: var(--fg);
  }
  .lws-examples-toggle[aria-expanded="true"] {
    background: var(--soft);
    color: var(--fg);
  }
  .lws-examples {
    margin: 6px 0 0;
    padding-left: 18px;
    color: var(--muted);
    font-size: 12.5px;
    line-height: 1.5;
  }
  .lws-examples li {
    margin-bottom: 2px;
  }
  .lws-section-label {
    padding: 4px 16px 8px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .lws-od-entry {
    border-left: 3px solid var(--chip-amber-fg);
  }
  .lws-beta {
    color: var(--chip-amber-fg);
  }
  .lws-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 7px;
    font-size: 11px;
    font-weight: 500;
    background: var(--chip-soft-bg);
    color: var(--chip-soft-fg);
    border-radius: 999px;
  }
  .lws-chip-amber { background: var(--chip-amber-bg); color: var(--chip-amber-fg); }
  .lws-chip-cyan { background: var(--chip-cyan-bg); color: var(--chip-cyan-fg); }
  .lws-chip-soft { background: var(--chip-soft-bg); color: var(--chip-soft-fg); }
  .lws-hanja-meanings {
    padding: 8px 16px 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .lws-hanja-row {
    display: grid;
    grid-template-columns: 24px auto 1fr;
    gap: 8px;
    align-items: baseline;
    font-size: 12px;
  }
  .lws-hanja-row-char {
    font-size: 16px;
    font-weight: 700;
    color: var(--fg);
  }
  .lws-hanja-row-sino {
    color: var(--muted);
    font-style: italic;
  }
  .lws-hanja-row-summary {
    color: var(--fg);
  }
  .lws-hanja-loading,
  .lws-hanja-empty {
    padding: 6px 16px;
    font-size: 12px;
    color: var(--muted);
  }
  .lws-synthetic {
    background: var(--bg);
  }
  .lws-synthetic-badge {
    padding: 4px 16px 0;
    font-size: 11px;
    color: var(--chip-cyan-fg);
  }
  .lws-synthetic-body {
    padding-left: 22px;
  }
</style>
```

- [ ] **Step 7.13: Create DictionaryTab.svelte**

Wraps a list of EntrySection components for one active tab, enforcing the exclusive-expand invariant (only one entry expanded at a time within the tab; clicking the same one collapses it).

Create `src/overlay/DictionaryTab.svelte`:

```svelte
<script lang="ts">
  import EntrySection from './EntrySection.svelte';
  import type { MaterializedGroup } from './lib/entries';

  let {
    group,
    tabId,
    defLang,
    expandedIdx,
    onSectionToggle,
  }: {
    group: MaterializedGroup;
    tabId: string;
    defLang: 'en' | 'ko';
    expandedIdx: number | null;
    onSectionToggle: (idx: number) => void;
  } = $props();
</script>

<div class="lws-tab-body">
  {#each group.entries as e, idx (idx)}
    <EntrySection
      entry={e.entry}
      source={e.source}
      tabId={tabId}
      sectionIdx={idx}
      isOpen={expandedIdx === idx || e.source === 'synthetic-nnp'}
      defLang={defLang}
      onToggle={() => onSectionToggle(idx)}
    />
  {/each}
</div>

<style>
  .lws-tab-body {
    display: flex;
    flex-direction: column;
  }
</style>
```

- [ ] **Step 7.14: Create AskAiPanel.svelte**

A small companion panel rendered next to the sentence band in cases where the user wants the Ask-AI URL surfaced as its own pill. For parity with the original popup, this lives inside the SentenceBand (Step 7.8) — the standalone panel isn't needed. Create a stub placeholder file with a comment so the file list in the task header is accurate.

Create `src/overlay/AskAiPanel.svelte`:

```svelte
<!--
  AskAiPanel was originally listed as a separate component but the
  Ask-AI pill is rendered inline in SentenceBand.svelte (same as the
  original content.js buildSentenceNode behaviour). This file is kept
  as a marker — if a standalone panel is added in a future commit,
  it lives here.
-->
<script lang="ts">
  // Intentionally empty — see SentenceBand.svelte.
</script>
```

- [ ] **Step 7.15: Create Footer.svelte**

There's no dedicated footer in the original popup (the closest thing is the OpenDict label inside `EntrySection`). Create a minimal stub for parity:

Create `src/overlay/Footer.svelte`:

```svelte
<!--
  No global popup footer existed in the original content.js. The OpenDict
  attribution is rendered per-entry inside EntrySection.svelte
  (see `.lws-section-label.lws-beta`). This file is kept as a marker for
  the file list in the implementation plan.
-->
<script lang="ts">
  // Intentionally empty — no global footer.
</script>
```

- [ ] **Step 7.16: Replace src/overlay/App.svelte with the full orchestrator**

Replace `src/overlay/App.svelte` with the full state-owning root. This implements:

1. Imperative `window.__lwsOverlay = { show, hide, update }` API
2. `lookupPayload` rune storage
3. `activeTab` (primary | related, index) state
4. `relatedExpanded` state (two-stage reveal: first click on related pill reveals the row but DOES NOT auto-select; second click on a related word selects that tab)
5. `expandedSectionByTab` Map<string, number> for the exclusive-expand-within-tab invariant
6. Materialized groups (`MaterializedGroup[]`) computed from the payload via `materializeGroup` (dedup)
7. Positioning the popup using `computePosition` after layout

```svelte
<script lang="ts">
  import type { OverlayFrame, OverlayApi, OverlayPayload } from '$types/overlay';
  import { materializeGroup, type MaterializedGroup } from './lib/entries';
  import { computePosition, type AnchorRect } from './lib/position';
  import SentenceBand from './SentenceBand.svelte';
  import MorphemeBreakdown from './MorphemeBreakdown.svelte';
  import TabStrip from './TabStrip.svelte';
  import DictionaryTab from './DictionaryTab.svelte';
  import LoadingFrame from './LoadingFrame.svelte';
  import ErrorFrame from './ErrorFrame.svelte';

  let currentFrame = $state<OverlayFrame | null>(null);
  let lookupStatus = $state<string>('Initializing…');

  // Per-payload state. Reset every time a new payload frame arrives so the
  // popup behaves like a fresh hover (no stale tab selection / expand state).
  let activeTab = $state<{ source: 'primary' | 'related'; index: number }>({ source: 'primary', index: 0 });
  let relatedExpanded = $state(false);
  let expandedSectionByTab = $state<Map<string, number | null>>(new Map());

  // Materialized groups (dedup applied). Lazy-loaded the first time we need
  // to render — materializeGroup is async because it has to dynamic-import
  // extension/core/parsers.js. While loading, the tab body shows nothing.
  let primaryGroups = $state<MaterializedGroup[]>([]);
  let unrelatedGroups = $state<MaterializedGroup[]>([]);

  // Popup positioning — we wait for the popup body to render, measure, then
  // compute and apply transform.
  let popupEl = $state<HTMLDivElement | undefined>();
  let popupTop = $state(0);
  let popupLeft = $state(0);

  // Register window.__lwsOverlay on mount.
  $effect(() => {
    const api: OverlayApi = {
      show(frame: OverlayFrame) {
        currentFrame = frame;
        if (frame.kind === 'loading') {
          lookupStatus = `Looking up ${frame.surface}…`;
          // Loading frame doesn't replace payload state — keeps last view
          // visible briefly if needed. The frame switch happens on the next
          // payload show.
        }
        if (frame.kind === 'payload') {
          // Reset per-payload state.
          activeTab = { source: 'primary', index: 0 };
          relatedExpanded = false;
          expandedSectionByTab = new Map();
          // Kick async materialization.
          materializeAll(frame.payload);
        }
      },
      hide() {
        currentFrame = null;
        primaryGroups = [];
        unrelatedGroups = [];
      },
      update(patch) {
        if (patch.lookupStatus !== undefined) lookupStatus = patch.lookupStatus;
      },
    };
    window.__lwsOverlay = api;
    return () => {
      if (window.__lwsOverlay === api) {
        window.__lwsOverlay = undefined;
      }
    };
  });

  async function materializeAll(payload: OverlayPayload) {
    const groups = Array.isArray((payload.lookup as any).groups) ? (payload.lookup as any).groups : [];
    const unrelated = Array.isArray((payload.lookup as any).unrelated) ? (payload.lookup as any).unrelated : [];
    const p: MaterializedGroup[] = [];
    for (const g of groups) p.push(await materializeGroup(payload.lookup, g));
    const u: MaterializedGroup[] = [];
    for (const g of unrelated) u.push(await materializeGroup(payload.lookup, g));
    primaryGroups = p;
    unrelatedGroups = u;
    // Default expand: first entry of the first tab.
    if (p.length > 0) {
      const k = tabKey({ source: 'primary', index: 0 });
      const next = new Map(expandedSectionByTab);
      next.set(k, 0);
      expandedSectionByTab = next;
    }
  }

  function tabKey(t: { source: 'primary' | 'related'; index: number }): string {
    return `${t.source}:${t.index}`;
  }

  function onPrimaryTabClick(idx: number) {
    activeTab = { source: 'primary', index: idx };
    ensureDefaultExpand();
  }

  function onRelatedTabClick(idx: number) {
    activeTab = { source: 'related', index: idx };
    ensureDefaultExpand();
  }

  function onToggleRelated() {
    relatedExpanded = !relatedExpanded;
    // First reveal does NOT auto-select a related tab; the user must click
    // a specific related word. Re-collapsing doesn't change activeTab.
  }

  function ensureDefaultExpand() {
    const k = tabKey(activeTab);
    if (expandedSectionByTab.has(k)) return;
    const next = new Map(expandedSectionByTab);
    next.set(k, 0);
    expandedSectionByTab = next;
  }

  function onSectionToggle(tabId: string, idx: number) {
    const next = new Map(expandedSectionByTab);
    const open = next.get(tabId);
    if (open === idx) {
      // Clicking the already-open section closes it (no section expanded).
      next.set(tabId, null);
    } else {
      next.set(tabId, idx);
    }
    expandedSectionByTab = next;
  }

  // Re-anchor on sentence-word click — content.js owns the actual lookup
  // re-fire; we just send a synthetic lookup request via sendMessage. The
  // bridge will receive a new payload via showPopup → window.__lwsOverlay.show.
  function onSentenceWordClick(s: { before: string; word: string; after: string }) {
    chrome.runtime.sendMessage({ type: 'lookup', surface: s.word }).then((response: any) => {
      if (!response || response.error) return;
      if (currentFrame?.kind !== 'payload') return;
      const newPayload: OverlayPayload = {
        ...currentFrame.payload,
        lookup: response,
        sentence: s,
        reposition: false,
      };
      // Drive ourselves via the same API content.js uses.
      window.__lwsOverlay?.show({ kind: 'payload', payload: newPayload });
    });
  }

  // Position the popup after the DOM renders. We use requestAnimationFrame
  // so the measured size reflects the current frame's contents.
  $effect(() => {
    if (!currentFrame || !popupEl) return;
    const anchor: AnchorRect =
      currentFrame.kind === 'payload' ? currentFrame.payload.anchor : (currentFrame as any).anchor;
    const reposition =
      currentFrame.kind === 'payload' ? currentFrame.payload.reposition : (currentFrame as any).reposition;
    if (!reposition) return;
    requestAnimationFrame(() => {
      if (!popupEl) return;
      const rect = popupEl.getBoundingClientRect();
      const pos = computePosition(anchor, { width: rect.width, height: rect.height });
      popupTop = pos.top;
      popupLeft = pos.left;
    });
  });

  // Derived: the currently-active materialized group, or null if loading.
  let activeGroup = $derived.by(() => {
    if (activeTab.source === 'primary') return primaryGroups[activeTab.index] || null;
    return unrelatedGroups[activeTab.index] || null;
  });

  // Tab strip data: minimal {word, count} for each materialized group.
  let primaryTabs = $derived(primaryGroups.map((g) => ({ word: g.word, count: g.entries.length })));
  let unrelatedTabs = $derived(unrelatedGroups.map((g) => ({ word: g.word, count: g.entries.length })));

  let expandedIdx = $derived(expandedSectionByTab.get(tabKey(activeTab)) ?? null);
</script>

{#if currentFrame}
  <div
    id="lws-popup"
    role="tooltip"
    bind:this={popupEl}
    style="top: {popupTop}px; left: {popupLeft}px;"
  >
    {#if currentFrame.kind === 'loading'}
      <LoadingFrame surface={currentFrame.surface} status={lookupStatus} />
    {:else if currentFrame.kind === 'error'}
      <ErrorFrame
        message={currentFrame.message}
        details={currentFrame.details}
        action={currentFrame.action}
      />
    {:else if currentFrame.kind === 'payload'}
      {@const payload = currentFrame.payload}
      {#if payload.sentence}
        <SentenceBand
          sentence={payload.sentence}
          askAi={{
            sentence: payload.sentence,
            secondaryLang: payload.secondaryLang,
            askAiProvider: payload.askAiProvider,
            askAiPromptTemplate: payload.askAiPromptTemplate,
            askAiChatGptTemporary: payload.askAiChatGptTemporary,
          }}
          onSentenceWordClick={onSentenceWordClick}
        />
      {/if}
      {#if Array.isArray((payload.lookup as any).tokens)}
        <MorphemeBreakdown tokens={(payload.lookup as any).tokens} defLang={payload.defLang} />
      {/if}
      <TabStrip
        groups={primaryTabs}
        unrelated={unrelatedTabs}
        activeTab={activeTab}
        relatedExpanded={relatedExpanded}
        onPrimaryTabClick={onPrimaryTabClick}
        onRelatedTabClick={onRelatedTabClick}
        onToggleRelated={onToggleRelated}
      />
      {#if activeGroup}
        <DictionaryTab
          group={activeGroup}
          tabId={tabKey(activeTab)}
          defLang={payload.defLang}
          expandedIdx={expandedIdx}
          onSectionToggle={(idx) => onSectionToggle(tabKey(activeTab), idx)}
        />
      {/if}
    {/if}
  </div>
{/if}
```

- [ ] **Step 7.17: Update main.ts to import tokens.css**

Edit `src/overlay/main.ts` to import the tokens stylesheet so it ends up in the bundle and applies to the shadow root:

Add this near the top, above `import App from './App.svelte';`:

```ts
import './styles/tokens.css';
```

- [ ] **Step 7.18: Inject the bundle's CSS into the shadow root**

CSS imported by a Svelte file in a shadow-DOM mount doesn't automatically scope to the shadow root — Vite emits it as a regular stylesheet next to `main.js`. We must inject a `<link>` into the shadow root pointing at `extension/overlay/main.css`.

Update `src/overlay/main.ts`. Replace the body with:

```ts
import { mount } from 'svelte';
import './styles/tokens.css';
import App from './App.svelte';
import type { OverlayFrame, OverlayApi } from '$types/overlay';

function findMountPoint(): { target: HTMLElement; root: ShadowRoot } | null {
  const hosts = document.documentElement.querySelectorAll('.lws-host');
  for (const host of hosts) {
    const root = (host as HTMLElement).shadowRoot;
    if (root) {
      const target = root.getElementById('lws-overlay-root');
      if (target) return { target, root };
    }
  }
  return null;
}

const found = findMountPoint();
if (!found) {
  console.warn('[lws] overlay/main.ts: mount point not found');
} else {
  // Inject the bundle's CSS into the shadow root so tokens + the per-component
  // CSS Vite emits are scoped to the popup. The component <style> blocks are
  // Svelte-scoped (compiled to unique class names) — adding the link gives
  // them somewhere to resolve.
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('overlay/main.css');
  found.root.appendChild(link);
  mount(App, { target: found.target });
}

setTimeout(() => {
  if (!window.__lwsOverlay) {
    const noop: OverlayApi = {
      show(_f: OverlayFrame) { /* no-op */ },
      hide() { /* no-op */ },
      update(_p) { /* no-op */ },
    };
    window.__lwsOverlay = noop;
    console.warn('[lws] overlay/main.ts: App.svelte did not register window.__lwsOverlay; installed no-op fallback');
  }
}, 0);
```

- [ ] **Step 7.19: Update manifest.json — drop popup-shadow.css**

Edit `extension/manifest.json`. Remove `"core/popup-shadow.css"` from the `web_accessible_resources[0].resources` array. The final list:

```json
  "web_accessible_resources": [
    {
      "resources": [
        "core/parsers.js",
        "core/grammar-glosses.js",
        "core/site-configs.js",
        "core/ai-providers.js",
        "adapters/youtube/adapter.js",
        "adapters/youtube/page-hook.js",
        "adapters/netflix/adapter.js",
        "adapters/netflix/page-hook.js",
        "overlay/main.js",
        "overlay/main.css"
      ],
      "matches": ["<all_urls>"]
    }
  ]
```

- [ ] **Step 7.20: Delete extension/core/popup-shadow.css**

```bash
git rm extension/core/popup-shadow.css
```

- [ ] **Step 7.21: Confirm content.js doesn't reference popup-shadow.css**

After Task 6's `ensurePopup` rewrite (Step 6.4), the new `ensurePopup` doesn't inject a `<link>` for popup-shadow.css. Re-confirm:

```bash
grep -n 'popup-shadow' extension/content.js
```

Expected: no matches. If any survive (e.g. a stale comment), remove them.

- [ ] **Step 7.22: Create tests/ui/overlay/App.test.ts**

Run: `mkdir -p tests/ui/overlay`

Create `tests/ui/overlay/App.test.ts`. The test verifies the orchestration invariants: tab switching changes active payload, exclusive-expand collapses the previous section, two-stage related reveal works, dedup is preserved (same identity = single entry).

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

// Mock chrome before importing the App.
function setupChrome() {
  const sendMessage = vi.fn(async (msg: any) => {
    if (msg.type === 'lookup') {
      return { surface: msg.surface, tokens: [], groups: [], unrelated: [] };
    }
    if (msg.type === 'lookupHanja') return { chars: msg.chars, hanjas: [] };
    return {};
  });
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      getURL: (p: string) => `chrome-extension://test/${p}`,
    },
    storage: {
      sync: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      onChanged: { addListener: () => {} },
    },
  });
  return sendMessage;
}

// A pre-materialized payload — bypasses the parsers.js dynamic import by
// pre-populating the __entryCache so materializeGroup finds entries directly.
function makePayload(opts: { dupAcrossQueries?: boolean } = {}): any {
  const baseEntry = {
    word: '학교',
    pos: '명사',
    pronunciation: '학꾜',
    senses: [{ definition: '학생들이 공부하는 곳', translation: { word: 'school', definition: 'a place of education' } }],
  };
  const alt = {
    word: '학교',
    pos: '명사',
    pronunciation: '학꾜',
    senses: [{ definition: '교육 기관', translation: { word: 'school', definition: 'an institution' } }],
  };
  const odEntry = {
    word: '학교',
    pos: '명사',
    pronunciation: '학꾜',
    senses: [{ definition: '학생들이 공부하는 곳' }],
  };
  // Two primary groups: one normal (1 entry), one with two sections that
  // dedup to the same entry when dupAcrossQueries=true.
  const payload: any = {
    surface: '학교',
    tokens: [
      { surface: '학교', pos: '명사' },
    ],
    krXmls: ['<x/>', '<x/>'],
    odXml: '<x/>',
    groups: [
      { word: '학교', sections: [{ source: 'kr', queryIdx: 0, itemIdx: 0 }] },
      { word: '학교2', sections: [
        { source: 'kr', queryIdx: 0, itemIdx: 0 },
        { source: 'kr', queryIdx: 1, itemIdx: 0 },
      ] },
    ],
    unrelated: [
      { word: '학생', sections: [{ source: 'kr', queryIdx: 0, itemIdx: 0 }] },
    ],
  };
  // Pre-populate the entry cache so materializeGroup doesn't hit the
  // parsers dynamic import. opts.dupAcrossQueries makes the queryIdx=1
  // hit return the identical-identity entry; otherwise alt.
  payload.__entryCache = {
    kr: new Map<number, any[]>([
      [0, [baseEntry]],
      [1, [opts.dupAcrossQueries ? { ...baseEntry } : alt]],
    ]),
    od: [odEntry],
  };
  return payload;
}

function makeFrame(payload: any) {
  return {
    kind: 'payload',
    payload: {
      lookup: payload,
      sentence: { before: '오늘 ', word: '학교', after: '에 갔어요.' },
      anchor: { top: 100, left: 100, bottom: 120, right: 200, width: 100, height: 20 },
      secondaryLang: 'en',
      defLang: 'en' as const,
      askAiProvider: 'chatgpt',
      askAiPromptTemplate: '',
      askAiChatGptTemporary: false,
      reposition: true,
    },
  };
}

describe('overlay App.svelte orchestration', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('mounts and registers window.__lwsOverlay', async () => {
    setupChrome();
    const { default: App } = await import('../../../src/overlay/App.svelte');
    render(App);
    await new Promise((r) => setTimeout(r, 5));
    expect((window as any).__lwsOverlay).toBeTruthy();
    expect(typeof (window as any).__lwsOverlay.show).toBe('function');
  });

  it('tab switching changes the active group', async () => {
    setupChrome();
    const { default: App } = await import('../../../src/overlay/App.svelte');
    render(App);
    await new Promise((r) => setTimeout(r, 5));
    const payload = makePayload();
    (window as any).__lwsOverlay.show(makeFrame(payload));
    // Wait for async materializeGroup to settle.
    await new Promise((r) => setTimeout(r, 30));
    // Tab 0 active by default — its first entry expanded.
    const tabs = document.querySelectorAll('.lws-tab');
    expect(tabs.length).toBeGreaterThanOrEqual(2);
    // Click tab 1.
    await fireEvent.click(tabs[1]);
    await new Promise((r) => setTimeout(r, 10));
    // Tab 1 now has aria-selected=true.
    const updatedTabs = document.querySelectorAll('.lws-tab');
    expect(updatedTabs[1].getAttribute('aria-selected')).toBe('true');
    expect(updatedTabs[0].getAttribute('aria-selected')).toBe('false');
  });

  it('exclusive expand: opening entry B collapses entry A', async () => {
    setupChrome();
    const { default: App } = await import('../../../src/overlay/App.svelte');
    render(App);
    await new Promise((r) => setTimeout(r, 5));
    const payload = makePayload();
    (window as any).__lwsOverlay.show(makeFrame(payload));
    await new Promise((r) => setTimeout(r, 30));
    // Switch to tab 1, which has two sections (before dedup).
    const tabs = document.querySelectorAll('.lws-tab');
    await fireEvent.click(tabs[1]);
    await new Promise((r) => setTimeout(r, 10));
    const headers = document.querySelectorAll('.lws-section-header');
    // Default: first section open, second closed.
    expect(headers[0].getAttribute('aria-expanded')).toBe('true');
    expect(headers[1].getAttribute('aria-expanded')).toBe('false');
    // Click the second section's header — it should open and the first should close.
    await fireEvent.click(headers[1]);
    await new Promise((r) => setTimeout(r, 10));
    const updated = document.querySelectorAll('.lws-section-header');
    expect(updated[0].getAttribute('aria-expanded')).toBe('false');
    expect(updated[1].getAttribute('aria-expanded')).toBe('true');
  });

  it('two-stage related reveal: first click reveals the row, does NOT auto-select', async () => {
    setupChrome();
    const { default: App } = await import('../../../src/overlay/App.svelte');
    render(App);
    await new Promise((r) => setTimeout(r, 5));
    const payload = makePayload();
    (window as any).__lwsOverlay.show(makeFrame(payload));
    await new Promise((r) => setTimeout(r, 30));
    // No related row visible yet.
    expect(document.querySelector('.lws-related-tab-row')).toBeNull();
    // Click the related pill.
    const pill = document.querySelector('.lws-related-pill') as HTMLButtonElement;
    expect(pill).toBeTruthy();
    await fireEvent.click(pill);
    await new Promise((r) => setTimeout(r, 10));
    // Now the row exists with one button (the '학생' related word).
    expect(document.querySelector('.lws-related-tab-row')).toBeTruthy();
    // ActiveTab should still be primary, index 0 — first click only reveals.
    const primaryTabs = document.querySelectorAll('.lws-tabs > .lws-tab');
    expect(primaryTabs[0].getAttribute('aria-selected')).toBe('true');
    // Click the related tab button — second stage.
    const relatedTab = document.querySelector('.lws-related-tab-row .lws-tab') as HTMLButtonElement;
    await fireEvent.click(relatedTab);
    await new Promise((r) => setTimeout(r, 10));
    expect(relatedTab.getAttribute('aria-selected')).toBe('true');
  });

  it('entry dedup: same identity across queries renders once (f8afd99 invariant)', async () => {
    setupChrome();
    const { default: App } = await import('../../../src/overlay/App.svelte');
    render(App);
    await new Promise((r) => setTimeout(r, 5));
    const payload = makePayload({ dupAcrossQueries: true });
    (window as any).__lwsOverlay.show(makeFrame(payload));
    await new Promise((r) => setTimeout(r, 30));
    // Switch to tab 1 (the group with two identical-identity sections).
    const tabs = document.querySelectorAll('.lws-tab');
    await fireEvent.click(tabs[1]);
    await new Promise((r) => setTimeout(r, 10));
    // Exactly one section should render (dedup).
    const headers = document.querySelectorAll('.lws-section-header');
    expect(headers.length).toBe(1);
  });
});
```

- [ ] **Step 7.23: Build**

Run: `npm run build`

Expected: build succeeds. Verify:

```bash
ls extension/overlay/main.js extension/overlay/main.css
```

The CSS file should be substantially larger than the Task 6 placeholder version (tokens + 6 component blocks).

- [ ] **Step 7.24: Run all tests**

Run: `npm test && npm run test:ui`

Expected:

- Node suite: original 6 test files pass (count unchanged from Task 1).
- UI suite: 4 (storage) + 4 (options) + 5 (overlay App) = 13 tests pass across 3 files.

```
 Test Files  3 passed (3)
      Tests  13 passed (13)
```

- [ ] **Step 7.25: Verify content.js still parses**

Run: `node --check extension/content.js`

Expected: no output.

- [ ] **Step 7.26: Manual Chrome verification (full lookup flow)**

1. Reload the extension at `chrome://extensions`
2. Open https://krdict.korean.go.kr (or any page with Korean text)
3. Hover the word `학교` (or any common Korean word)
4. **Sentence band** renders with `Given sentence` label + `Ask AI` pill on the right, the sentence text with hoverable words and the focus word highlighted
5. **Morpheme breakdown** appears between sentence and tabs IF the word has 2+ content morphemes
6. **Tab strip** shows one tab per primary group (highlighted active one in accent color); `+ Related (N)` pill on the right if any unrelated groups exist
7. **Entry section** for the first group's first entry renders below: word form + POS chip + pronunciation chip + Hanja chip (if origin present); senses 1..N with English translation or Korean definition (per defLang)
8. Click the tab strip's second tab — confirm the body switches; first tab's expand state preserved when clicking back
9. Click an entry section's header to collapse it — confirm the body hides
10. Click a different entry's header in the same tab — confirm the first one collapses (exclusive-expand within tab)
11. Click `+ Related (N)` pill — confirm the related-tab-row appears below the main tab strip; activeTab stays on primary[0]
12. Click a related word — confirm it becomes the active tab; activeTab is now `related:idx`
13. Click `Show examples (N)` on a sense — confirm examples expand
14. Hover over a word in the sentence band — click it — confirm the popup re-anchors to that word with the same sentence (sentence stays, focus changes)
15. Look up a word that has `origin` (Hanja, e.g. `학교` → `學校`) — confirm the Hanja meanings panel loads with characters and meanings
16. Trigger an error state: temporarily clear the KRDict key in options, then hover a word — confirm the error frame shows "Set your KRDict API key…" with an "Open settings" button; click it and confirm the options page opens. Restore the key.
17. Open DevTools → check no console errors during any of the above

- [ ] **Step 7.27: Commit**

```bash
git add extension/manifest.json extension/content.js \
  src/overlay/App.svelte src/overlay/main.ts \
  src/overlay/SentenceBand.svelte \
  src/overlay/MorphemeBreakdown.svelte \
  src/overlay/TabStrip.svelte \
  src/overlay/DictionaryTab.svelte \
  src/overlay/EntrySection.svelte \
  src/overlay/AskAiPanel.svelte \
  src/overlay/Footer.svelte \
  src/overlay/LoadingFrame.svelte \
  src/overlay/ErrorFrame.svelte \
  src/overlay/styles/tokens.css \
  src/overlay/lib/entries.ts \
  src/overlay/lib/position.ts \
  src/overlay/lib/askAiUrl.ts \
  src/overlay/lib/sentence.ts \
  tests/ui/overlay/App.test.ts \
  extension/overlay/main.js extension/overlay/main.css
```

```bash
git commit -m "$(cat <<'EOF'
overlay: full component tree + popup-shadow.css drain

Implements the 9-component overlay tree (App + SentenceBand,
MorphemeBreakdown, TabStrip, DictionaryTab, EntrySection,
RelatedPills folded into TabStrip, AskAiPanel + Footer stubs).
Tab switching, exclusive expand-within-tab, two-stage related
reveal, and entry-identity dedup (preserved from f8afd99) all
live in App.svelte's $state orchestration.

extension/core/popup-shadow.css (856L) deleted; CSS variables
ported to src/overlay/styles/tokens.css; component-specific styles
moved into per-component <style> blocks.

manifest.json web_accessible_resources updated to drop the deleted
CSS file.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review (run after writing the plan, fix inline)

This was performed at plan-writing time. Findings:

**1. Spec coverage:**

| Spec requirement | Plan coverage |
|---|---|
| In scope: popup, options, notepad, morpheme-inspector | Tasks 2 (options), 3 (notepad), 4 (inspector), 5 (popup) |
| In scope: in-page shadow popup from content.js | Tasks 6 + 7 |
| In scope: distribute popup-shadow.css across components | Task 7 |
| Out of scope: background.js, adapters, vendor, parsers, etc. | Plan never edits these |
| Decision 1: single branch svelte-rewrite, separate commits per surface | 7 tasks = 7 commits |
| Decision 2: hybrid Vite, hand-edited manifest, output committed | Task 1 vite.config.ts; output added at each surface task |
| Decision 3: Svelte 5 runes | All components use $state/$derived/$effect |
| Decision 4: TS for Svelte; plain JS untouched | tsconfig isolates src/; content.js etc. unchanged |
| Decision 5: typed message wrappers in src/lib/messages.ts | Task 1 step 1.13 |
| Decision 6: window.__lwsOverlay global | Task 6 step 6.3 (loader) + 6.9 (registration) + 6.10 (skeleton API) + 7.16 (full API) |
| Decision 7: hybrid CSS, scoped-by-default, tokens.css per surface | page-shell.css (1.16) + per-surface tokens.css (2.2, 3.3, 4.3, 5.3, 7.1) + per-component <style> blocks |
| Component breakdown per surface | Tasks 2-7 each create the listed components |
| Testing approach: existing node tests untouched; vitest added in commit 1 | Task 1 step 1.4 + 1.20 (no regression); Task 1 step 1.17 (vitest harness); Task 2 step 2.13 (options test); Task 7 step 7.22 (overlay test) |
| Risk: content.js bridge surgery split 6a+6b | Tasks 6 + 7 |

No gaps found.

**2. Placeholder scan:**

Searched for "TBD", "TODO", "implement later", "similar to", "follow the pattern", "fill in" — none present in the executable steps. The only "intentionally empty" file (AskAiPanel.svelte, Footer.svelte) ships with a comment explaining why; their existence keeps the file list accurate.

**3. Type consistency:**

- `LookupResponse` in Task 1 → used as `Promise<LookupResponse>` from `lookup()` in 1.13 → consumed in performLookup rewrite (Task 6) as `response = await chrome.runtime.sendMessage(...)` (kept raw because content.js is plain JS, not the wrapper)
- `OverlayFrame` in Task 1 (overlay.ts) → `window.__lwsOverlay.show(frame)` signature in Task 6 (skeleton) and Task 7 (full App) consistent
- `Settings` interface keys (Task 1) → `settings.value.krdictApiKey` etc. used in Tasks 2 (options) and 7 (askAiUrl reads askAiPromptTemplate via payload — content.js fills the payload from its own copies of the same keys, which it loads from chrome.storage in its existing init code, kept unchanged)
- `CacheCounts` shape used identically in cache.ts (Task 1) and CacheSection.svelte (Task 2)
- `MecabToken` / `MecabNbestPath` (Task 1) → consumed in TokenTable / NbestSection / CandidatesSection (Task 4)
- `AnchorRect` in Task 7 lib/position.ts matches the `anchor` field shape of `OverlayPayload` declared in Task 1 (top/left/bottom/right/width/height)

**4. Command consistency:**

All `npm run` invocations match Task 1's `package.json`:
- `npm run build` (Tasks 1, 2, 3, 4, 5, 6, 7)
- `npm run test:ui` (Tasks 1, 2, 3, 4, 5, 6, 7)
- `npm test` (Tasks 1, 2, 3, 4, 5, 6, 7)
- `npm install` (Task 1 only)

No reference to old `build:chrome` etc. anywhere in the plan body; those are now `package:chrome` (documented in DEVELOPMENT.md update in Task 2).

**5. File path consistency:**

- `src/pages/options/main.ts` — created in 2.3, mounted in 2.4, referenced in vite.config (2.9, 3.2, 4.2, 5.2, 6.11)
- `extension/pages/options/main.js` — emit target in 2.9, verified in 2.10, committed in 2.19
- `src/overlay/main.ts` — created in 6.9, updated in 7.17, 7.18; committed in 6.17 (skeleton state) and 7.27 (full state)
- `src/overlay/App.svelte` — created in 6.10 (skeleton), replaced in 7.16 (full)
- `tests/ui/storage.test.ts` (1.17), `tests/ui/options/App.test.ts` (2.13), `tests/ui/overlay/App.test.ts` (7.22) — consistent throughout

**Issues found and fixed inline during self-review:**

- Initial plan had `RelatedPills.svelte` as a separate file; on review, the two-stage reveal is simpler as a region inside `TabStrip.svelte`. Updated Task 7 step 7.11 to mark RelatedPills as folded into TabStrip; the commit message in 7.27 reflects this.
- Initial plan listed `src/overlay/styles/tokens.css` as only the `:host` + `#lws-popup` block; on review, the loading/error frame styles need to live somewhere component-CSS doesn't fit (the LoadingFrame/ErrorFrame components are minimal and the bg/border styles belong to the popup chrome). Moved those styles into tokens.css under step 7.1.
- Task 6 originally said "load overlay bundle as `<script type="module" src=...>` injected into shadow root". That doesn't actually work — module scripts inside shadow roots don't execute. Updated to dynamic `import()` in the content-script realm (Step 6.3); the bundle's top-level code calls `mount()` which finds the shadow root by querying `document.documentElement` for the host element.
- Vite-emitted CSS doesn't automatically scope to a shadow root. Added Step 7.18 to inject a `<link rel="stylesheet">` into the shadow root from inside `main.ts` so the bundle's CSS reaches the shadow tree.
