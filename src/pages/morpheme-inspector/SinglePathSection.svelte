<script lang="ts">
  import type { MecabToken } from '$types/messages';
  import TokenTable from './TokenTable.svelte';

  let { tokens }: { tokens: MecabToken[] } = $props();
</script>

<section class="inspector-section">
  <h2>Single best path</h2>
  {#if tokens.length === 0}
    <p class="inspector-placeholder">No tokens.</p>
  {:else}
    <TokenTable {tokens} />
  {/if}
</section>
