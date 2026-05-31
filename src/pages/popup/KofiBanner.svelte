<script lang="ts">
  import { LINKS } from './links';

  let url = $state('');
  let enabled = $state(false);

  $effect(() => {
    url = LINKS.kofi || '';
    enabled = !!url;
  });
</script>

{#if enabled}
  <a class="kofi-banner" href={url} target="_blank" rel="noopener noreferrer" title="Support on Ko-fi">
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>
    <span>Support on Ko-fi</span>
  </a>
{:else}
  <a class="kofi-banner kofi-banner--disabled" aria-disabled="true" title="Support on Ko-fi — coming soon">
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>
    <span>Support on Ko-fi</span>
  </a>
{/if}

<style>
  .kofi-banner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin-top: 10px;
    width: 100%;
    padding: 7px 0;
    background: #ff5e5b;
    color: #ffffff;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    text-decoration: none;
    transition: filter 0.12s ease;
  }

  .kofi-banner:hover {
    filter: brightness(1.08);
  }

  .kofi-banner--disabled {
    opacity: 0.45;
    pointer-events: none;
    cursor: default;
  }
</style>
