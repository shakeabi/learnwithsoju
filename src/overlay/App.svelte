<script lang="ts">
  import type { OverlayFrame, OverlayApi, OverlayPayload } from '$types/overlay';
  import { materializeGroup, type MaterializedGroup } from './lib/entries';
  import { computePosition, type AnchorRect } from './lib/position';
  import SentenceBand from './SentenceBand.svelte';
  import HeaderStrip from './HeaderStrip.svelte';
  import MorphemeBreakdown from './MorphemeBreakdown.svelte';
  import TabStrip from './TabStrip.svelte';
  import DictionaryTab from './DictionaryTab.svelte';
  import LoadingFrame from './LoadingFrame.svelte';
  import ErrorFrame from './ErrorFrame.svelte';

  let currentFrame = $state<OverlayFrame | null>(null);
  let lookupStatus = $state<string>('Initializing…');

  // Per-payload state. Reset every time a new payload frame arrives so the
  // popup behaves like a fresh hover (no stale tab selection / expand state).
  let activeTab = $state<{ source: 'primary' | 'related'; index: number }>({ source: 'primary', index: 0 });
  let relatedExpanded = $state(false);
  // null = explicitly collapsed; absent = not yet visited (default-expand on
  // first visit applies).
  let expandedSectionByTab = $state<Map<string, number | null>>(new Map());

  // Materialized groups (dedup applied). Lazy-loaded the first time we need
  // to render — materializeGroup is async because it has to dynamic-import
  // extension/core/parsers.js. While loading, the tab body shows nothing.
  let primaryGroups = $state<MaterializedGroup[]>([]);
  let unrelatedGroups = $state<MaterializedGroup[]>([]);

  // Popup positioning — we wait for the popup body to render, measure, then
  // compute and apply transform.
  let popupEl = $state<HTMLDivElement | undefined>();
  let popupTop = $state(0);
  let popupLeft = $state(0);

  // Register window.__lwsOverlay on mount.
  $effect(() => {
    const api: OverlayApi = {
      show(frame: OverlayFrame) {
        currentFrame = frame;
        if (frame.kind === 'loading') {
          lookupStatus = `Looking up ${frame.surface}…`;
        }
        if (frame.kind === 'payload') {
          // Reset per-payload state on a brand-new lookup. The sentence-word
          // click path drives itself by calling .show() with reposition=false
          // — we still reset because the lookup is a fresh one.
          activeTab = { source: 'primary', index: 0 };
          relatedExpanded = false;
          expandedSectionByTab = new Map();
          // Kick async materialization.
          materializeAll(frame.payload);
        }
      },
      hide() {
        currentFrame = null;
        primaryGroups = [];
        unrelatedGroups = [];
      },
      update(patch) {
        if (patch.lookupStatus !== undefined) lookupStatus = patch.lookupStatus;
        // Setting-driven patches: when the user changes a setting in
        // options (or the popup), the bridge forwards the new value so an
        // already-open overlay re-renders against the new settings without
        // requiring a fresh hover/re-fetch. We patch the current payload
        // frame in place (frame reassignment triggers reactivity).
        if (
          patch.defLang !== undefined ||
          patch.secondaryLang !== undefined ||
          patch.askAiProvider !== undefined ||
          patch.askAiPromptTemplate !== undefined ||
          patch.askAiChatGptTemporary !== undefined
        ) {
          if (currentFrame && currentFrame.kind === 'payload') {
            const p = currentFrame.payload;
            currentFrame = {
              kind: 'payload',
              payload: {
                ...p,
                defLang: patch.defLang !== undefined ? patch.defLang : p.defLang,
                secondaryLang: patch.secondaryLang !== undefined ? patch.secondaryLang : p.secondaryLang,
                askAiProvider: patch.askAiProvider !== undefined ? patch.askAiProvider : p.askAiProvider,
                askAiPromptTemplate: patch.askAiPromptTemplate !== undefined ? patch.askAiPromptTemplate : p.askAiPromptTemplate,
                askAiChatGptTemporary: patch.askAiChatGptTemporary !== undefined ? patch.askAiChatGptTemporary : p.askAiChatGptTemporary,
                // Don't reposition on a settings patch — the popup stays
                // anchored where it was opened.
                reposition: false,
              },
            };
          }
        }
      },
    };
    window.__lwsOverlay = api;
    return () => {
      if (window.__lwsOverlay === api) {
        window.__lwsOverlay = undefined;
      }
    };
  });

  async function materializeAll(payload: OverlayPayload) {
    const lookup: any = payload.lookup;
    // background.js (handleLookup) emits `tabs` + `unrelated`. Accept `groups`
    // too as a back-compat shim — the pre-Task-7 type definition mislabelled
    // the field, and some tests + adapters still use the old name. New code
    // should send `tabs`.
    const tabs = Array.isArray(lookup.tabs)
      ? lookup.tabs
      : (Array.isArray(lookup.groups) ? lookup.groups : []);
    const unrelated = Array.isArray(lookup.unrelated) ? lookup.unrelated : [];
    const p: MaterializedGroup[] = [];
    for (const g of tabs) {
      const mg = await materializeGroup(lookup, g);
      if (mg.entries.length > 0) p.push(mg);
    }
    const u: MaterializedGroup[] = [];
    for (const g of unrelated) {
      const mg = await materializeGroup(lookup, g);
      if (mg.entries.length > 0) u.push(mg);
    }
    primaryGroups = p;
    unrelatedGroups = u;
    // Default expand: first entry of the first tab.
    if (p.length > 0) {
      const k = tabKey({ source: 'primary', index: 0 });
      const next = new Map(expandedSectionByTab);
      if (!next.has(k)) next.set(k, 0);
      expandedSectionByTab = next;
    }
  }

  function tabKey(t: { source: 'primary' | 'related'; index: number }): string {
    return `${t.source}:${t.index}`;
  }

  function onPrimaryTabClick(idx: number) {
    activeTab = { source: 'primary', index: idx };
    ensureDefaultExpand();
  }

  function onRelatedTabClick(idx: number) {
    activeTab = { source: 'related', index: idx };
    ensureDefaultExpand();
  }

  function onToggleRelated() {
    relatedExpanded = !relatedExpanded;
    // First reveal does NOT auto-select a related tab; the user must click
    // a specific related word. Re-collapsing doesn't change activeTab.
  }

  function ensureDefaultExpand() {
    const k = tabKey(activeTab);
    if (expandedSectionByTab.has(k)) return;
    const next = new Map(expandedSectionByTab);
    next.set(k, 0);
    expandedSectionByTab = next;
  }

  function onSectionToggle(tabId: string, idx: number) {
    const next = new Map(expandedSectionByTab);
    const open = next.get(tabId);
    if (open === idx) {
      // Clicking the already-open section closes it (no section expanded).
      next.set(tabId, null);
    } else {
      next.set(tabId, idx);
    }
    expandedSectionByTab = next;
  }

  // EN/KR definition-language toggle. Writes the new value to
  // chrome.storage.sync (key: defLang). The bridge picks the change up via
  // storage.onChanged and forwards it as an update({ defLang }) patch — the
  // current-frame patch above re-renders this overlay against the new
  // value. Optimistically patches the current frame too so the toggle
  // feels instant even before the storage roundtrip completes.
  function onSetDefLang(lang: 'en' | 'ko') {
    if (currentFrame?.kind === 'payload' && currentFrame.payload.defLang === lang) return;
    if (currentFrame?.kind === 'payload') {
      const p = currentFrame.payload;
      currentFrame = {
        kind: 'payload',
        payload: { ...p, defLang: lang, reposition: false },
      };
    }
    try {
      chrome.storage.sync.set({ defLang: lang }).catch((err: unknown) => {
        console.warn('[lws] overlay App: defLang storage.set failed', err);
      });
    } catch (err) {
      console.warn('[lws] overlay App: defLang storage.set threw', err);
    }
  }

  // Re-anchor on sentence-word click — we drive a new lookup via the
  // background and feed the response back through ourselves with
  // reposition=false so the popup stays where the user is reading.
  function onSentenceWordClick(s: { before: string; word: string; after: string }) {
    if (currentFrame?.kind !== 'payload') return;
    const prevPayload = currentFrame.payload;
    chrome.runtime.sendMessage({ type: 'lookup', surface: s.word }).then((response: any) => {
      if (!response || response.error) {
        console.warn('[lws] overlay App: sentence-word lookup failed', response);
        return;
      }
      const newPayload: OverlayPayload = {
        ...prevPayload,
        lookup: response,
        sentence: s,
        reposition: false,
      };
      window.__lwsOverlay?.show({ kind: 'payload', payload: newPayload });
    }).catch((err: unknown) => {
      console.warn('[lws] overlay App: sentence-word sendMessage failed', err);
    });
  }

  // Position the popup after the DOM renders. We use requestAnimationFrame
  // so the measured size reflects the current frame's contents.
  $effect(() => {
    if (!currentFrame || !popupEl) return;
    const anchor: AnchorRect | undefined =
      currentFrame.kind === 'payload'
        ? currentFrame.payload.anchor
        : (currentFrame as any).anchor;
    const reposition =
      currentFrame.kind === 'payload'
        ? currentFrame.payload.reposition
        : (currentFrame as any).reposition;
    if (!anchor || !reposition) return;
    const rafId = requestAnimationFrame(() => {
      if (!popupEl) return;
      const rect = popupEl.getBoundingClientRect();
      const pos = computePosition(anchor, { width: rect.width, height: rect.height });
      popupTop = pos.top;
      popupLeft = pos.left;
    });
    return () => cancelAnimationFrame(rafId);
  });

  // Derived: the currently-active materialized group, or null if loading.
  let activeGroup = $derived.by(() => {
    if (activeTab.source === 'primary') return primaryGroups[activeTab.index] || null;
    return unrelatedGroups[activeTab.index] || null;
  });

  // Tab strip data: minimal {word, count} for each materialized group.
  let primaryTabs = $derived(primaryGroups.map((g) => ({ word: g.word, count: g.entries.length })));
  let unrelatedTabs = $derived(unrelatedGroups.map((g) => ({ word: g.word, count: g.entries.length })));

  let expandedIdx = $derived(expandedSectionByTab.get(tabKey(activeTab)) ?? null);
</script>

{#if currentFrame}
  <div
    id="lws-popup"
    role="tooltip"
    bind:this={popupEl}
    style="top: {popupTop}px; left: {popupLeft}px;"
  >
    {#if currentFrame.kind === 'loading'}
      <LoadingFrame surface={currentFrame.surface} status={lookupStatus} />
    {:else if currentFrame.kind === 'error'}
      <ErrorFrame
        message={currentFrame.message}
        details={currentFrame.details}
        action={currentFrame.action}
      />
    {:else if currentFrame.kind === 'payload'}
      {@const payload = currentFrame.payload}
      <HeaderStrip
        surface={(payload.lookup as any).surface || ''}
        lemma={((payload.lookup as any).queryUsed ?? (payload.lookup as any).lemma) || null}
        defLang={payload.defLang}
        onSetDefLang={onSetDefLang}
      />
      {#if payload.sentence}
        <SentenceBand
          sentence={payload.sentence}
          askAi={{
            sentence: payload.sentence,
            secondaryLang: payload.secondaryLang,
            askAiProvider: payload.askAiProvider,
            askAiPromptTemplate: payload.askAiPromptTemplate,
            askAiChatGptTemporary: payload.askAiChatGptTemporary,
          }}
          onSentenceWordClick={onSentenceWordClick}
        />
      {/if}
      {#if Array.isArray((payload.lookup as any).tokens)}
        <MorphemeBreakdown tokens={(payload.lookup as any).tokens} defLang={payload.defLang} />
      {/if}
      <TabStrip
        groups={primaryTabs}
        unrelated={unrelatedTabs}
        activeTab={activeTab}
        relatedExpanded={relatedExpanded}
        onPrimaryTabClick={onPrimaryTabClick}
        onRelatedTabClick={onRelatedTabClick}
        onToggleRelated={onToggleRelated}
      />
      {#if activeGroup}
        <DictionaryTab
          group={activeGroup}
          tabId={tabKey(activeTab)}
          defLang={payload.defLang}
          expandedIdx={expandedIdx}
          onSectionToggle={(idx) => onSectionToggle(tabKey(activeTab), idx)}
        />
      {/if}
    {/if}
  </div>
{/if}
