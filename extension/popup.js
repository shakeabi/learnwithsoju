const KEYS = {
  KRDICT_KEY: 'krdictApiKey',
  ENABLED: 'enabled',
  SECONDARY_LANG: 'secondaryLang',
};
const OVERRIDE_KEY = 'dualSubsOverrides';

const enabledToggle = document.getElementById('enabled-toggle');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const openOptionsBtn = document.getElementById('open-options');
const ytSection = document.getElementById('yt-section');
const ytBody = document.getElementById('yt-section-body');
const ytStatus = document.getElementById('yt-status');

async function load() {
  const data = await chrome.storage.sync.get([KEYS.KRDICT_KEY, KEYS.ENABLED]);
  enabledToggle.checked = data[KEYS.ENABLED] !== false;

  if (!data[KEYS.KRDICT_KEY]) {
    statusDot.className = 'dot warn';
    statusText.textContent = 'API key not set';
  } else if (data[KEYS.ENABLED] === false) {
    statusDot.className = 'dot';
    statusText.textContent = 'Disabled';
  } else {
    statusDot.className = 'dot ok';
    statusText.textContent = 'Active';
  }
}

async function loadYouTubeSection() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    return; // not in a tab context
  }
  if (!tab || !tab.url) return;
  let parsed;
  try { parsed = new URL(tab.url); } catch { return; }
  const isYtWatch = /(?:^|\.)youtube\.com$/.test(parsed.hostname) && parsed.pathname === '/watch';
  if (!isYtWatch) return;

  const videoId = parsed.searchParams.get('v');
  ytSection.hidden = false;
  ytStatus.textContent = 'Asking the page…';

  let info;
  try {
    info = await chrome.tabs.sendMessage(tab.id, { type: 'lws-yt-popup-info' });
  } catch (err) {
    ytStatus.textContent = 'Page hasn’t loaded the extension yet. Reload and try again.';
    return;
  }
  if (!info || !Array.isArray(info.tracks)) {
    ytStatus.textContent = 'Couldn’t read the caption track list.';
    return;
  }
  if (info.tracks.length === 0) {
    ytStatus.textContent = 'This video has no caption tracks.';
    return;
  }
  renderTrackList(tab.id, videoId, info);
}

function renderTrackList(tabId, videoId, info) {
  ytBody.innerHTML = '';
  const current = info.secondaryLang || 'en';

  const desc = document.createElement('p');
  desc.className = 'yt-hint';
  desc.textContent = `Korean is always the primary line. Choose the secondary:`;
  ytBody.appendChild(desc);

  const list = document.createElement('div');
  list.className = 'yt-track-list';

  // Build the choices: every distinct language code from the tracklist
  // EXCEPT Korean (since Korean is always primary), plus an "Off" option
  // for users who want Korean-only.
  const seenLangs = new Set();
  const choices = [];
  for (const t of info.tracks) {
    const code = (t.languageCode || '').toLowerCase();
    if (!code || code.startsWith('ko')) continue; // skip — KO is primary
    if (seenLangs.has(code)) continue;
    seenLangs.add(code);
    choices.push({
      code,
      label: t.languageName || code,
      kind: t.kind || '',
    });
  }
  // If the user's currently-selected secondary isn't in the tracklist
  // (e.g. they picked Spanish but the video only has en/ja/id), still
  // show it as an option (auto-translate fallback will be used).
  if (current !== 'off' && !seenLangs.has(current.toLowerCase())) {
    choices.unshift({
      code: current,
      label: `${current} (auto-translate)`,
      kind: 'translated',
    });
  }
  choices.push({ code: 'off', label: 'Off (Korean only)', kind: '' });

  for (const c of choices) {
    const id = `yt-track-${c.code}`;
    const row = document.createElement('label');
    row.className = 'yt-track-row';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'yt-secondary';
    input.value = c.code;
    input.id = id;
    if (c.code === current) input.checked = true;
    input.addEventListener('change', () => {
      if (input.checked) setOverride(videoId, c.code);
    });
    row.appendChild(input);
    const text = document.createElement('span');
    text.className = 'yt-track-label';
    text.textContent = c.label;
    if (c.kind === 'asr') {
      const tag = document.createElement('em');
      tag.className = 'yt-track-tag';
      tag.textContent = 'auto-generated';
      text.appendChild(tag);
    } else if (c.kind === 'translated') {
      const tag = document.createElement('em');
      tag.className = 'yt-track-tag';
      tag.textContent = 'auto-translated';
      text.appendChild(tag);
    }
    row.appendChild(text);
    list.appendChild(row);
  }
  ytBody.appendChild(list);

  const note = document.createElement('p');
  note.className = 'yt-hint';
  note.textContent = 'Saved for this video. Change the default in settings.';
  ytBody.appendChild(note);
}

async function setOverride(videoId, lang) {
  if (!videoId) return;
  const current = await chrome.storage.local.get(OVERRIDE_KEY);
  const map = (current && current[OVERRIDE_KEY]) || {};
  map[videoId] = lang;
  await chrome.storage.local.set({ [OVERRIDE_KEY]: map });
  // No need to message the content script — the adapter watches
  // chrome.storage.local for this key and re-activates on change.
}

enabledToggle.addEventListener('change', async () => {
  await chrome.storage.sync.set({ [KEYS.ENABLED]: enabledToggle.checked });
  load();
});

openOptionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

load();
loadYouTubeSection();
