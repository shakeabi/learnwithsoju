const KRDICT_KEY = 'krdictApiKey';
// Per-site disable lives in chrome.storage.local — sync is throttled
// (write-quota, eventual-consistency w/ the cloud) and was dropping
// per-site writes. Local is per-device, which matches the semantics:
// "for this browser, on this site, leave me alone."
const DISABLED_HOSTS_KEY = 'disabledHosts';

const siteRow = document.getElementById('site-row');
const siteToggle = document.getElementById('site-toggle');
const siteHostEl = document.getElementById('site-host');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const openOptionsBtn = document.getElementById('open-options');
const adapterSection = document.getElementById('site-adapter-section');

let currentHost = '';

async function load() {
  const data = await chrome.storage.sync.get(KRDICT_KEY);
  if (!data[KRDICT_KEY]) {
    statusDot.className = 'dot warn';
    statusText.textContent = 'API key not set';
  } else {
    statusDot.className = 'dot ok';
    statusText.textContent = 'Active';
  }
}

function applyToggleFromList(list) {
  const arr = Array.isArray(list) ? list : [];
  siteToggle.checked = !arr.includes(currentHost);
}

// Resolve the active tab's hostname. Tries tab.url first (works when
// activeTab grant is in effect); falls back to messaging the content
// script (which always knows its own location.hostname). Returns
// { host, protocol } or null if both sources fail (e.g. chrome:// page
// with no content script).
async function resolveActiveSite() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (err) {
    console.log('[lws] popup resolveActiveSite: tabs.query failed', err);
    return null;
  }
  if (!tab) {
    console.log('[lws] popup resolveActiveSite: no active tab');
    return null;
  }
  if (tab.url) {
    try {
      const u = new URL(tab.url);
      return { tab, host: u.hostname.toLowerCase(), protocol: u.protocol, href: tab.url };
    } catch { /* fall through */ }
  }
  // Fallback: ask the content script directly.
  try {
    const reply = await chrome.tabs.sendMessage(tab.id, { type: 'lws-site-info' });
    if (reply && reply.host) {
      return {
        tab,
        host: String(reply.host).toLowerCase(),
        protocol: reply.protocol || 'https:',
        href: reply.href || '',
      };
    }
  } catch (err) {
    console.log('[lws] popup resolveActiveSite: content-script fallback failed', err);
  }
  return null;
}

async function loadSiteSection() {
  const site = await resolveActiveSite();
  if (!site) return;
  if (site.protocol !== 'http:' && site.protocol !== 'https:') {
    console.log('[lws] popup loadSiteSection: non-http(s) protocol', site.protocol);
    return;
  }
  currentHost = site.host;
  if (!currentHost) return;
  siteHostEl.textContent = currentHost;
  const data = await chrome.storage.local.get(DISABLED_HOSTS_KEY);
  applyToggleFromList(data[DISABLED_HOSTS_KEY]);
  siteRow.hidden = false;
  console.log('[lws] popup loadSiteSection', { host: currentHost, list: data[DISABLED_HOSTS_KEY], checked: siteToggle.checked });
}

siteToggle.addEventListener('change', async () => {
  if (!currentHost) return;
  const wantsEnabled = siteToggle.checked;
  const data = await chrome.storage.local.get(DISABLED_HOSTS_KEY);
  const list = Array.isArray(data[DISABLED_HOSTS_KEY]) ? data[DISABLED_HOSTS_KEY] : [];
  const set = new Set(list);
  if (wantsEnabled) set.delete(currentHost);
  else set.add(currentHost);
  const next = Array.from(set).sort();
  await chrome.storage.local.set({ [DISABLED_HOSTS_KEY]: next });
  console.log('[lws] popup wrote disabledHosts', { host: currentHost, wantsEnabled, next });
});

// Keep the toggle in sync if anything else changes disabledHosts while
// the popup is open (rare, but defensive).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!(DISABLED_HOSTS_KEY in changes)) return;
  if (!currentHost) return;
  applyToggleFromList(changes[DISABLED_HOSTS_KEY].newValue);
});

// Generic per-site popup section. Looks up the SITE_CONFIGS entry for the
// active tab's hostname; if it declares a `popupModule`, dynamic-imports
// that module and hands it the section container. The module owns all DOM
// inside the container and toggles its visibility. Adding Netflix / Viki
// is a new SITE_CONFIGS entry + its own *-popup.js — no edits here.
async function loadAdapterSection() {
  const site = await resolveActiveSite();
  if (!site) return;
  if (site.protocol !== 'http:' && site.protocol !== 'https:') return;
  let findSiteConfig;
  try {
    ({ findSiteConfig } = await import('./site-configs.js'));
  } catch {
    return;
  }
  const cfg = findSiteConfig(site.host);
  if (!cfg || !cfg.popupModule) return;
  let mod;
  try {
    mod = await import(`./${cfg.popupModule}`);
  } catch {
    return;
  }
  if (!mod || typeof mod.renderSection !== 'function') return;
  try {
    await mod.renderSection({ tab: site.tab, href: site.href, container: adapterSection });
  } catch (err) {
    console.warn('[learnwithsoju] popupModule failed:', err);
  }
}

openOptionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

// Lookup box. The popup is too small to render the full dictionary
// popup (and re-implementing that renderer here would duplicate
// content.js's whole pipeline), so when the user submits a word we
// open the settings page with `#lookup=<word>` and let the in-page
// hover machinery run there. The settings page hosts a tiny div that
// content.js wraps as a `.lws-word`; clicking the word triggers the
// same dictionary popup the user sees on any webpage.
const lookupForm = document.getElementById('lookup-form');
const lookupInput = document.getElementById('lookup-input');

if (lookupForm) {
  lookupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const word = lookupInput.value.trim();
    if (!word) return;
    const url = chrome.runtime.getURL('options.html') + '#lookup=' + encodeURIComponent(word);
    try {
      await chrome.tabs.create({ url });
    } catch (err) {
      console.warn('[lws] popup: failed to open settings tab for lookup', err);
      return;
    }
    window.close();
  });
}

load();
loadSiteSection();
loadAdapterSection();
