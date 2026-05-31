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
  zh: 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)',
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

  const langName = SECONDARY_LANG_NAMES[opts.secondaryLang] || opts.secondaryLang || 'English';
  const template = opts.askAiPromptTemplate && opts.askAiPromptTemplate.length > 0
    ? opts.askAiPromptTemplate
    : DEFAULT_ASK_AI_PROMPT;

  // Build the sentence string with the focus word wrapped in backticks.
  const s = opts.sentence;
  const sentenceText = s
    ? `${s.before}\`${s.word}\`${s.after}`
    : '';
  const word = s?.word || '';

  // split/join (not replace) so user templates containing literal $1/$&/$'
  // aren't mangled by replacement-pattern interpolation.
  const prompt = template
    .split('{sentence}').join(sentenceText)
    .split('{word}').join(word)
    .split('{language}').join(langName);

  // Provider URL building: prefer a buildUrl() function if exposed; otherwise
  // fall back to provider.urlPrefix + encodeURIComponent.
  let url: string;
  if (typeof provider.buildUrl === 'function') {
    url = provider.buildUrl(prompt, { temporary: opts.askAiChatGptTemporary });
  } else if (typeof provider.urlPrefix === 'string') {
    const base = `${provider.urlPrefix}${encodeURIComponent(prompt)}`;
    if (opts.askAiProvider === 'chatgpt' && opts.askAiChatGptTemporary) {
      try {
        const u = new URL(base);
        u.searchParams.set('temporary-chat', 'true');
        url = u.toString();
      } catch (err) {
        console.warn('[lws] buildAskAiUrl: could not append temporary-chat param', err);
        url = base;
      }
    } else {
      url = base;
    }
  } else {
    url = provider.url || '#';
  }
  return url;
}
