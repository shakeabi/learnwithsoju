<script lang="ts">
  let { candidates }: { candidates: string[] } = $props();
</script>

<section class="inspector-section">
  <h2>Lemma candidates</h2>
  {#if candidates.length === 0}
    <p class="inspector-placeholder">No candidates.</p>
  {:else}
    <ul class="candidates-list">
      {#each candidates as cand (cand)}
        <li class="candidate-chip">{cand}</li>
      {/each}
    </ul>
  {/if}
</section>
