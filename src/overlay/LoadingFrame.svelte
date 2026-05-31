<script lang="ts">
  let { surface, status }: { surface: string; status: string } = $props();
</script>

<div class="lws-popup-body lws-loading">
  <span class="lws-loading-word">{surface}</span>
  <span class="lws-loading-status">{status}</span>
</div>
