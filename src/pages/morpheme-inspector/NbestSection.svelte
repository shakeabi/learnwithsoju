<script lang="ts">
  import type { MecabNbestPath } from '$types/messages';
  import TokenTable from './TokenTable.svelte';

  let { paths }: { paths: MecabNbestPath[] } = $props();
</script>

<section class="inspector-section">
  <h2>N-best paths ({paths.length})</h2>
  {#if paths.length === 0}
    <p class="inspector-placeholder">No paths.</p>
  {:else}
    {#each paths as path, i (i)}
      <details class="path-card" open={i === 0}>
        <summary>Path #{i}  (cost={path.cost})</summary>
        <div class="path-body">
          <TokenTable tokens={path.tokens} />
        </div>
      </details>
    {/each}
  {/if}
</section>
