<script lang="ts">
  // Top-of-popup strip: focus word/lemma chip on the left + EN/KR
  // definition-language toggle on the right. Mirrors the pre-Task-7
  // buildStripNode in extension/content.js (lines 1270-1300). The toggle
  // writes to chrome.storage.sync key `defLang`; storage.onChanged flows
  // back through the bridge as an `update({ defLang })` patch so the
  // already-open popup re-renders against the new value without a fresh
  // hover/re-fetch.
  //
  // The focus word is the surface the user actually hovered (always shown
  // in bold). The lemma chip is only shown when the lemma differs from the
  // surface — same gating rule as buildStripNode's showLemmaChip path.

  let {
    surface,
    lemma,
    defLang,
    onSetDefLang,
  }: {
    surface: string;
    lemma: string | null | undefined;
    defLang: 'en' | 'ko';
    onSetDefLang: (lang: 'en' | 'ko') => void;
  } = $props();

  let showLemmaChip = $derived(!!lemma && lemma !== surface);
</script>

<div class="lws-strip">
  <div class="lws-strip-lemma">
    {#if surface}
      <span class="lws-strip-focus" title="Looked up word">{surface}</span>
    {/if}
    {#if showLemmaChip}
      <span class="lws-chip lws-chip-amber">{lemma}</span>
    {/if}
  </div>
  <div class="lws-toggle" role="group" aria-label="Definition language">
    <button
      type="button"
      class="lws-toggle-btn"
      data-lang="en"
      aria-pressed={defLang === 'en' ? 'true' : 'false'}
      onclick={() => onSetDefLang('en')}
    >영어</button>
    <button
      type="button"
      class="lws-toggle-btn"
      data-lang="ko"
      aria-pressed={defLang === 'ko' ? 'true' : 'false'}
      onclick={() => onSetDefLang('ko')}
    >한국어</button>
  </div>
</div>

<style>
  /* Ported from extension/core/popup-shadow.css lines 294-340 (lws-strip
   * + lws-toggle blocks). The .lws-strip-focus rule is new — the
   * pre-Task-7 strip didn't show the focus word inline because the active
   * entry's .lws-word-form already displayed it at 22px; we surface it
   * here so the user has an at-a-glance anchor even before tab content
   * loads. */
  .lws-strip {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px 8px;
    flex-wrap: wrap;
  }
  .lws-strip-lemma {
    flex: 1 1 auto;
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }
  .lws-strip-focus {
    font-size: 16px;
    font-weight: 600;
    color: var(--fg);
    letter-spacing: -0.01em;
  }
  .lws-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    padding: 2px 9px;
    border-radius: 999px;
    font-weight: 500;
    white-space: nowrap;
  }
  .lws-chip-amber {
    background: var(--chip-amber-bg);
    color: var(--chip-amber-fg);
  }
  .lws-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0;
    padding: 0;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 999px;
    overflow: hidden;
    flex: 0 0 auto;
  }
  .lws-toggle-btn {
    border: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 12px;
    padding: 4px 10px;
    cursor: pointer;
    line-height: 1.4;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .lws-toggle-btn[aria-pressed="true"] {
    background: var(--chip-amber-bg);
    color: var(--chip-amber-fg);
  }
  .lws-toggle-btn:hover:not([aria-pressed="true"]) {
    color: var(--fg);
  }
</style>
