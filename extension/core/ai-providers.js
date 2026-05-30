/**
 * Registry of AI services for the "Ask AI" pill.
 *
 * Each provider:
 *   - `name`: display label (pill tooltip + options-page dropdown)
 *   - `urlPrefix`: URL the rendered prompt is appended to, URL-encoded.
 *     Open in a new tab and the service starts a chat with the prompt.
 *
 * Adding a provider is purely additive — append an entry below. Both
 * the options page (populates the dropdown) and `content.js` (builds
 * the pill href) read this registry, so neither needs editing.
 *
 * Loaded from:
 *   - `content.js` via `import(chrome.runtime.getURL('core/ai-providers.js'))`
 *     (content-script context can't use static relative imports).
 *   - `pages/options/options.js` via dynamic `import('../../core/ai-providers.js')`
 *     (extension page context).
 *
 * Add this file to `web_accessible_resources` in manifest.json so the
 * content script's runtime URL resolves.
 */

export const AI_PROVIDERS = {
  chatgpt: { name: 'ChatGPT', urlPrefix: 'https://chatgpt.com/?q=' },
  claude:  { name: 'Claude',  urlPrefix: 'https://claude.ai/new?q=' },
};

export const DEFAULT_ASK_AI_PROVIDER = 'chatgpt';
