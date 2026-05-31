import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import type { MecabInspectResponse } from '../../../src/types/messages';

// Persistent chrome stub. The morpheme-inspector talks to the background via
// chrome.runtime.sendMessage (mecab-inspect). Tests configure the response by
// mutating `nextResponse`. The stub is installed once and never replaced —
// importing modules later (App.svelte) capture this reference, so swapping the
// stub between tests would orphan any closures.
let nextResponse: MecabInspectResponse | undefined;
let lastRequest: unknown = null;
let sendCallCount = 0;

const chromeStub = {
  runtime: {
    sendMessage: vi.fn(async (msg: unknown) => {
      lastRequest = msg;
      sendCallCount += 1;
      return nextResponse;
    }),
    getManifest: () => ({ version: '0.1.0' }),
  },
};
vi.stubGlobal('chrome', chromeStub);

const SAMPLE_RESPONSE: MecabInspectResponse = {
  singlePath: [
    {
      surface: '오늘',
      pos: 'NNG',
      type: '',
      firstPos: 'NNG',
      lastPos: 'NNG',
      decomp: '',
      reading: '오늘',
      features: 'NNG,*,T,오늘,*,*,*,*',
    },
    {
      surface: '학교',
      pos: 'NNG',
      type: '',
      firstPos: 'NNG',
      lastPos: 'NNG',
      decomp: '',
      reading: '학교',
      features: 'NNG,*,F,학교,*,*,*,*',
    },
  ],
  nbestPaths: [
    {
      cost: 1234,
      tokens: [
        {
          surface: '오늘',
          pos: 'NNG',
          type: '',
          firstPos: 'NNG',
          lastPos: 'NNG',
          decomp: '',
          reading: '오늘',
          features: 'NNG,*,T,오늘,*,*,*,*',
        },
      ],
    },
    {
      cost: 1500,
      tokens: [
        {
          surface: '오늘',
          pos: 'MAG',
          type: '',
          firstPos: 'MAG',
          lastPos: 'MAG',
          decomp: '',
          reading: '오늘',
          features: 'MAG,*,T,오늘,*,*,*,*',
        },
      ],
    },
  ],
  candidates: ['오늘', '학교', '가다'],
};

describe('morpheme-inspector App.svelte', () => {
  // @testing-library/svelte cleanup is opt-in; without it each test's mount
  // stays attached to document.body and subsequent renders observe stale DOM.
  afterEach(() => cleanup());

  beforeEach(() => {
    chromeStub.runtime.sendMessage.mockClear();
    nextResponse = undefined;
    lastRequest = null;
    sendCallCount = 0;
  });

  it('renders the textarea and an initial placeholder', async () => {
    const { default: App } = await import('../../../src/pages/morpheme-inspector/App.svelte');
    render(App);
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    // Initial state: placeholder section with the "Enter Korean text..." copy.
    const placeholder = document.querySelector('.inspector-placeholder');
    expect(placeholder?.textContent).toContain('Enter Korean text');
  });

  it('debounces input ~200 ms before calling mecab-inspect', async () => {
    nextResponse = SAMPLE_RESPONSE;
    const { default: App } = await import('../../../src/pages/morpheme-inspector/App.svelte');
    render(App);
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '오늘';
    await fireEvent.input(textarea);
    // Immediately after input — no send yet.
    expect(sendCallCount).toBe(0);
    // Wait less than the debounce.
    await new Promise((r) => setTimeout(r, 100));
    expect(sendCallCount).toBe(0);
    // Cross the 200 ms threshold (with margin).
    await new Promise((r) => setTimeout(r, 200));
    expect(sendCallCount).toBe(1);
    expect((lastRequest as { type: string }).type).toBe('mecab-inspect');
    expect((lastRequest as { text: string }).text).toBe('오늘');
    expect((lastRequest as { nbest: number }).nbest).toBe(5);
  });

  it('renders all three result sections after a successful response', async () => {
    nextResponse = SAMPLE_RESPONSE;
    const { default: App } = await import('../../../src/pages/morpheme-inspector/App.svelte');
    render(App);
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '오늘 학교에 갔어요';
    await fireEvent.input(textarea);
    // Wait past debounce + microtasks for the response to render.
    await new Promise((r) => setTimeout(r, 260));
    // Section 1: single best path — 2 token rows.
    const sections = document.querySelectorAll('.inspector-section');
    expect(sections.length).toBe(3);
    const headings = Array.from(document.querySelectorAll('.inspector-section h2')).map(
      (h) => h.textContent
    );
    expect(headings[0]).toBe('Single best path');
    expect(headings[1]).toBe('N-best paths (2)');
    expect(headings[2]).toBe('Lemma candidates');
    // First section has 2 tbody rows (2 tokens).
    const tables = document.querySelectorAll('.token-table');
    // 1 (single path) + 2 (one per n-best path) = 3 tables.
    expect(tables.length).toBe(3);
    const firstTableRows = tables[0].querySelectorAll('tbody tr');
    expect(firstTableRows.length).toBe(2);
    // First row, first cell (surface) is '오늘'.
    expect(firstTableRows[0].querySelector('.col-surface')?.textContent).toBe('오늘');
    // Features cell carries the title attribute for hover tooltip.
    const featuresCell = firstTableRows[0].querySelector('.col-features') as HTMLElement;
    expect(featuresCell.getAttribute('title')).toBe('NNG,*,T,오늘,*,*,*,*');
    // N-best section: 2 path-cards, first one open.
    const pathCards = document.querySelectorAll('.path-card');
    expect(pathCards.length).toBe(2);
    expect((pathCards[0] as HTMLDetailsElement).open).toBe(true);
    expect((pathCards[1] as HTMLDetailsElement).open).toBe(false);
    // Candidate chips: 3 chips with the candidate strings.
    const chips = document.querySelectorAll('.candidate-chip');
    expect(chips.length).toBe(3);
    expect(Array.from(chips).map((c) => c.textContent)).toEqual(['오늘', '학교', '가다']);
  });

  it('shows the error message and stops when the background returns an error other than NOT_READY', async () => {
    nextResponse = { error: 'BOOM' };
    const { default: App } = await import('../../../src/pages/morpheme-inspector/App.svelte');
    render(App);
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '안녕';
    await fireEvent.input(textarea);
    await new Promise((r) => setTimeout(r, 260));
    const err = document.querySelector('.inspector-error') as HTMLElement;
    expect(err).toBeTruthy();
    expect(err.textContent).toContain('Failed to analyze');
    expect(err.textContent).toContain('BOOM');
  });

  it('retries after 500 ms when the background returns NOT_READY', async () => {
    nextResponse = { error: 'NOT_READY' };
    const { default: App } = await import('../../../src/pages/morpheme-inspector/App.svelte');
    render(App);
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '안녕';
    await fireEvent.input(textarea);
    // First call after debounce (~200 ms).
    await new Promise((r) => setTimeout(r, 260));
    expect(sendCallCount).toBe(1);
    // Switch to a successful response for the retry.
    nextResponse = SAMPLE_RESPONSE;
    // Retry fires 500 ms after the NOT_READY response — wait past that.
    await new Promise((r) => setTimeout(r, 600));
    expect(sendCallCount).toBeGreaterThanOrEqual(2);
    // Result tables should now be in the DOM.
    const tables = document.querySelectorAll('.token-table');
    expect(tables.length).toBeGreaterThan(0);
  });

  it('clears back to the empty placeholder when the textarea is emptied', async () => {
    nextResponse = SAMPLE_RESPONSE;
    const { default: App } = await import('../../../src/pages/morpheme-inspector/App.svelte');
    render(App);
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '안녕';
    await fireEvent.input(textarea);
    await new Promise((r) => setTimeout(r, 260));
    // Results rendered.
    expect(document.querySelectorAll('.token-table').length).toBeGreaterThan(0);
    // Empty the textarea.
    textarea.value = '';
    await fireEvent.input(textarea);
    await new Promise((r) => setTimeout(r, 260));
    // No tables, placeholder is back.
    expect(document.querySelectorAll('.token-table').length).toBe(0);
    const placeholder = document.querySelector('.inspector-placeholder');
    expect(placeholder?.textContent).toContain('Enter Korean text');
  });
});
