/**
 * YouTube section for the toolbar popup.
 *
 * Loaded dynamically by popup.js when the active tab matches the YouTube
 * SITE_CONFIGS entry (extension/site-configs.js → popupModule). Owns all
 * DOM under the container it's handed; popup.js stays generic so adding
 * Netflix / Viki later is purely additive (new SITE_CONFIGS entry + its
 * own *-popup.js).
 *
 * Contract:
 *   export async function renderSection({ tab, container })
 *     - tab: the chrome.tabs.Tab object for the active tab
 *     - container: a hidden <section> in popup.html; the module owns its
 *       contents and is responsible for `container.hidden = false` when
 *       it has something to show
 */

const OVERRIDE_KEY = 'dualSubsOverrides';

export async function renderSection({ tab, href, container }) {
  // `href` is resolved by popup.js — prefers tab.url, falls back to the
  // content script's window.location.href. Either way it's the page URL.
  const url = href || (tab && tab.url) || '';
  if (!url) return;
  let parsed;
  try { parsed = new URL(url); } catch { return; }
  // Only on watch pages — channel / home / search have no caption tracks.
  if (parsed.pathname !== '/watch') return;
  const videoId = parsed.searchParams.get('v');

  const title = document.createElement('h2');
  title.className = 'yt-section-title';
  title.textContent = 'Subtitles for this video';
  container.appendChild(title);

  const body = document.createElement('div');
  container.appendChild(body);

  const status = document.createElement('p');
  status.className = 'yt-empty';
  status.textContent = 'Asking the page…';
  body.appendChild(status);

  container.hidden = false;

  let info;
  try {
    info = await chrome.tabs.sendMessage(tab.id, { type: 'lws-yt-popup-info' });
  } catch {
    status.textContent = 'Page hasn’t loaded the extension yet. Reload and try again.';
    return;
  }
  if (!info || !Array.isArray(info.tracks)) {
    status.textContent = 'Couldn’t read the caption track list.';
    return;
  }
  if (info.tracks.length === 0) {
    status.textContent = 'This video has no caption tracks.';
    return;
  }
  renderTrackList(body, videoId, info);
}

function renderTrackList(body, videoId, info) {
  body.innerHTML = '';
  const current = info.secondaryLang || 'en';

  const desc = document.createElement('p');
  desc.className = 'yt-hint';
  desc.textContent = 'Korean is always the primary line. Choose the secondary:';
  body.appendChild(desc);

  const list = document.createElement('div');
  list.className = 'yt-track-list';

  // Distinct non-Korean language codes from the tracklist, plus "Off".
  const seenLangs = new Set();
  const choices = [];
  for (const t of info.tracks) {
    const code = (t.languageCode || '').toLowerCase();
    if (!code || code.startsWith('ko')) continue;
    if (seenLangs.has(code)) continue;
    seenLangs.add(code);
    choices.push({ code, label: t.languageName || code, kind: t.kind || '' });
  }
  // If the user's currently-selected secondary isn't in the tracklist,
  // still surface it as an auto-translate option so they can keep their
  // selection without scrolling to "Off".
  if (current !== 'off' && !seenLangs.has(current.toLowerCase())) {
    choices.unshift({ code: current, label: `${current} (auto-translate)`, kind: 'translated' });
  }
  choices.push({ code: 'off', label: 'Off (Korean only)', kind: '' });

  for (const c of choices) {
    const row = document.createElement('label');
    row.className = 'yt-track-row';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'yt-secondary';
    input.value = c.code;
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
  body.appendChild(list);

  const note = document.createElement('p');
  note.className = 'yt-hint';
  note.textContent = 'Saved for this video. Change the default in settings.';
  body.appendChild(note);
}

async function setOverride(videoId, lang) {
  if (!videoId) return;
  const current = await chrome.storage.local.get(OVERRIDE_KEY);
  const map = (current && current[OVERRIDE_KEY]) || {};
  map[videoId] = lang;
  await chrome.storage.local.set({ [OVERRIDE_KEY]: map });
  // The adapter watches chrome.storage.local for this key and
  // re-activates on change — no direct message needed.
}
