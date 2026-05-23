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

  const status = document.createElement('p');
  status.className = 'yt-empty';
  status.textContent = 'Asking the page…';
  container.appendChild(status);

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
  container.removeChild(status);
  renderTrackSelect(container, videoId, info);
}

function renderTrackSelect(container, videoId, info) {
  const current = info.secondaryLang || 'en';

  // Distinct non-Korean language codes from the tracklist; ASR tracks
  // get an (auto) suffix so the user knows what they're picking. The
  // user's currently-selected secondary is surfaced as (translated) if
  // the tracklist doesn't carry it natively.
  const seenLangs = new Set();
  const choices = [];
  for (const t of info.tracks) {
    const code = (t.languageCode || '').toLowerCase();
    if (!code || code.startsWith('ko')) continue;
    if (seenLangs.has(code)) continue;
    seenLangs.add(code);
    const base = t.languageName || code;
    choices.push({ code, label: t.kind === 'asr' ? `${base} (auto)` : base });
  }
  if (current !== 'off' && !seenLangs.has(current.toLowerCase())) {
    choices.unshift({ code: current, label: `${current} (translated)` });
  }
  choices.push({ code: 'off', label: 'Off' });

  // Stacked layout: small uppercase label above a full-width dropdown.
  // Reads cleaner than the prior inline label/select row when the
  // language name in the option (e.g. "Chinese (Simplified) (auto)")
  // is long enough to push the dropdown into a cramped column.
  const field = document.createElement('div');
  field.className = 'field-stacked';

  const label = document.createElement('label');
  label.className = 'section-label';
  label.textContent = 'Secondary Subs';
  label.htmlFor = 'yt-secondary-select';
  field.appendChild(label);

  const select = document.createElement('select');
  select.id = 'yt-secondary-select';
  select.className = 'yt-sub-select';
  for (const c of choices) {
    const opt = document.createElement('option');
    opt.value = c.code;
    opt.textContent = c.label;
    if (c.code === current) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => setOverride(videoId, select.value));
  field.appendChild(select);

  container.appendChild(field);
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
