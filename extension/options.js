const KEYS = {
  KRDICT_KEY: 'krdictApiKey',
  OPENDICT_KEY: 'opendictApiKey',
  ENABLED: 'enabled',
  DUAL_SUBS_YT: 'dualSubsYouTube',
  SECONDARY_LANG: 'secondaryLang',
};

const krInput = document.getElementById('krdict-key');
const odInput = document.getElementById('opendict-key');
const enabledToggle = document.getElementById('enabled-toggle');
const dualSubsToggle = document.getElementById('dualsubs-toggle');
const secondaryLangSelect = document.getElementById('secondary-lang');
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

async function load() {
  const data = await chrome.storage.sync.get([
    KEYS.KRDICT_KEY,
    KEYS.OPENDICT_KEY,
    KEYS.ENABLED,
    KEYS.DUAL_SUBS_YT,
    KEYS.SECONDARY_LANG,
  ]);
  krInput.value = data[KEYS.KRDICT_KEY] || '';
  odInput.value = data[KEYS.OPENDICT_KEY] || '';
  enabledToggle.checked = data[KEYS.ENABLED] !== false;
  if (dualSubsToggle) dualSubsToggle.checked = data[KEYS.DUAL_SUBS_YT] !== false;
  if (secondaryLangSelect) secondaryLangSelect.value = data[KEYS.SECONDARY_LANG] || 'en';
  const v = chrome.runtime.getManifest().version;
  versionLine.textContent = `v${v}`;
}

async function save() {
  const payload = {
    [KEYS.KRDICT_KEY]: krInput.value.trim(),
    [KEYS.OPENDICT_KEY]: odInput.value.trim(),
    [KEYS.ENABLED]: enabledToggle.checked,
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
    url.searchParams.set('num', '1');
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
enabledToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ [KEYS.ENABLED]: enabledToggle.checked });
});
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
