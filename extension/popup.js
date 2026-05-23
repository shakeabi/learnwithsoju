const KEYS = {
  KRDICT_KEY: 'krdictApiKey',
  ENABLED: 'enabled',
  DISABLED_HOSTS: 'disabledHosts',
};

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

async function loadSiteSection() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    return;
  }
  if (!tab || !tab.url) return;
  let parsed;
  try { parsed = new URL(tab.url); } catch { return; }
  // Only http(s) — content scripts don't run on chrome://, about:, file:, etc.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
  currentHost = parsed.hostname.toLowerCase();
  if (!currentHost) return;
  siteHostEl.textContent = currentHost;
  const data = await chrome.storage.sync.get(KEYS.DISABLED_HOSTS);
  const list = Array.isArray(data[KEYS.DISABLED_HOSTS]) ? data[KEYS.DISABLED_HOSTS] : [];
  siteToggle.checked = !list.includes(currentHost);
  siteRow.hidden = false;
}

siteToggle.addEventListener('change', async () => {
  if (!currentHost) return;
  const data = await chrome.storage.sync.get(KEYS.DISABLED_HOSTS);
  const list = Array.isArray(data[KEYS.DISABLED_HOSTS]) ? data[KEYS.DISABLED_HOSTS] : [];
  const set = new Set(list);
  if (siteToggle.checked) set.delete(currentHost);
  else set.add(currentHost);
  await chrome.storage.sync.set({ [KEYS.DISABLED_HOSTS]: Array.from(set).sort() });
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
