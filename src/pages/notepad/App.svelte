<script lang="ts">
  import HoverableTarget from './HoverableTarget.svelte';

  let inputText = $state('');
  let committedText = $state('');
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let textareaEl: HTMLTextAreaElement | undefined;

  // 150 ms debounce so each keystroke doesn't trigger a content.js
  // re-wrap pass — matches the original notepad.js behaviour.
  function onInput(e: Event) {
    inputText = (e.currentTarget as HTMLTextAreaElement).value;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      committedText = inputText;
    }, 150);
  }

  // Autofocus the textarea so the user can paste immediately on landing.
  $effect(() => {
    textareaEl?.focus();
  });
</script>

<main>
  <header>
    <h1>Notepad</h1>
    <p class="subtitle">Paste Korean text and hover any word to look it up.</p>
  </header>

  <section class="card">
    <label class="field">
      <span class="label">Paste text</span>
      <textarea
        bind:this={textareaEl}
        rows="8"
        spellcheck="false"
        placeholder="Paste Korean text here — it becomes hoverable as you type."
        value={inputText}
        oninput={onInput}
      ></textarea>
    </label>
  </section>

  <section class="card">
    <h2>Hoverable text</h2>
    <p class="hint">Korean words below are hoverable — the same dictionary popup you get on any webpage.</p>
    <HoverableTarget text={committedText} />
  </section>
</main>
