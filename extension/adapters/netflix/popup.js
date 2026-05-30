/**
 * Netflix section for the toolbar popup.
 *
 * Mirrors `adapters/youtube/popup.js` — loaded dynamically by `popup.js`
 * when the active tab matches the Netflix SITE_CONFIGS entry (see
 * extension/core/site-configs.js → `popupModule`). Owns all DOM under the
 * container it's handed; the popup shell stays generic.
 *
 * Difference vs YouTube: Netflix only fetches the user's currently-
 * selected subtitle track, so the dropdown lists only what the user
 * has already toggled through in Netflix's CC menu this session. The
 * adapter accumulates captures in its `tracksByLang` Map and exposes
 * the snapshot via the `lws-nx-popup-info` message.
 *
 * Contract:
 *   export async function renderSection({ tab, href, container })
 *     - tab: the chrome.tabs.Tab object for the active tab
 *     - href: page URL (popup.js prefers tab.url, falls back to
 *             content-script's window.location.href)
 *     - container: a hidden <section> in popup.html; the module owns its
 *       contents and is responsible for `container.hidden = false` when
 *       it has something to show
 */

// Separate key from YouTube's so a Netflix titleId can never collide
// with a YouTube videoId in the same storage map (different ID spaces,
// but same chrome.storage.local namespace).
const OVERRIDE_KEY = 'dualSubsOverridesNetflix';

export async function renderSection({ tab, href, container }) {
  const url = href || (tab && tab.url) || '';
  if (!url) return;
  let parsed;
  try { parsed = new URL(url); } catch { return; }
  // Netflix's watch route is `/watch/<numeric titleId>`, sometimes
  // prefixed with a country segment (e.g. `/us-en/watch/123…`). Match
  // either; bail on non-watch routes (browse / search / home have no
  // subtitle tracks to pick from).
  const m = /(^|\/)watch\/(\d+)/.exec(parsed.pathname);
  if (!m) return;
  const titleId = m[2];

  const status = document.createElement('p');
  status.className = 'yt-empty';
  status.textContent = 'Asking the page…';
  container.appendChild(status);

  container.hidden = false;

  let info;
  try {
    info = await chrome.tabs.sendMessage(tab.id, { type: 'lws-nx-popup-info' });
  } catch {
    status.textContent = 'Page hasn’t loaded the extension yet. Reload and try again.';
    return;
  }
  if (!info || !Array.isArray(info.tracks)) {
    status.textContent = 'Couldn’t read the caption track list.';
    return;
  }
  // Drop Korean from the count — it's the primary track, never a
  // secondary candidate. If there's nothing else captured yet, prompt
  // the user to prime more languages via Netflix's CC menu.
  const nonKo = info.tracks.filter((t) => {
    const code = String(t.languageCode || '').toLowerCase();
    return code && !code.startsWith('ko');
  });
  if (nonKo.length === 0) {
    status.textContent = 'Switch CC to another language in Netflix’s CC menu to add it here.';
    return;
  }
  container.removeChild(status);
  renderTrackSelect(container, titleId, info);
}

function renderTrackSelect(container, titleId, info) {
  const current = info.secondaryLang || 'en';

  // Distinct non-Korean language codes from what the adapter has
  // captured. CC variants (closed captions, with annotations like
  // [음악]) get a "(CC)" suffix so the learner can tell them apart
  // from the plain track when both are present.
  const seenLangs = new Set();
  const choices = [];
  for (const t of info.tracks) {
    const code = String(t.languageCode || '').toLowerCase();
    if (!code || code.startsWith('ko')) continue;
    if (seenLangs.has(code)) continue;
    seenLangs.add(code);
    const base = t.languageName || code;
    choices.push({ code, label: t.captionedness === 'cc' ? `${base} (CC)` : base });
  }
  // Same translated-fallback shape YouTube uses: surface the user's
  // current selection in the dropdown even if it isn't in the
  // captured list yet (so they don't see their pref silently absent).
  if (current !== 'off' && !seenLangs.has(current.toLowerCase())) {
    choices.unshift({ code: current, label: `${current} (translated)` });
  }
  choices.push({ code: 'off', label: 'Off' });

  const field = document.createElement('div');
  field.className = 'field-stacked';

  const label = document.createElement('label');
  label.className = 'section-label';
  label.textContent = 'Secondary Subs';
  label.htmlFor = 'nx-secondary-select';
  field.appendChild(label);

  // Reuse YouTube's dropdown class so the visual treatment matches —
  // there's no Netflix-specific styling needed, and no point
  // duplicating the rules under a parallel class.
  const select = document.createElement('select');
  select.id = 'nx-secondary-select';
  select.className = 'yt-sub-select';
  for (const c of choices) {
    const opt = document.createElement('option');
    opt.value = c.code;
    opt.textContent = c.label;
    if (c.code === current) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => setOverride(titleId, select.value));
  field.appendChild(select);

  container.appendChild(field);
}

async function setOverride(titleId, lang) {
  if (!titleId) return;
  const current = await chrome.storage.local.get(OVERRIDE_KEY);
  const map = (current && current[OVERRIDE_KEY]) || {};
  map[titleId] = lang;
  await chrome.storage.local.set({ [OVERRIDE_KEY]: map });
  // The adapter watches chrome.storage.local for this key and
  // re-renders the overlay on change — no direct message needed.
}
