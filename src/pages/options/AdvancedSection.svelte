<script lang="ts">
  import { settings, setSetting, removeSetting } from '$lib/storage.svelte';
  import { DEFAULT_ASK_AI_PROMPT } from '$lib/askAiPrompt';

  type ProviderEntry = { key: string; name: string };
  let providers = $state<ProviderEntry[]>([]);
  let promptStatus = $state('');
  let promptStatusKind = $state<'' | 'ok' | 'err'>('');
  let promptStatusTimer: ReturnType<typeof setTimeout> | null = null;

  // The morpheme inspector link can't be baked at build time — chrome.runtime.getURL
  // depends on the runtime extension ID.
  let inspectorUrl = $state('#');
  $effect(() => {
    try {
      inspectorUrl = chrome.runtime.getURL('pages/morpheme-inspector/morpheme-inspector.html');
    } catch {
      inspectorUrl = '#';
    }
  });

  // Load the provider list once on mount. Dynamic import via chrome.runtime.getURL
  // — same pattern as the original options.js (loads from extension/core/ai-providers.js).
  $effect(() => {
    (async () => {
      try {
        const url = chrome.runtime.getURL('core/ai-providers.js');
        const mod = await import(/* @vite-ignore */ url);
        const list: ProviderEntry[] = [];
        const dict = mod.AI_PROVIDERS || {};
        for (const [key, def] of Object.entries(dict)) {
          list.push({ key, name: (def as any).name || key });
        }
        providers = list;
        // Force the stored provider to a known one if the current value isn't valid.
        const fallback = mod.DEFAULT_ASK_AI_PROVIDER || list[0]?.key;
        if (fallback && !dict[settings.value.askAiProvider]) {
          await setSetting('askAiProvider', fallback);
        }
      } catch (err) {
        console.warn('[lws] options AdvancedSection: failed to load ai-providers.js', err);
      }
    })();
  });

  function setPromptStatus(text: string, kind: '' | 'ok' | 'err') {
    promptStatus = text;
    promptStatusKind = kind;
    if (promptStatusTimer) clearTimeout(promptStatusTimer);
    if (text && kind) {
      promptStatusTimer = setTimeout(() => {
        if (promptStatus === text) {
          promptStatus = '';
          promptStatusKind = '';
        }
      }, 2500);
    }
  }

  async function onProviderChange(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    await setSetting('askAiProvider', v);
  }

  async function onChatGptTempToggle(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).checked;
    await setSetting('askAiChatGptTemporary', v);
  }

  // On blur (change), persist the prompt. Empty value or value equal to the
  // default → remove the storage key so a future default change re-applies.
  async function onPromptChange(e: Event) {
    const v = (e.currentTarget as HTMLTextAreaElement).value.trim();
    try {
      if (!v || v === DEFAULT_ASK_AI_PROMPT) {
        await removeSetting('askAiPrompt');
        setPromptStatus('Reset to default.', 'ok');
      } else {
        await setSetting('askAiPrompt', v);
        setPromptStatus('Saved.', 'ok');
      }
    } catch (err) {
      console.warn('[lws] options AdvancedSection: prompt save failed', err);
      setPromptStatus(`Save failed: ${(err as Error).message || err}`, 'err');
    }
  }

  async function resetPrompt() {
    await removeSetting('askAiPrompt');
    setPromptStatus('Reset to default.', 'ok');
  }

  // Derived: effective prompt text shown in the textarea — current setting
  // if non-empty, else the default.
  let displayedPrompt = $derived(
    settings.value.askAiPrompt && settings.value.askAiPrompt.length > 0
      ? settings.value.askAiPrompt
      : DEFAULT_ASK_AI_PROMPT
  );

  let isChatGpt = $derived(settings.value.askAiProvider === 'chatgpt');
</script>

<details class="card advanced">
  <summary><h2>Advanced</h2></summary>
  <p class="hint">
    Power-user settings. Defaults are sensible — tweak only if you know what you want.
  </p>

  <label class="field">
    <span class="label">AI service for "Ask AI" pill</span>
    <select value={settings.value.askAiProvider} onchange={onProviderChange}>
      {#each providers as p (p.key)}
        <option value={p.key}>{p.name}</option>
      {/each}
    </select>
    <p class="field-note">
      The pill opens this service in a new tab with the prompt below pre-filled.
    </p>
  </label>

  {#if isChatGpt}
    <label class="checkbox">
      <input type="checkbox" checked={settings.value.askAiChatGptTemporary} onchange={onChatGptTempToggle} />
      <span>Use temporary (ephemeral) ChatGPT chats
        <em class="note">appends <code>?temporary-chat=true</code> — chats aren't saved to history</em>
      </span>
    </label>
  {/if}

  <label class="field">
    <span class="label">"Ask AI" prompt template</span>
    <textarea
      spellcheck="false"
      rows="8"
      placeholder="Click Reset to load the default template."
      value={displayedPrompt}
      onchange={onPromptChange}
    ></textarea>
    <p class="field-note">
      Placeholders (substituted before opening the AI service):
      <code>{'{sentence}'}</code> the sentence with the focus word wrapped in backticks ·
      <code>{'{word}'}</code> just the focus word ·
      <code>{'{language}'}</code> your secondary-language name (e.g. "English").
    </p>
    <div class="actions">
      <button type="button" onclick={resetPrompt}>Reset to default</button>
      <span class="status {promptStatusKind}" aria-live="polite">{promptStatus}</span>
    </div>
  </label>

  <label class="field">
    <span class="label">Morpheme inspector</span>
    <p class="field-note">
      A developer/curious-learner tool. Tokenize Korean text and see every mecab field — POS tags, type, decomposition, n-best paths, and the lemma candidates that feed KRDict.
    </p>
    <a class="field-link" href={inspectorUrl} target="_blank" rel="noopener noreferrer">Open morpheme inspector →</a>
  </label>
</details>
