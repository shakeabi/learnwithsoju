<script lang="ts">
  import { mecabInspect } from '$lib/messages';
  import type { MecabToken, MecabNbestPath } from '$types/messages';
  import SinglePathSection from './SinglePathSection.svelte';
  import NbestSection from './NbestSection.svelte';
  import CandidatesSection from './CandidatesSection.svelte';

  type ViewState =
    | { kind: 'idle' }
    | { kind: 'loading'; text: string }
    | { kind: 'error'; text: string }
    | { kind: 'results'; singlePath: MecabToken[]; nbestPaths: MecabNbestPath[]; candidates: string[] };

  let inputText = $state('');
  let view = $state<ViewState>({ kind: 'idle' });
  let textareaEl: HTMLTextAreaElement | undefined;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let activeRequestId = 0;

  // Autofocus on mount, matching the original morpheme-inspector.js.
  $effect(() => {
    textareaEl?.focus();
  });

  // Cancel any pending timers when the component unmounts. Mostly inert in
  // production (the inspector page lives for the user's session) but prevents
  // the 500 ms NOT_READY retry from firing into a torn-down component in tests.
  $effect(() => () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (retryTimer) clearTimeout(retryTimer);
  });

  function onInput(e: Event) {
    inputText = (e.currentTarget as HTMLTextAreaElement).value;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => analyze(inputText), 200);
  }

  async function analyze(text: string) {
    if (retryTimer) clearTimeout(retryTimer);
    const trimmed = text.trim();
    if (!trimmed) {
      view = { kind: 'idle' };
      return;
    }
    view = { kind: 'loading', text: 'Initializing mecab…' };
    const requestId = ++activeRequestId;
    let response;
    try {
      response = await mecabInspect(trimmed, 5);
    } catch (err) {
      if (requestId !== activeRequestId) return;
      console.warn('[lws] mecab-inspect send failed:', err);
      view = { kind: 'error', text: `Failed to analyze: ${(err as Error).message || err}` };
      return;
    }
    if (requestId !== activeRequestId) return;
    if (!response) {
      console.warn('[lws] mecab-inspect: empty response');
      view = { kind: 'error', text: 'Failed to analyze: no response from background' };
      return;
    }
    if (response.error) {
      if (response.error === 'NOT_READY') {
        // mecab still initializing — try again in 500 ms with the current input.
        retryTimer = setTimeout(() => analyze(inputText), 500);
        return;
      }
      console.warn('[lws] mecab-inspect error:', response.error);
      view = { kind: 'error', text: `Failed to analyze: ${response.error}` };
      return;
    }
    view = {
      kind: 'results',
      singlePath: response.singlePath || [],
      nbestPaths: response.nbestPaths || [],
      candidates: response.candidates || [],
    };
  }
</script>

<main>
  <header>
    <h1>Morpheme inspector</h1>
    <p class="subtitle">Tokenize Korean text and inspect every mecab field</p>
  </header>

  <section class="card">
    <label class="field">
      <span class="label">Input</span>
      <textarea
        bind:this={textareaEl}
        rows="4"
        spellcheck="false"
        placeholder="Paste or type Korean text — analysis updates live."
        value={inputText}
        oninput={onInput}
      ></textarea>
    </label>
  </section>

  {#if view.kind === 'idle'}
    <section class="inspector-section">
      <p class="inspector-placeholder">Enter Korean text to analyze.</p>
    </section>
  {:else if view.kind === 'loading'}
    <section class="inspector-section">
      <p class="inspector-placeholder">{view.text}</p>
    </section>
  {:else if view.kind === 'error'}
    <section class="inspector-section">
      <p class="inspector-error">{view.text}</p>
    </section>
  {:else}
    <SinglePathSection tokens={view.singlePath} />
    <NbestSection paths={view.nbestPaths} />
    <CandidatesSection candidates={view.candidates} />
  {/if}
</main>
