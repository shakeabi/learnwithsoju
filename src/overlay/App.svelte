<script lang="ts">
  import type { OverlayFrame, OverlayApi } from '$types/overlay';

  let currentFrame = $state<OverlayFrame | null>(null);
  let lookupStatus = $state<string>('');

  // Register the imperative API on window.__lwsOverlay so content.js can
  // drive the overlay from the bridge realm. This $effect runs once on
  // mount (no reactive deps) and removes the global on cleanup.
  $effect(() => {
    const api: OverlayApi = {
      show(frame: OverlayFrame) {
        console.log('[lws-overlay] show', frame);
        currentFrame = frame;
        lookupStatus = '';
      },
      hide() {
        console.log('[lws-overlay] hide');
        currentFrame = null;
        lookupStatus = '';
      },
      update(patch) {
        console.log('[lws-overlay] update', patch);
        if (patch.lookupStatus !== undefined) lookupStatus = patch.lookupStatus;
      },
    };
    window.__lwsOverlay = api;
    return () => {
      if (window.__lwsOverlay === api) {
        window.__lwsOverlay = undefined;
      }
    };
  });
</script>

{#if currentFrame}
  <div class="lws-overlay-skeleton" role="tooltip">
    <strong>overlay mount OK</strong>
    <div>frame.kind = {currentFrame.kind}</div>
    {#if currentFrame.kind === 'loading'}
      <div>surface = {currentFrame.surface}</div>
      <div>status = {lookupStatus || '(none)'}</div>
    {:else if currentFrame.kind === 'error'}
      <div>message = {currentFrame.message}</div>
      {#if currentFrame.details}<div>details = {currentFrame.details}</div>{/if}
    {:else if currentFrame.kind === 'payload'}
      <div>surface = {currentFrame.payload.lookup.surface || '(unknown)'}</div>
      <div>sentence = {currentFrame.payload.sentence?.word || '(none)'}</div>
    {/if}
  </div>
{/if}

<style>
  /* Bare-minimum styling so the placeholder is visible during 6a
   * verification. Task 7 replaces this with the full overlay styling. */
  .lws-overlay-skeleton {
    position: absolute;
    top: 8px;
    left: 8px;
    padding: 8px 12px;
    background: #1e1e2e;
    color: #e8e8f0;
    border: 2px solid #7d8cff;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 13px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    pointer-events: auto;
    z-index: 2147483647;
  }
</style>
