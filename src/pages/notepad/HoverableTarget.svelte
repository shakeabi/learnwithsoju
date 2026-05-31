<script lang="ts">
  // The hoverable target — content.js's mutation observer treats any text
  // added under this div as wrappable. `lws-sentence-root` is a hard ceiling
  // for the sentence extraction walk-up (see content.js extractSentence) so
  // sibling instruction text in the page doesn't leak into the sentence
  // context.
  //
  // The textContent is set by the parent App.svelte via the `text` prop.
  // We render it inside a {#key} block so Svelte rebuilds the entire div
  // when text changes — that way content.js's MutationObserver sees a fresh
  // text node and re-wraps it cleanly (no stale .lws-word spans left over).
  //
  // We bypass Svelte's normal text reactivity (e.g. `{text}`) for one
  // reason: when text changes from "안녕" → "안녕하세요", Svelte's diff
  // updates the text content of the existing span, which would not invalidate
  // the existing .lws-word spans that content.js wrapped earlier. Forcing a
  // full re-render via {#key text} guarantees the wrap pipeline restarts.

  let { text }: { text: string } = $props();
</script>

{#key text}
  <div
    id="notepad-target"
    class="notepad-target lws-sentence-root"
    aria-live="polite"
  >{text}</div>
{/key}
