import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SETTINGS_DEFAULTS, SETTINGS_KEYS } from '../../../src/types/settings';

// One persistent chrome stub for the whole test file. The settings store
// (src/lib/storage.svelte.ts) installs an onChanged listener on first import;
// that listener captures THIS stub by reference. If we swap the global chrome
// object between tests, the listener still talks to the original stub and
// silently misses the new test's setup. Sharing one stub + a reset() helper
// keeps everything attached to the same listener registry.
const store = new Map<string, unknown>();
const listeners: Array<(changes: any, area: string) => void> = [];
const chromeStub = {
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
};
vi.stubGlobal('chrome', chromeStub);

/** Reset the in-memory store and broadcast every change through onChanged
 *  so the (already-hydrated) settings store sees this test's seed values.
 *  Keys absent from `seed` revert to SETTINGS_DEFAULTS — we push the default
 *  through the listener because patch() in the store skips undefined values. */
async function resetStorage(seed: Record<string, unknown> = {}) {
  store.clear();
  for (const [k, v] of Object.entries(seed)) store.set(k, v);
  const changes: Record<string, any> = {};
  for (const k of SETTINGS_KEYS) {
    if (k in seed) {
      changes[k] = { newValue: (seed as any)[k] };
    } else {
      // Defaulted: push the default value so the store overrides whatever
      // leaked from a previous test.
      changes[k] = { newValue: SETTINGS_DEFAULTS[k] };
    }
  }
  for (const l of listeners) l(changes, 'sync');
  await new Promise((r) => setTimeout(r, 0));
}

describe('options App.svelte', () => {
  beforeEach(async () => {
    chromeStub.runtime.sendMessage.mockClear();
    // Defaults-only baseline; individual tests override below.
    await resetStorage({});
  });

  it('renders the 4 sections after settings hydrate', async () => {
    await resetStorage({ krdictApiKey: 'abc', secondaryLang: 'ja' });
    const { default: App } = await import('../../../src/pages/options/App.svelte');
    render(App);
    // Allow the hydration $effect to flush and the loading state to clear.
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByText('API keys')).toBeTruthy();
    expect(screen.getByText('Behaviour')).toBeTruthy();
    expect(screen.getByText('Cache')).toBeTruthy();
  });

  it('KRDict input reflects the settings store and writes back on Save', async () => {
    await resetStorage({ krdictApiKey: 'initial' });
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
    expect(store.get('krdictApiKey')).toBe('new-key');
  });

  it('secondary-language dropdown writes through on change', async () => {
    await resetStorage({ secondaryLang: 'en' });
    const { default: App } = await import('../../../src/pages/options/App.svelte');
    render(App);
    await new Promise((r) => setTimeout(r, 10));
    const select = document.querySelector('select') as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: 'fr' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(store.get('secondaryLang')).toBe('fr');
  });

  it('cache section populates counts and clears on click', async () => {
    await resetStorage({});
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
    const clearCalls = chromeStub.runtime.sendMessage.mock.calls.filter(
      ([m]: any) => m.type === 'clearCache' && m.target === 'lookup'
    );
    expect(clearCalls.length).toBeGreaterThanOrEqual(1);
  });
});
