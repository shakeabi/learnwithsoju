<script lang="ts">
  let {
    groups,
    unrelated,
    activeTab,
    relatedExpanded,
    onPrimaryTabClick,
    onRelatedTabClick,
    onToggleRelated,
  }: {
    groups: Array<{ word: string; count?: number }>;
    unrelated: Array<{ word: string; count?: number }>;
    activeTab: { source: 'primary' | 'related'; index: number };
    relatedExpanded: boolean;
    onPrimaryTabClick: (idx: number) => void;
    onRelatedTabClick: (idx: number) => void;
    onToggleRelated: () => void;
  } = $props();
</script>

<div class="lws-tabs" role="tablist">
  {#each groups as g, i (i)}
    {@const isActive = activeTab.source === 'primary' && activeTab.index === i}
    <button
      type="button"
      class="lws-tab"
      class:lws-tab-active={isActive}
      role="tab"
      aria-selected={isActive ? 'true' : 'false'}
      onclick={() => onPrimaryTabClick(i)}
    >
      {g.word}
      {#if g.count != null && g.count > 1}<span class="lws-tab-count">{g.count}</span>{/if}
    </button>
  {/each}

  {#if unrelated.length > 0}
    <button
      type="button"
      class="lws-related-pill"
      class:lws-related-pill-open={relatedExpanded}
      aria-expanded={relatedExpanded ? 'true' : 'false'}
      onclick={onToggleRelated}
    >
      {relatedExpanded ? '−' : '+'} Related ({unrelated.length})
    </button>
  {/if}
</div>

{#if relatedExpanded && unrelated.length > 0}
  <div class="lws-related-tab-row" role="tablist">
    {#each unrelated as u, i (i)}
      {@const isActive = activeTab.source === 'related' && activeTab.index === i}
      <button
        type="button"
        class="lws-tab"
        class:lws-tab-active={isActive}
        role="tab"
        aria-selected={isActive ? 'true' : 'false'}
        onclick={() => onRelatedTabClick(i)}
      >
        {u.word}
        {#if u.count != null && u.count > 1}<span class="lws-tab-count">{u.count}</span>{/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  /* Ported from extension/core/popup-shadow.css lines 474-575 (tab strip + related pill). */
  .lws-tabs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 8px 14px 10px;
    border-bottom: 1px solid var(--border);
  }
  .lws-tab {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 12.5px;
    padding: 4px 12px;
    cursor: pointer;
    border-radius: 999px;
    white-space: nowrap;
    transition: background-color 0.12s ease, color 0.12s ease;
    flex: 0 0 auto;
  }
  .lws-tab:hover:not([aria-selected="true"]) {
    background: var(--soft);
    color: var(--fg);
  }
  .lws-tab[aria-selected="true"],
  .lws-tab.lws-tab-active {
    background: var(--chip-amber-bg);
    color: var(--chip-amber-fg);
    font-weight: 500;
  }
  .lws-tab-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 600;
    line-height: 1;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--border-strong);
    color: var(--muted);
  }
  .lws-tab[aria-selected="true"] .lws-tab-count,
  .lws-tab.lws-tab-active .lws-tab-count {
    background: var(--chip-amber-fg);
    color: #000;
  }
  .lws-related-tab-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 6px 14px 8px;
    border-bottom: 1px solid var(--border);
    background: var(--soft);
  }
  .lws-related-pill {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--border-strong);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 11.5px;
    padding: 3px 10px;
    cursor: pointer;
    border-radius: 999px;
    white-space: nowrap;
    transition: background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease;
    flex: 0 0 auto;
    margin-left: auto;
  }
  .lws-related-pill:hover {
    background: var(--soft);
    color: var(--fg);
    border-color: var(--border-strong);
  }
  .lws-related-pill.lws-related-pill-open {
    background: var(--soft);
    color: var(--fg);
    border-color: var(--border-strong);
  }
</style>
