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
