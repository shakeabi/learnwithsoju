<script lang="ts">
  import type { SentenceContext } from '$types/overlay';
  import { sentenceFromWordClick } from './lib/sentence';
  import { buildAskAiUrl, type AskAiOpts } from './lib/askAiUrl';

  let {
    sentence,
    askAi,
    onSentenceWordClick,
  }: {
    sentence: SentenceContext;
    askAi: AskAiOpts;
    onSentenceWordClick: (s: SentenceContext) => void;
  } = $props();

  // Chunk the before/after halves into clickable Korean words + plain runs.
  type Piece =
    | { kind: 'text'; text: string }
    | { kind: 'word'; text: string; offset: number };

  function chunk(text: string, baseOffset: number): Piece[] {
    const out: Piece[] = [];
    if (!text) return out;
    const chunkRe = /\S+/g;
    let lastEnd = 0;
    let m: RegExpExecArray | null;
    while ((m = chunkRe.exec(text)) !== null) {
      if (m.index > lastEnd) out.push({ kind: 'text', text: text.slice(lastEnd, m.index) });
      const piece = m[0];
      const start = piece.search(/[가-힣ᄀ-ᇿ㄰-㆏]/);
      if (start < 0) {
        out.push({ kind: 'text', text: piece });
      } else {
        let end = piece.length;
        while (end > start && !/[가-힣ᄀ-ᇿ㄰-㆏]/.test(piece.charAt(end - 1))) end--;
        if (start > 0) out.push({ kind: 'text', text: piece.slice(0, start) });
        const surface = piece.slice(start, end);
        const surfaceOffset = baseOffset + m.index + start;
        out.push({ kind: 'word', text: surface, offset: surfaceOffset });
        if (end < piece.length) out.push({ kind: 'text', text: piece.slice(end) });
      }
      lastEnd = m.index + piece.length;
    }
    if (lastEnd < text.length) out.push({ kind: 'text', text: text.slice(lastEnd) });
    return out;
  }

  let fullText = $derived(sentence.before + sentence.word + sentence.after);
  let beforePieces = $derived(chunk(sentence.before, 0));
  let afterPieces = $derived(chunk(sentence.after, sentence.before.length + sentence.word.length));

  let askAiHref = $state('#');
  $effect(() => {
    // Re-resolve href whenever the askAi opts (or sentence) change.
    const snapshot: AskAiOpts = {
      sentence: askAi.sentence,
      secondaryLang: askAi.secondaryLang,
      askAiProvider: askAi.askAiProvider,
      askAiPromptTemplate: askAi.askAiPromptTemplate,
      askAiChatGptTemporary: askAi.askAiChatGptTemporary,
    };
    let cancelled = false;
    buildAskAiUrl(snapshot).then((url) => {
      if (!cancelled) askAiHref = url;
    }).catch((err) => {
      console.warn('[lws] SentenceBand: buildAskAiUrl failed', err);
    });
    return () => { cancelled = true; };
  });

  function onWordClick(piece: Extract<Piece, { kind: 'word' }>, e: Event) {
    e.stopPropagation();
    e.preventDefault();
    onSentenceWordClick(sentenceFromWordClick(fullText, piece.text, piece.offset));
  }

  function onWordKey(piece: Extract<Piece, { kind: 'word' }>, e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') onWordClick(piece, e);
  }
</script>

<div class="lws-sentence">
  <div class="lws-sentence-header">
    <span class="lws-sentence-label">Given sentence</span>
    <a class="lws-ai-pill" href={askAiHref} target="_blank" rel="noopener noreferrer" title="Open in AI service">
      <span class="lws-ai-pill-icon">★</span>
      Ask AI
    </a>
  </div>
  <div class="lws-sentence-text">
    {#each beforePieces as p, i (i)}
      {#if p.kind === 'text'}{p.text}{:else}<span
        class="lws-sentence-word"
        role="button"
        tabindex="0"
        title={`Look up ${p.text}`}
        onclick={(e) => onWordClick(p, e)}
        onkeydown={(e) => onWordKey(p, e)}
      >{p.text}</span>{/if}
    {/each}<span class="lws-sentence-hit">{sentence.word}</span>{#each afterPieces as p, i (i)}{#if p.kind === 'text'}{p.text}{:else}<span
      class="lws-sentence-word"
      role="button"
      tabindex="0"
      title={`Look up ${p.text}`}
      onclick={(e) => onWordClick(p, e)}
      onkeydown={(e) => onWordKey(p, e)}
    >{p.text}</span>{/if}{/each}
  </div>
</div>

<style>
  /* Ported from extension/core/popup-shadow.css lines 94-174 (sentence band block). */
  .lws-sentence {
    padding: 12px 16px 10px;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
    line-height: 1.5;
  }
  .lws-sentence-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
  }
  .lws-sentence-label {
    display: block;
    font-size: 11px;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  /* Violet-pink gradient pill; matches the original popup-shadow.css's
     lws-ai-pill styling so the Ask AI affordance is recognisably distinct
     from the amber/cyan chips. */
  .lws-ai-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 2px 9px;
    border-radius: 999px;
    white-space: nowrap;
    color: #fff;
    text-decoration: none;
    background: linear-gradient(135deg, #a78bfa 0%, #ec4899 100%);
    cursor: pointer;
    transition: filter 0.12s ease, transform 0.12s ease;
  }
  .lws-ai-pill:hover {
    filter: brightness(1.08);
    transform: translateY(-1px);
  }
  .lws-ai-pill-icon {
    font-size: 11px;
    line-height: 1;
  }
  .lws-sentence-text {
    color: var(--fg);
    word-break: break-word;
  }
  .lws-sentence-hit {
    background: var(--highlight-bg);
    color: var(--highlight-fg);
    padding: 1px 4px;
    border-radius: 4px;
    font-weight: 500;
  }
  .lws-sentence-word {
    cursor: pointer;
    border-radius: 3px;
    border-bottom: 1px dashed rgba(120, 140, 200, 0.35);
    transition: background-color 0.12s ease, border-bottom-color 0.12s ease;
  }
  .lws-sentence-word:hover,
  .lws-sentence-word:focus-visible {
    background: var(--soft);
    border-bottom-color: rgba(120, 140, 200, 0.9);
    outline: none;
  }
</style>
