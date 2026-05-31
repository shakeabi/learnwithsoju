<script lang="ts">
  import { openOptions } from '$lib/messages';

  let { message, details, action }: {
    message: string;
    details?: string;
    action?: { label: string; onClick?: () => void; actionType?: string };
  } = $props();

  async function onAction() {
    if (!action) return;
    if (typeof action.onClick === 'function') {
      try { action.onClick(); } catch (err) {
        console.warn('[lws] overlay ErrorFrame: action onClick threw', err);
      }
      return;
    }
    if (action.actionType === 'openOptions') {
      try {
        await openOptions();
      } catch (err) {
        console.warn('[lws] overlay ErrorFrame: openOptions failed', err);
      }
    }
  }
</script>

<div class="lws-popup-body lws-error">
  <div class="lws-error-msg">{message}</div>
  {#if details}
    <div class="lws-error-detail">{details}</div>
  {/if}
  {#if action}
    <button class="lws-action-btn" type="button" onclick={onAction}>{action.label}</button>
  {/if}
</div>
