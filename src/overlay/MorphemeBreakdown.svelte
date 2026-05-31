<script lang="ts">
  // Loaded once per module — same module the bridge uses (lookup gives us
  // tokens with surface + pos, and grammar-glosses tells us which are
  // content morphemes worth showing).
  let isContentMorpheme: (m: { form: string; pos: string }) => boolean = () => true;
  let morphemeGloss: (m: { form: string; pos: string }) => { en?: string; ko?: string } | null = () => null;
  let glossesReady = $state(false);
  $effect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = chrome.runtime.getURL('core/grammar-glosses.js');
        const mod = await import(/* @vite-ignore */ url);
        if (cancelled) return;
        isContentMorpheme = mod.isContentMorpheme;
        morphemeGloss = mod.morphemeGloss;
        glossesReady = true;
      } catch (err) {
        console.warn('[lws] MorphemeBreakdown: grammar-glosses load failed', err);
      }
    })();
    return () => { cancelled = true; };
  });

  let { tokens, defLang }: { tokens: any[]; defLang: 'en' | 'ko' } = $props();

  let morphemes = $derived.by(() => {
    if (!glossesReady) return [] as Array<{ form: string; pos: string }>;
    return tokens
      .map((t: any) => ({ form: t.surface, pos: t.pos || '' }))
      .filter((m: { form: string; pos: string }) => m.form && isContentMorpheme(m));
  });

  function glossFor(m: { form: string; pos: string }): string {
    const g = morphemeGloss(m);
    if (!g) return '';
    return defLang === 'ko' ? (g.ko || g.en || '') : (g.en || g.ko || '');
  }

  // Returns null if fewer than 2 content morphemes — the breakdown is
  // skipped (the headword section already shows that info).
  let visible = $derived(morphemes.length >= 2);
</script>

{#if visible}
  <div class="lws-decomp">
    <div class="lws-decomp-stack">
      {#each morphemes as m, i (i)}
        <div class="lws-morph-row">
          {#if i > 0}<span class="lws-morph-op">+</span>{:else}<span class="lws-morph-op lws-morph-op-empty"></span>{/if}
          <div class="lws-morph">
            <span class="lws-morph-form">{m.form}</span>
            <span class="lws-morph-sep">·</span>
            <span class="lws-morph-tag">{m.pos}</span>
            {#if glossFor(m)}
              <span class="lws-morph-gloss">{glossFor(m)}</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  /* Ported from extension/core/popup-shadow.css lines 218-291. */
  .lws-decomp {
    padding: 10px 16px 12px;
    border-bottom: 1px solid var(--border);
  }
  .lws-decomp-stack {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .lws-morph-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .lws-morph-op {
    flex: 0 0 14px;
    text-align: center;
    font-size: 14px;
    font-weight: 500;
    color: var(--muted);
    user-select: none;
    line-height: 1;
  }
  .lws-morph-op-empty {
    visibility: hidden;
  }
  .lws-morph {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 6px;
    padding: 5px 10px;
    border-radius: 8px;
    background: var(--soft);
    border: 1px solid var(--border);
    font-size: 13px;
    line-height: 1.4;
    color: var(--fg);
    flex: 1 1 auto;
    min-width: 0;
  }
  .lws-morph-form {
    font-weight: 500;
  }
  .lws-morph-sep {
    color: var(--muted);
    font-size: 10px;
  }
  .lws-morph-tag {
    font-size: 11px;
    color: var(--chip-cyan-fg);
    letter-spacing: 0.01em;
  }
  .lws-morph-gloss {
    font-size: 12px;
    color: var(--muted);
    margin-left: 2px;
    flex: 1 1 auto;
    min-width: 0;
  }
</style>
