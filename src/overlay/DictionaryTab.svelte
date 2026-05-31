<script lang="ts">
  import EntrySection from './EntrySection.svelte';
  import type { MaterializedGroup } from './lib/entries';

  let {
    group,
    tabId,
    defLang,
    expandedIdx,
    onSectionToggle,
  }: {
    group: MaterializedGroup;
    tabId: string;
    defLang: 'en' | 'ko';
    expandedIdx: number | null;
    onSectionToggle: (idx: number) => void;
  } = $props();
</script>

<div class="lws-tab-body">
  {#each group.entries as e, idx (idx)}
    <EntrySection
      entry={e.entry}
      source={e.source}
      tabId={tabId}
      sectionIdx={idx}
      isOpen={expandedIdx === idx || e.source === 'synthetic-nnp'}
      defLang={defLang}
      onToggle={() => onSectionToggle(idx)}
    />
  {/each}
</div>

<style>
  .lws-tab-body {
    display: flex;
    flex-direction: column;
  }
</style>
