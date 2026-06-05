const KEYS = {
  KRDICT_KEY: 'krdictApiKey',
  OPENDICT_KEY: 'opendictApiKey',
  DUAL_SUBS_YT: 'dualSubsYouTube',
  DUAL_SUBS_NX: 'dualSubsNetflix',
  SECONDARY_LANG: 'secondaryLang',
  ASK_AI_PROMPT: 'askAiPrompt',
  ASK_AI_PROVIDER: 'askAiProvider',
  ASK_AI_CHATGPT_TEMPORARY: 'askAiChatGptTemporary',
  SHOW_HANJA_PILL: 'showHanjaPill',
};

// Default Ask-AI prompt. Kept in sync with the fallback in content.js
// (DEFAULT_ASK_AI_PROMPT) — if you change one, change the other.
const DEFAULT_ASK_AI_PROMPT = `You are a Korean language expert helping a {language} learner. The focus word is \`{word}\` (in backticks). The sentence is "{sentence}".

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

const krInput = document.getElementById('krdict-key');
const odInput = document.getElementById('opendict-key');
const dualSubsToggle = document.getElementById('dualsubs-toggle');
const dualSubsNxToggle = document.getElementById('dualsubs-toggle-netflix');
const showHanjaPillToggle = document.getElementById('show-hanja-pill-toggle');
const secondaryLangSelect = document.getElementById('secondary-lang');
const askAiPromptInput = document.getElementById('ask-ai-prompt');
const askAiProviderSelect = document.getElementById('ask-ai-provider');
const askAiChatGptTemporaryCheckbox = document.getElementById('askai-chatgpt-temporary');
const chatGptTemporaryRow = document.getElementById('chatgpt-temporary-row');
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

function syncChatGptTemporaryRowVisibility() {
  if (!chatGptTemporaryRow) return;
  const isChatGpt = askAiProviderSelect && askAiProviderSelect.value === 'chatgpt';
  chatGptTemporaryRow.hidden = !isChatGpt;
}

async function populateAiProviderSelect(selectedValue) {
  if (!askAiProviderSelect) return;
  try {
    const mod = await import('../../core/ai-providers.js');
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
    syncChatGptTemporaryRowVisibility();
  } catch (err) {
    console.warn('[lws] options: failed to load ai-providers.js', err);
  }
}

async function load() {
  const data = await chrome.storage.sync.get([
    KEYS.KRDICT_KEY,
    KEYS.OPENDICT_KEY,
    KEYS.DUAL_SUBS_YT,
    KEYS.DUAL_SUBS_NX,
    KEYS.SECONDARY_LANG,
    KEYS.ASK_AI_PROMPT,
    KEYS.ASK_AI_PROVIDER,
    KEYS.ASK_AI_CHATGPT_TEMPORARY,
    KEYS.SHOW_HANJA_PILL,
  ]);
  krInput.value = data[KEYS.KRDICT_KEY] || '';
  odInput.value = data[KEYS.OPENDICT_KEY] || '';
  if (dualSubsToggle) dualSubsToggle.checked = data[KEYS.DUAL_SUBS_YT] !== false;
  if (dualSubsNxToggle) dualSubsNxToggle.checked = data[KEYS.DUAL_SUBS_NX] !== false;
  if (showHanjaPillToggle) showHanjaPillToggle.checked = data[KEYS.SHOW_HANJA_PILL] === true;
  if (secondaryLangSelect) secondaryLangSelect.value = data[KEYS.SECONDARY_LANG] || 'en';
  if (askAiPromptInput) {
    askAiPromptInput.value = typeof data[KEYS.ASK_AI_PROMPT] === 'string' && data[KEYS.ASK_AI_PROMPT]
      ? data[KEYS.ASK_AI_PROMPT]
      : DEFAULT_ASK_AI_PROMPT;
  }
  if (askAiChatGptTemporaryCheckbox) {
    askAiChatGptTemporaryCheckbox.checked = data[KEYS.ASK_AI_CHATGPT_TEMPORARY] === true;
  }
  await populateAiProviderSelect(data[KEYS.ASK_AI_PROVIDER]);
  const v = chrome.runtime.getManifest().version;
  versionLine.textContent = `v${v}`;
  await refreshCacheCounts();
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
if (dualSubsNxToggle) {
  dualSubsNxToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ [KEYS.DUAL_SUBS_NX]: dualSubsNxToggle.checked });
  });
}
if (showHanjaPillToggle) {
  showHanjaPillToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ [KEYS.SHOW_HANJA_PILL]: showHanjaPillToggle.checked });
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
    syncChatGptTemporaryRowVisibility();
  });
}
if (askAiChatGptTemporaryCheckbox) {
  askAiChatGptTemporaryCheckbox.addEventListener('change', () => {
    chrome.storage.sync.set({ [KEYS.ASK_AI_CHATGPT_TEMPORARY]: askAiChatGptTemporaryCheckbox.checked });
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

const cacheStatus = document.getElementById('cache-status');
const clearLookupBtn = document.getElementById('clear-lookup-btn');
const clearHanjaBtn = document.getElementById('clear-hanja-btn');
const clearAllBtn = document.getElementById('clear-all-btn');

const CACHE_BTN_LABELS = {
  lookup: 'Clear lookup results',
  hanja: 'Clear Hanja meanings',
  all: 'Clear everything incl. dict',
};

const CACHE_BTN_SUCCESS = {
  lookup: 'Lookup cache cleared.',
  hanja: 'Hanja cache cleared.',
  all: 'All caches cleared.',
};

function setCacheStatus(text, kind) {
  if (!cacheStatus) return;
  cacheStatus.textContent = text;
  cacheStatus.className = kind || '';
  if (text && kind === 'ok') {
    setTimeout(() => {
      if (cacheStatus.textContent === text) {
        cacheStatus.textContent = '';
        cacheStatus.className = '';
      }
    }, 3000);
  }
}

function applyCountsToButtons(counts) {
  if (!counts) return;
  const lookupN = counts.lookup;
  const hanjaN = counts.hanja;
  const allN = (counts.lookup ?? 0) + (counts.hanja ?? 0) + (counts.krdict ?? 0) + (counts.opendict ?? 0);

  if (clearLookupBtn) {
    clearLookupBtn.textContent = lookupN != null
      ? `${CACHE_BTN_LABELS.lookup} (~${lookupN})`
      : CACHE_BTN_LABELS.lookup;
  }
  if (clearHanjaBtn) {
    clearHanjaBtn.textContent = hanjaN != null
      ? `${CACHE_BTN_LABELS.hanja} (~${hanjaN})`
      : CACHE_BTN_LABELS.hanja;
  }
  if (clearAllBtn) {
    clearAllBtn.textContent = allN != null
      ? `${CACHE_BTN_LABELS.all} (~${allN})`
      : CACHE_BTN_LABELS.all;
  }
}

async function refreshCacheCounts() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'cacheCounts' });
    if (res && res.ok && res.counts) {
      applyCountsToButtons(res.counts);
    }
  } catch (err) {
    console.warn('[lws] options: cacheCounts failed:', err);
  }
}

function makeCacheClearHandler(btn, target) {
  return async () => {
    if (!btn) return;
    btn.disabled = true;
    if (clearLookupBtn) clearLookupBtn.disabled = true;
    if (clearHanjaBtn) clearHanjaBtn.disabled = true;
    if (clearAllBtn) clearAllBtn.disabled = true;
    setCacheStatus('Clearing…', '');
    try {
      const res = await chrome.runtime.sendMessage({ type: 'clearCache', target });
      if (res && res.ok) {
        setCacheStatus(CACHE_BTN_SUCCESS[target], 'ok');
      } else {
        setCacheStatus(`Error: ${res && res.error || 'unknown'}`, 'err');
      }
    } catch (err) {
      console.warn('[lws] options: clearCache failed:', err);
      setCacheStatus(`Error: ${err.message || err}`, 'err');
    } finally {
      if (clearLookupBtn) clearLookupBtn.disabled = false;
      if (clearHanjaBtn) clearHanjaBtn.disabled = false;
      if (clearAllBtn) clearAllBtn.disabled = false;
      await refreshCacheCounts();
    }
  };
}

if (clearLookupBtn) clearLookupBtn.addEventListener('click', makeCacheClearHandler(clearLookupBtn, 'lookup'));
if (clearHanjaBtn) clearHanjaBtn.addEventListener('click', makeCacheClearHandler(clearHanjaBtn, 'hanja'));
if (clearAllBtn) clearAllBtn.addEventListener('click', makeCacheClearHandler(clearAllBtn, 'all'));

const inspectorLink = document.getElementById('morpheme-inspector-link');
if (inspectorLink) {
  inspectorLink.href = chrome.runtime.getURL('pages/morpheme-inspector/morpheme-inspector.html');
  inspectorLink.rel = 'noopener noreferrer';
}

load();
