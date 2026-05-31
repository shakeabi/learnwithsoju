<script lang="ts">
  import { LINKS, LINK_META } from './links';

  let notepadUrl = $state('#');

  $effect(() => {
    try {
      notepadUrl = chrome.runtime.getURL('pages/notepad/notepad.html');
    } catch {
      notepadUrl = '#';
    }
  });

  function openOptions(e: Event) {
    e.preventDefault();
    try {
      chrome.runtime.openOptionsPage();
    } catch { /* ignore */ }
    window.close();
  }

  // External links to render after the built-in icons. Key drives the
  // tooltip + svg lookup; URL is empty for "coming soon" placeholders.
  const EXTERNAL_KEYS: Array<'github' | 'discord'> = ['github', 'discord'];
</script>

<section class="links-row">
  <a
    class="link-icon"
    href={notepadUrl}
    target="_blank"
    rel="noopener noreferrer"
    title="Notepad — paste text to hover-look-up"
  >
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15z"/><path d="M8 2v20M12 7h6M12 11h6M12 15h4"/></svg>
  </a>
  <button type="button" class="link-icon" title="Open settings" onclick={openOptions}>
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
  </button>

  {#each EXTERNAL_KEYS as key (key)}
    {@const meta = LINK_META[key]}
    {@const url = LINKS[key]}
    {#if url}
      <a class="link-icon" href={url} target="_blank" rel="noopener noreferrer" title={meta.title}>
        {@html meta.svg}
      </a>
    {:else}
      <a class="link-icon link-icon--disabled" aria-disabled="true" title={meta.placeholderTitle}>
        {@html meta.svg}
      </a>
    {/if}
  {/each}
</section>

<style>
  .links-row {
    margin-top: 14px;
    border-top: 1px solid var(--border);
    padding-top: 12px;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    gap: 10px;
  }

  .link-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    background: transparent;
    border-radius: 4px;
    color: var(--muted);
    text-decoration: none;
    cursor: pointer;
    transition: color 0.12s ease, background 0.12s ease;
  }

  .link-icon:hover {
    color: var(--fg);
    background: rgba(120, 140, 200, 0.12);
  }

  .link-icon--disabled {
    opacity: 0.4;
    pointer-events: none;
    cursor: default;
  }
</style>
