const KEYS = {
  KRDICT_KEY: 'krdictApiKey',
  ENABLED: 'enabled',
};
// Per-site disable lives in chrome.storage.local — sync is throttled
// (write-quota, eventual-consistency w/ the cloud) and was dropping
// per-site writes. Local is per-device, which matches the semantics:
// "for this browser, on this site, leave me alone."
const DISABLED_HOSTS_KEY = 'disabledHosts';

const enabledToggle = document.getElementById('enabled-toggle');
const siteRow = document.getElementById('site-row');
const siteToggle = document.getElementById('site-toggle');
const siteHostEl = document.getElementById('site-host');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const openOptionsBtn = document.getElementById('open-options');
const adapterSection = document.getElementById('site-adapter-section');

let currentHost = '';

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

enabledToggle.addEventListener('change', async () => {
  await chrome.storage.sync.set({ [KEYS.ENABLED]: enabledToggle.checked });
  load();
});

function applyToggleFromList(list) {
  const arr = Array.isArray(list) ? list : [];
  siteToggle.checked = !arr.includes(currentHost);
}

async function loadSiteSection() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (err) {
    console.log('[lws] popup loadSiteSection: tabs.query failed', err);
    return;
  }
  if (!tab) {
    console.log('[lws] popup loadSiteSection: no active tab');
    return;
  }
  if (!tab.url) {
    // Requires "activeTab" or matching host_permissions in manifest. If
    // you see this, the per-site toggle won't show up.
    console.log('[lws] popup loadSiteSection: tab.url undefined — missing activeTab permission?');
    return;
  }
  let parsed;
  try { parsed = new URL(tab.url); } catch { return; }
  // Only http(s) — content scripts don't run on chrome://, about:, file:, etc.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    console.log('[lws] popup loadSiteSection: non-http(s) protocol', parsed.protocol);
    return;
  }
  currentHost = parsed.hostname.toLowerCase();
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
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    return;
  }
  if (!tab || !tab.url) return;
  let parsed;
  try { parsed = new URL(tab.url); } catch { return; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
  let findSiteConfig;
  try {
    ({ findSiteConfig } = await import('./site-configs.js'));
  } catch {
    return;
  }
  const cfg = findSiteConfig(parsed.hostname);
  if (!cfg || !cfg.popupModule) return;
  let mod;
  try {
    mod = await import(`./${cfg.popupModule}`);
  } catch {
    return;
  }
  if (!mod || typeof mod.renderSection !== 'function') return;
  try {
    await mod.renderSection({ tab, container: adapterSection });
  } catch (err) {
    console.warn('[learnwithsoju] popupModule failed:', err);
  }
}

openOptionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

load();
loadSiteSection();
loadAdapterSection();
