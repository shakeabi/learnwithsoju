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
