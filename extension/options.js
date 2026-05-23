const KEYS = {
  KRDICT_KEY: 'krdictApiKey',
  OPENDICT_KEY: 'opendictApiKey',
  DUAL_SUBS_YT: 'dualSubsYouTube',
  SECONDARY_LANG: 'secondaryLang',
  ASK_AI_PROMPT: 'askAiPrompt',
  ASK_AI_PROVIDER: 'askAiProvider',
};

// Default Ask-AI prompt. Kept in sync with the fallback in content.js
// (DEFAULT_ASK_AI_PROMPT) — if you change one, change the other.
const DEFAULT_ASK_AI_PROMPT = `You are a Korean language expert helping a {language} learner. The focus word is \`{word}\` (in backticks). The sentence is "{sentence}".

Reply in {language} using exactly this structure (skip a section if it genuinely doesn't apply, but never add sections, preamble, or closing remarks):

**Focus** — meaning of \`{word}\` *in this sentence* (one sentence). Note the dictionary lemma if the surface form differs.

**Translation** — one natural {language} sentence.

**Breakdown** — markdown table. Columns: Korean | Lemma | POS | Meaning. One row per surface word, left to right.

**Grammar of \`{word}\`** — exhaustive analysis of the focus word only. Cover every grammatical feature: morphological decomposition (stem + each suffix/auxiliary in order), tense/aspect/mood, speech level, attached particles, and every grammar pattern present. For each pattern, use a sub-heading and include:
  - Pattern in code-ticks (e.g. \`-아/어 보다\`) and its literal meaning
  - Nuance / when a native uses it
  - One short example sentence in a different context, with its translation
  - Register or common collocations if notable
Don't skip the "obvious" ones — be thorough. Order patterns from outermost (closest to the stem) to innermost suffix.

No greeting, no "let me know if...", no recap. Be ready for follow-up questions.`;

const krInput = document.getElementById('krdict-key');
const odInput = document.getElementById('opendict-key');
const dualSubsToggle = document.getElementById('dualsubs-toggle');
const secondaryLangSelect = document.getElementById('secondary-lang');
const askAiPromptInput = document.getElementById('ask-ai-prompt');
const askAiProviderSelect = document.getElementById('ask-ai-provider');
const resetAskAiPromptBtn = document.getElementById('reset-ask-ai-prompt');
const askAiPromptStatus = document.getElementById('ask-ai-prompt-status');
const saveBtn = document.getElementById('save-btn');
const testBtn = document.getElementById('test-btn');
const statusEl = document.getElementById('status');
const versionLine = document.getElementById('version-line');

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind || '';
  if (text && kind) {
    setTimeout(() => {
      if (statusEl.textContent === text) {
        statusEl.textContent = '';
        statusEl.className = '';
      }
    }, 4000);
  }
}

function setAskAiPromptStatus(text, kind) {
  if (!askAiPromptStatus) return;
  askAiPromptStatus.textContent = text;
  askAiPromptStatus.className = kind || '';
  if (text && kind) {
    setTimeout(() => {
      if (askAiPromptStatus.textContent === text) {
        askAiPromptStatus.textContent = '';
        askAiPromptStatus.className = '';
      }
    }, 2500);
  }
}

async function populateAiProviderSelect(selectedValue) {
  if (!askAiProviderSelect) return;
  try {
    const mod = await import('./ai-providers.js');
    const providers = mod.AI_PROVIDERS || {};
    const fallback = mod.DEFAULT_ASK_AI_PROVIDER || Object.keys(providers)[0];
    askAiProviderSelect.innerHTML = '';
    for (const [key, def] of Object.entries(providers)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = def.name || key;
      askAiProviderSelect.appendChild(opt);
    }
    askAiProviderSelect.value = providers[selectedValue] ? selectedValue : fallback;
  } catch (err) {
    console.warn('[lws] options: failed to load ai-providers.js', err);
  }
}

async function load() {
  const data = await chrome.storage.sync.get([
    KEYS.KRDICT_KEY,
    KEYS.OPENDICT_KEY,
    KEYS.DUAL_SUBS_YT,
    KEYS.SECONDARY_LANG,
    KEYS.ASK_AI_PROMPT,
    KEYS.ASK_AI_PROVIDER,
  ]);
  krInput.value = data[KEYS.KRDICT_KEY] || '';
  odInput.value = data[KEYS.OPENDICT_KEY] || '';
  if (dualSubsToggle) dualSubsToggle.checked = data[KEYS.DUAL_SUBS_YT] !== false;
  if (secondaryLangSelect) secondaryLangSelect.value = data[KEYS.SECONDARY_LANG] || 'en';
  if (askAiPromptInput) {
    askAiPromptInput.value = typeof data[KEYS.ASK_AI_PROMPT] === 'string' && data[KEYS.ASK_AI_PROMPT]
      ? data[KEYS.ASK_AI_PROMPT]
      : DEFAULT_ASK_AI_PROMPT;
  }
  await populateAiProviderSelect(data[KEYS.ASK_AI_PROVIDER]);
  const v = chrome.runtime.getManifest().version;
  versionLine.textContent = `v${v}`;
}

async function save() {
  const payload = {
    [KEYS.KRDICT_KEY]: krInput.value.trim(),
    [KEYS.OPENDICT_KEY]: odInput.value.trim(),
  };
  await chrome.storage.sync.set(payload);
  setStatus('Saved.', 'ok');
}

async function testKrdict() {
  const key = krInput.value.trim();
  if (!key) {
    setStatus('Enter a KRDict key first.', 'err');
    return;
  }
  setStatus('Testing…');
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
    setStatus(`Network error: ${err.message || err}`, 'err');
  }
}

saveBtn.addEventListener('click', save);
testBtn.addEventListener('click', testKrdict);
if (dualSubsToggle) {
  dualSubsToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ [KEYS.DUAL_SUBS_YT]: dualSubsToggle.checked });
  });
}
if (secondaryLangSelect) {
  secondaryLangSelect.addEventListener('change', () => {
    chrome.storage.sync.set({ [KEYS.SECONDARY_LANG]: secondaryLangSelect.value });
  });
}
if (askAiProviderSelect) {
  askAiProviderSelect.addEventListener('change', () => {
    chrome.storage.sync.set({ [KEYS.ASK_AI_PROVIDER]: askAiProviderSelect.value });
  });
}
if (askAiPromptInput) {
  // Auto-save on blur. Empty value → remove the key so the default
  // re-applies on next read (rather than persisting an empty string
  // that would generate a useless ChatGPT prompt).
  askAiPromptInput.addEventListener('change', async () => {
    const v = askAiPromptInput.value.trim();
    if (!v || v === DEFAULT_ASK_AI_PROMPT) {
      await chrome.storage.sync.remove(KEYS.ASK_AI_PROMPT);
      setAskAiPromptStatus('Reset to default.', 'ok');
    } else {
      await chrome.storage.sync.set({ [KEYS.ASK_AI_PROMPT]: v });
      setAskAiPromptStatus('Saved.', 'ok');
    }
  });
}
if (resetAskAiPromptBtn) {
  resetAskAiPromptBtn.addEventListener('click', async () => {
    if (askAiPromptInput) askAiPromptInput.value = DEFAULT_ASK_AI_PROMPT;
    await chrome.storage.sync.remove(KEYS.ASK_AI_PROMPT);
    setAskAiPromptStatus('Reset to default.', 'ok');
  });
}

const clearCacheBtn = document.getElementById('clear-cache-btn');
const cacheStatus = document.getElementById('cache-status');
if (clearCacheBtn) {
  clearCacheBtn.addEventListener('click', async () => {
    clearCacheBtn.disabled = true;
    cacheStatus.textContent = 'Clearing…';
    cacheStatus.className = '';
    try {
      const res = await chrome.runtime.sendMessage({ type: 'clearCache' });
      if (res && res.ok) {
        cacheStatus.textContent = 'Cache cleared.';
        cacheStatus.className = 'ok';
      } else {
        cacheStatus.textContent = `Error: ${res && res.error || 'unknown'}`;
        cacheStatus.className = 'err';
      }
    } catch (err) {
      cacheStatus.textContent = `Error: ${err.message || err}`;
      cacheStatus.className = 'err';
    } finally {
      clearCacheBtn.disabled = false;
      setTimeout(() => {
        if (cacheStatus.textContent.startsWith('Cache cleared')) {
          cacheStatus.textContent = '';
          cacheStatus.className = '';
        }
      }, 3000);
    }
  });
}

load();

// ---------------------------------------------------------------------
// Word lookup section. The toolbar popup opens this page with
// `#lookup=<encoded word>`; we populate the input + render the word
// into the target div, where content.js's mutation observer wraps it
// as a `.lws-word` span. We then dispatch a click on the span to
// trigger the same dictionary popup that hovering does anywhere else.
//
// content.js is loaded as a regular `<script>` at the bottom of
// options.html; its IIFE-init is async (storage reads + dynamic
// imports), so a wrap may not be available immediately after we
// insert the text. The poll loop below covers that window.
// ---------------------------------------------------------------------

const lookupForm = document.getElementById('lookup-form');
const lookupInputEl = document.getElementById('lookup-input');
const lookupTarget = document.getElementById('lookup-target');
const lookupCard = document.getElementById('lookup-card');

function showLookupForWord(word) {
  if (!lookupTarget || !word) return;
  // Replace prior content. Setting textContent removes any previous
  // wrapped span; content.js's MutationObserver picks up the new text
  // node and re-wraps.
  lookupTarget.textContent = word;
  // Poll for the wrap. content.js may still be initialising on the
  // first call (mecab WASM, dynamic imports, …); each subsequent
  // call lands on a ready observer so the first poll usually hits.
  let attempts = 0;
  const maxAttempts = 60; // ~6 s ceiling
  const tick = () => {
    const span = lookupTarget.querySelector('span.lws-word');
    if (span) {
      try { span.click(); } catch (err) { console.warn('[lws] lookup click failed', err); }
      return;
    }
    if (++attempts < maxAttempts) setTimeout(tick, 100);
    else console.warn('[lws] lookup: span never wrapped; content.js may not be active');
  };
  tick();
}

if (lookupForm && lookupInputEl) {
  lookupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const word = lookupInputEl.value.trim();
    if (!word) return;
    showLookupForWord(word);
  });
}

function readLookupFromHash() {
  // URL hash arrives as `#lookup=가볼게요` (URL-encoded). Strip the
  // leading `#` and parse as URLSearchParams for free decoding.
  const raw = (window.location.hash || '').replace(/^#/, '');
  const params = new URLSearchParams(raw);
  return params.get('lookup');
}

(function applyHashOnLoad() {
  const word = readLookupFromHash();
  if (!word || !lookupInputEl) return;
  lookupInputEl.value = word;
  // Scroll the section into view so the user lands on it, then trigger
  // the lookup. Small delay so content.js has the best chance of
  // having init-ed before we poll for the wrapped span.
  if (lookupCard) lookupCard.scrollIntoView({ behavior: 'auto', block: 'start' });
  setTimeout(() => showLookupForWord(word), 50);
})();

// Stay reactive to hash changes (e.g. user opens the popup again and
// submits a different word into the same already-open options tab).
window.addEventListener('hashchange', () => {
  const word = readLookupFromHash();
  if (!word || !lookupInputEl) return;
  lookupInputEl.value = word;
  showLookupForWord(word);
});
