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
    const mod = await import('../../src/lib/storage.svelte');
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
    const mod = await import('../../src/lib/storage.svelte');
    await mod.settingsReady();
    await mod.setSetting('secondaryLang', 'fr');
    expect(stub.backing.get('secondaryLang')).toBe('fr');
    expect(mod.settings.value.secondaryLang).toBe('fr');
  });

  it('onChanged events update the store live', async () => {
    const stub = makeChromeStub({ secondaryLang: 'en' });
    vi.stubGlobal('chrome', stub.chrome);
    const mod = await import('../../src/lib/storage.svelte');
    await mod.settingsReady();
    expect(mod.settings.value.secondaryLang).toBe('en');

    stub.emit({ secondaryLang: { newValue: 'de', oldValue: 'en' } });

    expect(mod.settings.value.secondaryLang).toBe('de');
  });

  it('removeSetting reverts to default and writes through', async () => {
    const stub = makeChromeStub({ secondaryLang: 'ja' });
    vi.stubGlobal('chrome', stub.chrome);
    const mod = await import('../../src/lib/storage.svelte');
    await mod.settingsReady();
    await mod.removeSetting('secondaryLang');
    expect(stub.backing.has('secondaryLang')).toBe(false);
    expect(mod.settings.value.secondaryLang).toBe('en');
  });
});
