<script lang="ts">
  import ApiKeySection from './ApiKeySection.svelte';
  import SubtitleSection from './SubtitleSection.svelte';
  import AdvancedSection from './AdvancedSection.svelte';
  import CacheSection from './CacheSection.svelte';
  import { settingsReady } from '$lib/storage.svelte';

  // Kick hydration on mount. settingsReady() is idempotent so it's safe to
  // call from anywhere; doing it here lets us surface a brief "loading…"
  // state if hydration takes longer than one paint frame.
  let ready = $state(false);
  $effect(() => {
    settingsReady().then(() => {
      ready = true;
    });
  });

  // Version pulled from the manifest at mount — used in the footer.
  let version = $state('');
  $effect(() => {
    try {
      version = `v${chrome.runtime.getManifest().version}`;
    } catch {
      version = '';
    }
  });
</script>

<main>
  <header>
    <h1>learnwithsoju</h1>
    <p class="subtitle">Korean hover dictionary — settings</p>
  </header>

  {#if !ready}
    <p class="hint">Loading settings…</p>
  {:else}
    <ApiKeySection />
    <SubtitleSection />
    <AdvancedSection />
    <CacheSection />

    <footer>
      <p>
        Source &amp; issues:
        <a href="https://github.com/abishake/learnwithsoju" target="_blank" rel="noreferrer">github.com/abishake/learnwithsoju</a>
      </p>
      <p class="version">{version}</p>
    </footer>
  {/if}
</main>
