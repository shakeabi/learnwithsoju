const KEYS = {
  KRDICT_KEY: 'krdictApiKey',
  OPENDICT_KEY: 'opendictApiKey',
  DUAL_SUBS_YT: 'dualSubsYouTube',
  SECONDARY_LANG: 'secondaryLang',
  ASK_AI_PROMPT: 'askAiPrompt',
};

// Default Ask-AI prompt. Kept in sync with the fallback in content.js
// (DEFAULT_ASK_AI_PROMPT) — if you change one, change the other.
const DEFAULT_ASK_AI_PROMPT = `You're a Korean language expert and i'm a {language} student learning korean. I want you to help me analyse the following sentence and help me with followup queries if any. As part of the analysis, there's a focus on a particular word marked with backticks, I want you to explain the word, explain the sentence and explain individual word break down in the sentence, all grammar and grammar patterns involved etc., Here's the sentence "{sentence}"`;

const krInput = document.getElementById('krdict-key');
const odInput = document.getElementById('opendict-key');
const dualSubsToggle = document.getElementById('dualsubs-toggle');
const secondaryLangSelect = document.getElementById('secondary-lang');
const askAiPromptInput = document.getElementById('ask-ai-prompt');
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

async function load() {
  const data = await chrome.storage.sync.get([
    KEYS.KRDICT_KEY,
    KEYS.OPENDICT_KEY,
    KEYS.DUAL_SUBS_YT,
    KEYS.SECONDARY_LANG,
    KEYS.ASK_AI_PROMPT,
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
