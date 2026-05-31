import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';

// Persistent chrome stub. The overlay App imports lib/messages.ts which
// reaches for chrome.runtime.sendMessage, and the EntrySection/MorphemeBreakdown
// children reach for chrome.runtime.getURL + dynamic imports. We install ONE
// stub for the whole suite (same pattern as options/popup tests) so any closure
// over `chrome` from a prior test stays attached to the live registry.
const sendMessageMock = vi.fn(async (msg: any) => {
  if (msg?.type === 'lookup') {
    // Sentence-word click path — return a minimal lookup response so the
    // overlay can render the new payload.
    return { surface: msg.surface, tokens: [], groups: [], unrelated: [] };
  }
  if (msg?.type === 'lookupHanja') return { chars: msg.chars, hanjas: [] };
  return {};
});

const chromeStub = {
  runtime: {
    sendMessage: sendMessageMock,
    getURL: (p: string) => `chrome-extension://test/${p}`,
    getManifest: () => ({ version: '0.1.0' }),
  },
  storage: {
    sync: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
    onChanged: {
      addListener: () => {},
      removeListener: () => {},
    },
  },
};
vi.stubGlobal('chrome', chromeStub);

// A pre-materialized payload — bypasses the parsers.js dynamic import by
// pre-populating the __entryCache so materializeGroup finds entries directly.
function makePayload(opts: { dupAcrossQueries?: boolean } = {}): any {
  const baseEntry = {
    word: '학교',
    pos: '명사',
    pronunciation: '학꾜',
    senses: [{ definition: '학생들이 공부하는 곳', translation: { word: 'school', definition: 'a place of education' } }],
  };
  const alt = {
    word: '학교',
    pos: '명사',
    pronunciation: '학꾜',
    senses: [{ definition: '교육 기관', translation: { word: 'school', definition: 'an institution' } }],
  };
  const odEntry = {
    word: '학교',
    pos: '명사',
    pronunciation: '학꾜',
    senses: [{ definition: '학생들이 공부하는 곳' }],
  };
  // Two primary groups: one normal (1 entry), one with two sections that
  // dedup to the same entry when dupAcrossQueries=true.
  const payload: any = {
    surface: '학교',
    tokens: [{ surface: '학교', pos: '명사' }],
    krXmls: ['<x/>', '<x/>'],
    odXml: '<x/>',
    groups: [
      { word: '학교', sections: [{ source: 'kr', queryIdx: 0, itemIdx: 0 }] },
      {
        word: '학교2',
        sections: [
          { source: 'kr', queryIdx: 0, itemIdx: 0 },
          { source: 'kr', queryIdx: 1, itemIdx: 0 },
        ],
      },
    ],
    unrelated: [
      { word: '학생', sections: [{ source: 'kr', queryIdx: 0, itemIdx: 0 }] },
    ],
  };
  // Pre-populate the entry cache so materializeGroup doesn't hit the
  // parsers dynamic import. opts.dupAcrossQueries makes the queryIdx=1
  // hit return the identical-identity entry; otherwise alt.
  payload.__entryCache = {
    kr: new Map<number, any[]>([
      [0, [baseEntry]],
      [1, [opts.dupAcrossQueries ? { ...baseEntry } : alt]],
    ]),
    od: [odEntry],
  };
  return payload;
}

function makeFrame(payload: any) {
  return {
    kind: 'payload' as const,
    payload: {
      lookup: payload,
      sentence: { before: '오늘 ', word: '학교', after: '에 갔어요.' },
      anchor: { top: 100, left: 100, bottom: 120, right: 200, width: 100, height: 20 },
      secondaryLang: 'en',
      defLang: 'en' as const,
      askAiProvider: 'chatgpt',
      askAiPromptTemplate: '',
      askAiChatGptTemporary: false,
      reposition: true,
    },
  };
}

describe('overlay App.svelte orchestration', () => {
  afterEach(() => {
    cleanup();
    // Clear the registered global so each test installs a fresh API via its
    // own mount $effect.
    (window as any).__lwsOverlay = undefined;
  });

  beforeEach(() => {
    sendMessageMock.mockClear();
  });

  it('mounts and registers window.__lwsOverlay', async () => {
    const { default: App } = await import('../../../src/overlay/App.svelte');
    render(App);
    // The mount $effect registers the API synchronously inside the effect run;
    // a microtask is enough to let it land.
    await new Promise((r) => setTimeout(r, 5));
    expect((window as any).__lwsOverlay).toBeTruthy();
    expect(typeof (window as any).__lwsOverlay.show).toBe('function');
  });

  it('tab switching changes the active group', async () => {
    const { default: App } = await import('../../../src/overlay/App.svelte');
    render(App);
    await new Promise((r) => setTimeout(r, 5));
    const payload = makePayload();
    (window as any).__lwsOverlay.show(makeFrame(payload));
    // Wait for async materializeGroup to settle.
    await new Promise((r) => setTimeout(r, 30));
    // Tab 0 active by default — its first entry expanded.
    const tabs = document.querySelectorAll('.lws-tab');
    expect(tabs.length).toBeGreaterThanOrEqual(2);
    // Click tab 1.
    await fireEvent.click(tabs[1]);
    await new Promise((r) => setTimeout(r, 10));
    // Tab 1 now has aria-selected=true.
    const updatedTabs = document.querySelectorAll('.lws-tab');
    expect(updatedTabs[1].getAttribute('aria-selected')).toBe('true');
    expect(updatedTabs[0].getAttribute('aria-selected')).toBe('false');
  });

  it('exclusive expand: opening entry B collapses entry A', async () => {
    const { default: App } = await import('../../../src/overlay/App.svelte');
    render(App);
    await new Promise((r) => setTimeout(r, 5));
    const payload = makePayload();
    (window as any).__lwsOverlay.show(makeFrame(payload));
    await new Promise((r) => setTimeout(r, 30));
    // Switch to tab 1, which has two sections (before dedup).
    const tabs = document.querySelectorAll('.lws-tab');
    await fireEvent.click(tabs[1]);
    await new Promise((r) => setTimeout(r, 10));
    const headers = document.querySelectorAll('.lws-section-header');
    expect(headers.length).toBe(2);
    // Default: first section open, second closed.
    expect(headers[0].getAttribute('aria-expanded')).toBe('true');
    expect(headers[1].getAttribute('aria-expanded')).toBe('false');
    // Click the second section's header — it should open and the first should close.
    await fireEvent.click(headers[1]);
    await new Promise((r) => setTimeout(r, 10));
    const updated = document.querySelectorAll('.lws-section-header');
    expect(updated[0].getAttribute('aria-expanded')).toBe('false');
    expect(updated[1].getAttribute('aria-expanded')).toBe('true');
  });

  it('two-stage related reveal: first click reveals the row, does NOT auto-select', async () => {
    const { default: App } = await import('../../../src/overlay/App.svelte');
    render(App);
    await new Promise((r) => setTimeout(r, 5));
    const payload = makePayload();
    (window as any).__lwsOverlay.show(makeFrame(payload));
    await new Promise((r) => setTimeout(r, 30));
    // No related row visible yet.
    expect(document.querySelector('.lws-related-tab-row')).toBeNull();
    // Click the related pill.
    const pill = document.querySelector('.lws-related-pill') as HTMLButtonElement;
    expect(pill).toBeTruthy();
    await fireEvent.click(pill);
    await new Promise((r) => setTimeout(r, 10));
    // Now the row exists with one button (the '학생' related word).
    expect(document.querySelector('.lws-related-tab-row')).toBeTruthy();
    // ActiveTab should still be primary, index 0 — first click only reveals.
    const primaryTabs = document.querySelectorAll('.lws-tabs > .lws-tab');
    expect(primaryTabs[0].getAttribute('aria-selected')).toBe('true');
    // Click the related tab button — second stage.
    const relatedTab = document.querySelector('.lws-related-tab-row .lws-tab') as HTMLButtonElement;
    expect(relatedTab).toBeTruthy();
    await fireEvent.click(relatedTab);
    await new Promise((r) => setTimeout(r, 10));
    expect(relatedTab.getAttribute('aria-selected')).toBe('true');
  });

  it('entry dedup: same identity across queries renders once (f8afd99 invariant)', async () => {
    const { default: App } = await import('../../../src/overlay/App.svelte');
    render(App);
    await new Promise((r) => setTimeout(r, 5));
    const payload = makePayload({ dupAcrossQueries: true });
    (window as any).__lwsOverlay.show(makeFrame(payload));
    await new Promise((r) => setTimeout(r, 30));
    // Switch to tab 1 (the group with two identical-identity sections).
    const tabs = document.querySelectorAll('.lws-tab');
    await fireEvent.click(tabs[1]);
    await new Promise((r) => setTimeout(r, 10));
    // Exactly one section should render (dedup).
    const headers = document.querySelectorAll('.lws-section-header');
    expect(headers.length).toBe(1);
  });
});
