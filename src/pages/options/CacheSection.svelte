<script lang="ts">
  import { getCounts, clear } from '$lib/cache';
  import type { CacheCounts, ClearCacheTarget } from '$types/messages';

  let counts = $state<CacheCounts | null>(null);
  let statusText = $state('');
  let statusKind = $state<'' | 'ok' | 'err'>('');
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let busy = $state(false);

  const LABELS: Record<'lookup' | 'hanja' | 'all', string> = {
    lookup: 'Clear lookup results',
    hanja: 'Clear Hanja meanings',
    all: 'Clear everything incl. dict',
  };
  const SUCCESS: Record<'lookup' | 'hanja' | 'all', string> = {
    lookup: 'Lookup cache cleared.',
    hanja: 'Hanja cache cleared.',
    all: 'All caches cleared.',
  };

  function setStatus(text: string, kind: '' | 'ok' | 'err' = '') {
    statusText = text;
    statusKind = kind;
    if (statusTimer) clearTimeout(statusTimer);
    if (text && kind === 'ok') {
      statusTimer = setTimeout(() => {
        if (statusText === text) {
          statusText = '';
          statusKind = '';
        }
      }, 3000);
    }
  }

  async function refresh() {
    const c = await getCounts();
    counts = c;
  }

  // Initial load — runs once on mount.
  $effect(() => {
    refresh();
  });

  async function clearTarget(target: ClearCacheTarget) {
    if (busy) return;
    busy = true;
    setStatus('Clearing…', '');
    try {
      const res = await clear(target);
      const label = target === 'dict' ? 'all' : target;
      if (res.ok) {
        setStatus(SUCCESS[label as 'lookup' | 'hanja' | 'all'], 'ok');
      } else {
        setStatus(`Error: ${res.error || 'unknown'}`, 'err');
      }
    } finally {
      busy = false;
      await refresh();
    }
  }

  // Label includes the live count when known.
  let lookupLabel = $derived(
    counts && counts.lookup != null
      ? `${LABELS.lookup} (~${counts.lookup})`
      : LABELS.lookup
  );
  let hanjaLabel = $derived(
    counts && counts.hanja != null
      ? `${LABELS.hanja} (~${counts.hanja})`
      : LABELS.hanja
  );
  let allLabel = $derived(
    counts
      ? `${LABELS.all} (~${(counts.lookup ?? 0) + (counts.hanja ?? 0) + (counts.krdict ?? 0) + (counts.opendict ?? 0)})`
      : LABELS.all
  );
</script>

<section class="card">
  <h2>Cache</h2>
  <p class="hint">
    Lookup results store the full tokenized+grouped output per hovered surface
    form. Dict XMLs are raw API responses (expensive to refetch). Hanja meanings
    are pulled from hangulhanja.com.
  </p>
  <div class="cache-buttons">
    <button type="button" disabled={busy} onclick={() => clearTarget('lookup')}>{lookupLabel}</button>
    <button type="button" disabled={busy} onclick={() => clearTarget('hanja')}>{hanjaLabel}</button>
    <details class="cache-everything-details">
      <summary>More options</summary>
      <button type="button" disabled={busy} onclick={() => clearTarget('all')}>{allLabel}</button>
    </details>
  </div>
  <span class="status {statusKind}" aria-live="polite">{statusText}</span>
</section>
