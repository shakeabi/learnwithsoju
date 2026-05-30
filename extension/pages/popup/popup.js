// When publishing or you have invites ready, fill these in and the
// corresponding icons appear in the popup. Leave empty to hide.
const LINKS = {
  github: '', // e.g. 'https://github.com/abishake/learnwithsoju'
  discord: '', // e.g. 'https://discord.gg/xxxxxxx'
  kofi: '', // e.g. 'https://ko-fi.com/learnwithsoju'
};

const LINK_META = {
  github: {
    title: 'GitHub repository',
    placeholderTitle: 'GitHub — coming soon',
    svg: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>',
  },
  discord: {
    title: 'Discord',
    placeholderTitle: 'Discord — coming soon',
    svg: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.245.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>',
  },
};

// Per-site disable lives in chrome.storage.local — sync is throttled
// (write-quota, eventual-consistency w/ the cloud) and was dropping
// per-site writes. Local is per-device, which matches the semantics:
// "for this browser, on this site, leave me alone."
const DISABLED_HOSTS_KEY = 'disabledHosts';

const siteRow = document.getElementById('site-row');
const siteToggle = document.getElementById('site-toggle');
const siteHostEl = document.getElementById('site-host');
const openOptionsBtn = document.getElementById('open-options-icon');
const adapterSection = document.getElementById('site-adapter-section');

let currentHost = '';

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
    ({ findSiteConfig } = await import('../../core/site-configs.js'));
  } catch {
    return;
  }
  const cfg = findSiteConfig(site.host);
  if (!cfg || !cfg.popupModule) return;
  let mod;
  try {
    mod = await import(`../../${cfg.popupModule}`);
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

loadSiteSection();
loadAdapterSection();

// The notepad link can't bake the extension ID into HTML, so resolve
// at popup-open time. External links (GitHub, Discord) live in the
// LINKS dict at the top of this file — empty string renders a greyed
// placeholder, a real URL renders an active link.
const notepadLink = document.getElementById('notepad-link');
if (notepadLink) {
  notepadLink.href = chrome.runtime.getURL('pages/notepad/notepad.html');
  notepadLink.target = '_blank';
  notepadLink.rel = 'noopener noreferrer';
}

const linksRow = document.querySelector('.links-row');
if (linksRow) {
  for (const [key, url] of Object.entries(LINKS)) {
    try {
      const meta = LINK_META[key];
      if (!meta) continue;
      const a = document.createElement('a');
      a.className = 'link-icon';
      if (url) {
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.title = meta.title;
      } else {
        a.classList.add('link-icon--disabled');
        a.setAttribute('aria-disabled', 'true');
        a.title = meta.placeholderTitle;
      }
      a.innerHTML = meta.svg;
      linksRow.appendChild(a);
    } catch (err) {
      console.warn('[lws] popup LINKS render skipped', key, ':', err);
    }
  }
}

const kofiBanner = document.getElementById('kofi-banner');
if (kofiBanner) {
  try {
    const kofiUrl = LINKS.kofi;
    if (kofiUrl) {
      kofiBanner.href = kofiUrl;
      kofiBanner.target = '_blank';
      kofiBanner.rel = 'noopener noreferrer';
      kofiBanner.classList.remove('kofi-banner--disabled');
      kofiBanner.removeAttribute('aria-disabled');
      kofiBanner.title = 'Support on Ko-fi';
    }
    // Empty URL: leave default disabled state from HTML
  } catch (err) {
    console.warn('[lws] popup kofi banner render skipped:', err);
  }
}
