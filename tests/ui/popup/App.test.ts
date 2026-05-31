import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';

// Persistent chrome stub: the popup's $effects install storage.onChanged
// listeners + dynamic-import core/site-configs.js, all of which capture this
// stub by reference. A single shared stub + a reset() helper between tests
// keeps every component talking to the same registry.
const localStore = new Map<string, unknown>();
const localListeners: Array<(changes: any, area: string) => void> = [];
const chromeStub = {
  tabs: {
    query: vi.fn(async (_q: any) => [
      { id: 1, url: 'https://example.com/page', active: true },
    ]),
    sendMessage: vi.fn(async () => ({ host: 'example.com', protocol: 'https:', href: 'https://example.com/page' })),
  },
  storage: {
    local: {
      async get(key: any) {
        if (key === null || key === undefined) return Object.fromEntries(localStore);
        const arr = Array.isArray(key) ? key : [key];
        const out: Record<string, unknown> = {};
        for (const k of arr) if (localStore.has(k)) out[k] = localStore.get(k);
        return out;
      },
      async set(obj: Record<string, unknown>) {
        const changes: Record<string, any> = {};
        for (const [k, v] of Object.entries(obj)) {
          changes[k] = { newValue: v, oldValue: localStore.get(k) };
          localStore.set(k, v);
        }
        for (const l of localListeners) l(changes, 'local');
      },
    },
    onChanged: {
      addListener(fn: any) { localListeners.push(fn); },
      removeListener(fn: any) {
        const i = localListeners.indexOf(fn);
        if (i >= 0) localListeners.splice(i, 1);
      },
    },
  },
  runtime: {
    sendMessage: vi.fn(),
    getManifest: () => ({ version: '0.1.0' }),
    getURL: (p: string) => `chrome-extension://test/${p}`,
    openOptionsPage: vi.fn(),
  },
};
vi.stubGlobal('chrome', chromeStub);

// LinksRow.svelte calls window.close() after openOptions. jsdom's default
// window.close() detaches the document, breaking subsequent tests; stub it
// to a no-op so the gear-button test can run without poisoning the suite.
vi.spyOn(window, 'close').mockImplementation(() => {});

describe('popup App.svelte', () => {
  beforeEach(() => {
    localStore.clear();
    chromeStub.runtime.openOptionsPage.mockClear();
    chromeStub.tabs.query.mockClear();
    chromeStub.tabs.query.mockImplementation(async () => [
      { id: 1, url: 'https://example.com/page', active: true },
    ]);
  });
  // Svelte testing-library auto-cleanup is opt-in. Without it, the previous
  // test's mount stays attached so id queries pick up stale nodes.
  afterEach(() => cleanup());

  it('renders the brand header', async () => {
    const { default: App } = await import('../../../src/pages/popup/App.svelte');
    render(App);
    await new Promise((r) => setTimeout(r, 20));
    const brand = document.querySelector('.brand');
    expect(brand?.textContent).toBe('learnwithsoju');
  });

  it('renders the site row after resolving the active tab', async () => {
    const { default: App } = await import('../../../src/pages/popup/App.svelte');
    render(App);
    await new Promise((r) => setTimeout(r, 30));
    const host = document.querySelector('.site-host');
    expect(host?.textContent).toBe('example.com');
    // Toggle defaults to enabled (host not in disabledHosts).
    const checkbox = document.querySelector('input[type=checkbox]') as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    expect(checkbox.checked).toBe(true);
  });

  it('hides the site row on chrome:// pages (non-http protocol)', async () => {
    chromeStub.tabs.query.mockImplementation(async () => [
      { id: 1, url: 'chrome://extensions', active: true },
    ]);
    const { default: App } = await import('../../../src/pages/popup/App.svelte');
    render(App);
    await new Promise((r) => setTimeout(r, 30));
    // No site-host element should render when protocol is chrome://.
    expect(document.querySelector('.site-host')).toBeNull();
    // But the brand and links row are still there.
    expect(document.querySelector('.brand')).toBeTruthy();
    expect(document.querySelector('.links-row')).toBeTruthy();
  });

  it('toggling OFF writes the hostname to disabledHosts', async () => {
    const { default: App } = await import('../../../src/pages/popup/App.svelte');
    render(App);
    await new Promise((r) => setTimeout(r, 30));
    const checkbox = document.querySelector('input[type=checkbox]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    // Simulate the user clicking to uncheck. fireEvent.change reflects DOM state.
    checkbox.checked = false;
    await fireEvent.change(checkbox);
    await new Promise((r) => setTimeout(r, 10));
    const list = localStore.get('disabledHosts') as string[];
    expect(list).toEqual(['example.com']);
  });

  it('toggling ON removes the hostname from disabledHosts', async () => {
    localStore.set('disabledHosts', ['example.com', 'other.com']);
    const { default: App } = await import('../../../src/pages/popup/App.svelte');
    render(App);
    await new Promise((r) => setTimeout(r, 30));
    const checkbox = document.querySelector('input[type=checkbox]') as HTMLInputElement;
    // Starts unchecked because example.com is in the disabled list.
    expect(checkbox.checked).toBe(false);
    checkbox.checked = true;
    await fireEvent.change(checkbox);
    await new Promise((r) => setTimeout(r, 10));
    const list = localStore.get('disabledHosts') as string[];
    expect(list).toEqual(['other.com']);
  });

  it('renders disabled GitHub/Discord/Ko-fi placeholders when LINKS are empty', async () => {
    const { default: App } = await import('../../../src/pages/popup/App.svelte');
    render(App);
    await new Promise((r) => setTimeout(r, 20));
    // GitHub + Discord render as `link-icon--disabled` because LINKS are blank.
    const disabledIcons = document.querySelectorAll('.link-icon--disabled');
    expect(disabledIcons.length).toBe(2);
    // Ko-fi banner is in disabled state too.
    const banner = document.querySelector('.kofi-banner');
    expect(banner?.classList.contains('kofi-banner--disabled')).toBe(true);
  });

  it('options-icon click calls chrome.runtime.openOptionsPage', async () => {
    const { default: App } = await import('../../../src/pages/popup/App.svelte');
    render(App);
    await new Promise((r) => setTimeout(r, 20));
    // The settings/gear button is the only <button> in LinksRow.
    const gearBtn = document.querySelector('button[title="Open settings"]') as HTMLButtonElement;
    expect(gearBtn).toBeTruthy();
    await fireEvent.click(gearBtn);
    expect(chromeStub.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
  });

  it('notepad link href is resolved via chrome.runtime.getURL', async () => {
    const { default: App } = await import('../../../src/pages/popup/App.svelte');
    render(App);
    await new Promise((r) => setTimeout(r, 20));
    const notepad = document.querySelector('a[title^="Notepad"]') as HTMLAnchorElement;
    expect(notepad).toBeTruthy();
    expect(notepad.getAttribute('href')).toBe('chrome-extension://test/pages/notepad/notepad.html');
  });
});
