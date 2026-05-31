<script lang="ts">
  import { lookupHanja } from '$lib/messages';

  let {
    entry,
    source,
    tabId,
    sectionIdx,
    isOpen,
    defLang,
    onToggle,
  }: {
    entry: any;
    source: string;
    tabId: string;
    sectionIdx: number;
    isOpen: boolean;
    defLang: 'en' | 'ko';
    onToggle: () => void;
  } = $props();

  // POS Korean → English mapping. Mirrors content.js posToEnglish (pre-Task-6).
  const POS_KO_TO_EN: Record<string, string> = {
    '명사': 'noun',
    '대명사': 'pronoun',
    '수사': 'numeral',
    '동사': 'verb',
    '형용사': 'adjective',
    '관형사': 'determiner',
    '부사': 'adverb',
    '조사': 'particle',
    '감탄사': 'interjection',
    '의존 명사': 'dependent noun',
    '보조 동사': 'auxiliary verb',
    '보조 형용사': 'auxiliary adjective',
    '접사': 'affix',
  };
  function displayPos(pos: string): string {
    if (!pos) return '';
    if (defLang === 'en' && POS_KO_TO_EN[pos]) return POS_KO_TO_EN[pos];
    return pos;
  }

  // Hanja meanings — lazy-loaded the first time the entry expands with an
  // origin field. Cached per session so re-expand doesn't re-fetch.
  let hanjaState = $state<{ loading: boolean; hanjas: any[] | null; error: string | null }>(
    { loading: false, hanjas: null, error: null }
  );
  $effect(() => {
    if (!isOpen) return;
    if (!entry || !entry.origin) return;
    if (hanjaState.hanjas || hanjaState.loading) return;
    hanjaState.loading = true;
    lookupHanja(entry.origin).then((res: any) => {
      if (res && res.error) {
        hanjaState = { loading: false, hanjas: null, error: res.message || res.error };
        return;
      }
      hanjaState = { loading: false, hanjas: (res && res.hanjas) || [], error: null };
    }).catch((err) => {
      hanjaState = { loading: false, hanjas: null, error: (err as Error).message || String(err) };
    });
  });

  // Per-sense examples expand state.
  let expandedExamples = $state(new Set<string>());
  function toggleExamples(senseId: string) {
    if (expandedExamples.has(senseId)) expandedExamples.delete(senseId);
    else expandedExamples.add(senseId);
    expandedExamples = new Set(expandedExamples);
  }

  let isSynthetic = $derived(source === 'synthetic-nnp');
  let isOd = $derived(source === 'od');
</script>

{#if isSynthetic}
  <div class="lws-entry lws-section lws-section-open lws-synthetic">
    <div class="lws-headline">
      <span class="lws-word-form">{entry.word || ''}</span>
    </div>
    <div class="lws-meta-row">
      <span class="lws-chip lws-chip-cyan" title="Proper noun (name of a person, place, or thing)">고유명사</span>
      {#if entry.pronunciation}
        <span class="lws-chip lws-chip-soft">၊၊||၊ {entry.pronunciation}</span>
      {/if}
    </div>
    <div class="lws-synthetic-badge">ℹ Proper noun</div>
    <div class="lws-senses">
      <div class="lws-sense lws-synthetic-body">
        <div class="lws-ko-def">{entry.definition || ''}</div>
      </div>
    </div>
  </div>
{:else}
  <div
    class="lws-entry lws-section"
    class:lws-section-open={isOpen}
    class:lws-section-closed={!isOpen}
    class:lws-od-entry={isOd}
  >
    <button
      type="button"
      class="lws-section-header"
      aria-expanded={isOpen ? 'true' : 'false'}
      onclick={onToggle}
    >
      <div class="lws-headline">
        <span class="lws-word-form">{entry.word || ''}</span>
        {#if entry.stars}<span class="lws-stars">{'★'.repeat(Number(entry.stars) || 0)}</span>{/if}
        <span class="lws-section-indicator">{isOpen ? '−' : '+'}</span>
      </div>
      <div class="lws-meta-row">
        {#if entry.pos}<span class="lws-chip lws-chip-cyan">{displayPos(entry.pos)}</span>{/if}
        {#if entry.pronunciation}<span class="lws-chip lws-chip-soft">၊၊||၊ {entry.pronunciation}</span>{/if}
        {#if entry.origin}<span class="lws-chip lws-chip-amber">{entry.origin}</span>{/if}
      </div>
    </button>

    {#if isOpen}
      {#if entry.origin}
        <div class="lws-hanja-meanings">
          {#if hanjaState.loading}
            <div class="lws-hanja-loading">Loading Hanja meanings…</div>
          {:else if hanjaState.error}
            <div class="lws-hanja-empty">Hanja lookup failed: {hanjaState.error}</div>
          {:else if hanjaState.hanjas && hanjaState.hanjas.length > 0}
            {#each hanjaState.hanjas as h, i (i)}
              <div class="lws-hanja-row">
                <div class="lws-hanja-row-char">{(h as any).char || ''}</div>
                <div class="lws-hanja-row-sino">{(h as any).sino || ''}</div>
                <div class="lws-hanja-row-summary">{(h as any).meaning || ''}</div>
              </div>
            {/each}
          {:else if hanjaState.hanjas}
            <div class="lws-hanja-empty">No Hanja entries.</div>
          {/if}
        </div>
      {/if}

      {#if Array.isArray(entry.senses) && entry.senses.length > 0}
        <div class="lws-senses">
          {#each entry.senses as sense, idx (idx)}
            {@const senseId = `${tabId}:${source}:${sectionIdx}:${idx}`}
            <div class="lws-sense">
              <span class="lws-sense-num">{idx + 1}.</span>
              {#if defLang === 'en' && sense.translation}
                <span class="lws-trans-word">{sense.translation.word || ''}</span>
                <span class="lws-trans-dfn">{sense.translation.definition || ''}</span>
              {:else}
                <div class="lws-ko-def">{sense.definition || ''}</div>
              {/if}
              {#if Array.isArray(sense.examples) && sense.examples.length > 0}
                <button
                  type="button"
                  class="lws-examples-toggle"
                  aria-expanded={expandedExamples.has(senseId) ? 'true' : 'false'}
                  onclick={() => toggleExamples(senseId)}
                >
                  {expandedExamples.has(senseId) ? 'Hide' : 'Show'} examples ({sense.examples.length})
                </button>
                {#if expandedExamples.has(senseId)}
                  <ul class="lws-examples">
                    {#each sense.examples as ex, eIdx (eIdx)}
                      <li>{typeof ex === 'string' ? ex : (ex.ko || ex.en || '')}</li>
                    {/each}
                  </ul>
                {/if}
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      {#if isOd}
        <div class="lws-section-label lws-beta">via OpenDict (community-edited)</div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  /* Ported from extension/core/popup-shadow.css lines 578-856 (entry / section /
   * sense / hanja / synthetic / chip blocks that compose a dictionary entry card). */
  .lws-entry {
    padding: 4px 16px 14px;
  }
  .lws-entry + :global(.lws-entry) {
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .lws-section-header {
    display: flex;
    flex-direction: column;
    gap: 0;
    width: 100%;
    border: 0;
    background: transparent;
    font: inherit;
    color: inherit;
    text-align: left;
    padding: 0;
    cursor: pointer;
    border-radius: 6px;
    transition: background-color 0.12s ease;
  }
  .lws-section-header:hover {
    background: var(--soft);
  }
  .lws-section-closed .lws-section-header {
    margin-bottom: 0;
  }
  .lws-section-closed .lws-meta-row {
    margin-bottom: 0;
  }
  .lws-section-indicator {
    margin-left: auto;
    font-size: 14px;
    font-weight: 600;
    color: var(--muted);
    line-height: 1;
    align-self: center;
  }
  .lws-section-header[aria-expanded="true"] .lws-section-indicator {
    color: var(--chip-amber-fg);
  }
  .lws-headline {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 6px;
  }
  .lws-word-form {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--fg);
  }
  .lws-stars {
    color: var(--stars);
    font-size: 13px;
    letter-spacing: 1px;
    align-self: center;
  }
  .lws-meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 10px;
  }
  .lws-senses {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .lws-sense {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .lws-sense-num {
    font-size: 11px;
    color: var(--muted);
    margin-bottom: -2px;
  }
  .lws-trans-word {
    color: var(--chip-amber-fg);
    font-weight: 500;
    font-size: 14px;
  }
  .lws-trans-dfn {
    color: var(--fg);
    font-size: 13.5px;
  }
  .lws-ko-def {
    color: var(--fg);
    font-size: 13.5px;
  }
  .lws-examples-toggle {
    align-self: flex-start;
    margin-top: 4px;
    border: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 12px;
    padding: 2px 0;
    cursor: pointer;
    letter-spacing: 0.01em;
  }
  .lws-examples-toggle:hover {
    color: var(--chip-amber-fg);
  }
  .lws-examples-toggle[aria-expanded="true"] {
    color: var(--chip-amber-fg);
  }
  .lws-examples {
    margin: 4px 0 2px;
    padding: 8px 12px 8px 22px;
    background: var(--soft);
    border-left: 2px solid var(--chip-amber-bg);
    border-radius: 4px;
    list-style: disc;
    font-size: 13px;
    color: var(--fg);
  }
  .lws-examples li {
    margin: 2px 0;
    word-break: break-word;
  }
  .lws-section-label {
    margin-top: 14px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .lws-od-entry {
    margin-top: 8px;
    padding-top: 0;
    border-top: 0;
  }
  .lws-beta {
    display: inline-block;
    font-size: 9px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--chip-soft-bg);
    color: var(--chip-soft-fg);
    margin-left: 6px;
    vertical-align: 1px;
    font-weight: 500;
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
  .lws-chip-amber { background: var(--chip-amber-bg); color: var(--chip-amber-fg); }
  .lws-chip-cyan { background: var(--chip-cyan-bg); color: var(--chip-cyan-fg); }
  .lws-chip-soft { background: var(--chip-soft-bg); color: var(--chip-soft-fg); font-feature-settings: "tnum" 1; }
  .lws-hanja-meanings {
    margin: 6px 0 0;
    padding: 6px 10px;
    background: var(--soft);
    border-left: 2px solid var(--chip-amber-bg);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
    line-height: 1.45;
  }
  .lws-hanja-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }
  .lws-hanja-row-char {
    flex: 0 0 auto;
    font-size: 14px;
    font-weight: 600;
    color: var(--chip-amber-fg);
    min-width: 1.2em;
  }
  .lws-hanja-row-sino {
    flex: 0 0 auto;
    color: var(--muted);
    font-size: 11px;
    letter-spacing: 0.02em;
  }
  .lws-hanja-row-summary {
    flex: 1 1 auto;
    color: var(--fg);
  }
  .lws-hanja-loading,
  .lws-hanja-empty {
    color: var(--muted);
    font-size: 12px;
    font-style: italic;
  }
  .lws-synthetic {
    background: var(--soft);
    border-radius: 8px;
    border: 1px dashed var(--border-strong);
  }
  .lws-synthetic-badge {
    font-size: 11px;
    letter-spacing: 0.04em;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .lws-synthetic-body {
    font-style: italic;
    color: var(--muted);
  }
</style>
