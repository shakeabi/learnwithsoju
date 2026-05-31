import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';

// The notepad page is pure local-state — no chrome.storage / runtime calls.
// We still stub `chrome` so any accidental access surfaces a clear error
// rather than `chrome is not defined`. The existing options test file owns
// the persistent stub; we keep this minimal because nothing in App.svelte
// or HoverableTarget.svelte talks to the extension APIs.
vi.stubGlobal('chrome', {
  runtime: { sendMessage: vi.fn(), getManifest: () => ({ version: '0.1.0' }) },
});

describe('notepad App.svelte', () => {
  // @testing-library/svelte auto-cleanup is opt-in. Without it, each test's
  // mount stays attached to document.body and the next test's
  // `document.getElementById('notepad-target')` picks up the stale (empty)
  // div from the previous render instead of the freshly-mounted one.
  afterEach(() => cleanup());

  it('renders the textarea and an initially-empty hoverable target div', async () => {
    const { default: App } = await import('../../../src/pages/notepad/App.svelte');
    render(App);
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    // The target div keeps the exact id + classes that content.js scans.
    const target = document.getElementById('notepad-target') as HTMLDivElement;
    expect(target).toBeTruthy();
    expect(target.classList.contains('notepad-target')).toBe(true);
    expect(target.classList.contains('lws-sentence-root')).toBe(true);
    expect(target.getAttribute('aria-live')).toBe('polite');
    // Empty on first paint — no committed text yet.
    expect(target.textContent).toBe('');
  });

  it('mirrors textarea input into the hoverable target after the 150 ms debounce', async () => {
    const { default: App } = await import('../../../src/pages/notepad/App.svelte');
    render(App);
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    // Set the value via the DOM property before firing input — Svelte's
    // onInput handler reads `e.currentTarget.value`, so the underlying
    // DOM value must be set or it reads the old (empty) string.
    textarea.value = '안녕';
    await fireEvent.input(textarea);
    // Immediately after input the target should still be empty — the
    // debounce window hasn't elapsed yet.
    let target = document.getElementById('notepad-target') as HTMLDivElement;
    expect(target.textContent).toBe('');
    // Wait less than the debounce and confirm still empty.
    await new Promise((r) => setTimeout(r, 80));
    target = document.getElementById('notepad-target') as HTMLDivElement;
    expect(target.textContent).toBe('');
    // Cross the 150 ms threshold (with margin for Svelte's effect flush).
    await new Promise((r) => setTimeout(r, 200));
    target = document.getElementById('notepad-target') as HTMLDivElement;
    expect(target.textContent).toBe('안녕');
  });

  it('coalesces rapid keystrokes into a single committed update', async () => {
    const { default: App } = await import('../../../src/pages/notepad/App.svelte');
    render(App);
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '안';
    await fireEvent.input(textarea);
    await new Promise((r) => setTimeout(r, 60));
    textarea.value = '안녕';
    await fireEvent.input(textarea);
    await new Promise((r) => setTimeout(r, 60));
    textarea.value = '안녕하';
    await fireEvent.input(textarea);
    // Still inside the rolling debounce window started by the last keystroke.
    let target = document.getElementById('notepad-target') as HTMLDivElement;
    expect(target.textContent).toBe('');
    // Now wait past the debounce + Svelte flush.
    await new Promise((r) => setTimeout(r, 220));
    target = document.getElementById('notepad-target') as HTMLDivElement;
    // Only the final value is committed — no intermediate '안' / '안녕' flash.
    expect(target.textContent).toBe('안녕하');
  });
});
