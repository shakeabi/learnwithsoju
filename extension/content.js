(async () => {
  const HANGUL_RE = /[가-힣ᄀ-ᇿ㄰-㆏]+/g;
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'NOSCRIPT', 'IFRAME', 'CANVAS', 'SVG']);
  const POPUP_ID = 'lws-popup';
  const HOST_CLASS = 'lws-host';
  const WORD_CLASS = 'lws-word';
  const GAP_CLASS = 'lws-gap';
  const HIDE_DELAY_MS = 120;
  const HOVER_DELAY_MS = 60;
  const LOOKUP_STATUS_DELAY_MS = 50;

  const LOOKUP_STAGE_LABELS = {
    init: 'Initializing…',
    morpheme: 'Analyzing morphemes…',
    cache: 'Checking cache…',
    krdict: 'Querying KRDict…',
    opendict: 'Falling back to OpenDict…',
    render: 'Rendering…',
  };
  const SENTENCE_MAX_BEFORE = 80;
  const SENTENCE_MAX_AFTER = 80;
  const SENTENCE_BLOCK_TAGS = new Set([
    'P', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'FIGCAPTION', 'ARTICLE', 'SECTION',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DT', 'DD', 'CAPTION', 'SUMMARY',
  ]);
  const STORAGE_KEYS = {
    DEF_LANG: 'defLang',
    SECONDARY_LANG: 'secondaryLang',
    ASK_AI_PROMPT: 'askAiPrompt',
    ASK_AI_PROVIDER: 'askAiProvider',
    ASK_AI_CHATGPT_TEMPORARY: 'askAiChatGptTemporary',
  };
  // Per-site disable list lives in chrome.storage.local (see popup.js for
  // rationale — sync was dropping per-site writes).
  const DISABLED_HOSTS_KEY = 'disabledHosts';
  // Default Ask-AI prompt template. Kept in sync with options.js
  // (DEFAULT_ASK_AI_PROMPT) — if you change one, change the other.
  // Placeholders: {sentence}, {word}, {language}.
  const DEFAULT_ASK_AI_PROMPT = `You are a Korean language expert helping a {language} learner. The focus word is \`{word}\` (in backticks). The sentence is "{sentence}".

Reply in {language} using this structure. Skip a section only if it genuinely doesn't apply — never add sections, preamble, or closing remarks. Keep early sections tight; the deep dive comes at the end.

**Quick Summary**
- **Meaning here:** one short {language} sentence — what \`{word}\` means *in this specific sentence*
- **Dictionary lemma:** the base form if it differs from the surface
- **POS:** part of speech (noun, verb, adjective, particle, adverb, etc.); for verbs/adjectives include inflectional class if it matters (regular / ㅂ-irregular / ㄷ-irregular / 르-irregular / 으-stem / etc.)
- **Frequency:** Very common / Common / Uncommon / Rare — plus rough TOPIK level if you can place it
- **Register:** formal speech / polite / casual / honorific-only / written-only / slang / textbook-only — whichever applies (multiple if relevant)

**Translation**
One natural {language} sentence translation of the full input sentence.

**Breakdown**
Markdown table. Columns: Korean | Lemma | POS | Meaning. One row per surface word, left to right.

**About \`{word}\`**
- **Common usages:** 2–3 typical contexts or collocations the word appears in, each with a Korean example and one-line {language} gloss
- **Similar words:** 2–3 synonyms a native would actually use in place of \`{word}\`, with the nuance difference for each (don't just list — explain when each is preferred)
- **More natural alternatives:** if \`{word}\` is awkward, textbook-stiff, or overly formal/casual for this sentence, suggest what a native speaker would more naturally say here. If \`{word}\` is already natural, say so in one line and skip this.
- **Common forms:** for verbs/adjectives only — list the most-used conjugated forms (past, present polite, present formal, attributive (관형사형), and one or two key connectives like -아/어서 or -(으)면) with a Korean example and short gloss for each. For nouns and particles, skip this.

**Grammar of \`{word}\`** (including patterns that extend into the next word or two)
Focus on \`{word}\` first, then expand outward — Korean grammar patterns frequently span more than one word: auxiliary verb constructions (\`-아/어 보다\`, \`-아/어 주다\`, \`-고 있다\`, \`-아/어 버리다\`, \`-아/어 놓다\`), dependent-noun constructions (\`-(으)ㄴ 적이 있다\`, \`-기 때문에\`, \`-(으)ㄹ 때\`, \`-(으)ㄹ 수 있다\`), connective + auxiliary chains, and serial-verb combinations. If \`{word}\` is the stem-end of one of these, the pattern still belongs to \`{word}\` and must be explained here even though it physically continues into the next word(s). Don't treat the trailing auxiliary/dependent-noun as someone else's problem.

Cover every grammatical feature touching the focus word: morphological decomposition (stem + each suffix/auxiliary in order), tense/aspect/mood, speech level, attached particles, and every grammar pattern that starts at, terminates at, or spans \`{word}\`. For each pattern, use a sub-heading and include:
  - Pattern in code-ticks (e.g. \`-아/어 보다\`) and its literal meaning
  - The actual surface text in *this* sentence that realizes the pattern (e.g. \`가 봤어요\`) — quote it directly so the user sees where the pattern lives
  - Nuance / when a native uses it
  - One short example sentence in a different context, with its translation
  - Register or common collocations if notable

Order patterns from outermost (whole-clause level / spans multiple words) to innermost (closest to the stem). Don't skip the "obvious" ones — be thorough.

No greeting, no "let me know if...", no recap. Be ready for follow-up questions.`;
  const DEF_LANG_DEFAULT = 'en';
  const SECONDARY_LANG_DEFAULT = 'en';
  // Code → human-readable name for the prompt sent to ChatGPT. Mirrors
  // the dropdown in options.html; unknown codes fall back to the code
  // itself so the prompt still parses sensibly.
  const SECONDARY_LANG_NAMES = {
    en: 'English',
    ja: 'Japanese',
    zh: 'Chinese (Simplified)',
    'zh-TW': 'Chinese (Traditional)',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    it: 'Italian',
    pt: 'Portuguese',
    ru: 'Russian',
    ar: 'Arabic',
    hi: 'Hindi',
    id: 'Indonesian',
    vi: 'Vietnamese',
    th: 'Thai',
    tr: 'Turkish',
    nl: 'Dutch',
    pl: 'Polish',
  };

  const parsers = await import(chrome.runtime.getURL('core/parsers.js'));
  const {
    parseKrdictXml,
    parseOpendictXml,
    filterTranslations,
    gradeToStars,
    gradeToTooltip,
    posToEnglish,
    posToShortform,
    isHanjaChar,
    hanjaCharUrl,
    koreanVerbUrl,
    posExplanation,
  } = parsers;

  const glosses = await import(chrome.runtime.getURL('core/grammar-glosses.js'));
  const { morphemeGloss, isContentMorpheme } = glosses;

  const sites = await import(chrome.runtime.getURL('core/site-configs.js'));
  const { findSiteConfig } = sites;

  const aiProvidersMod = await import(chrome.runtime.getURL('core/ai-providers.js'));
  const { AI_PROVIDERS, DEFAULT_ASK_AI_PROVIDER } = aiProvidersMod;
  // Resolved once per content-script lifetime — frames don't navigate between
  // sites without a reload, which re-injects content.js.
  const currentHost = (window.location && window.location.hostname || '').toLowerCase();
  const siteConfig = findSiteConfig(currentHost);

  // Inject per-site CSS as early as we can — before the first paint
  // ideally, so any z-index / pointer-events fixes are in effect by
  // the time the user's mouse first touches a hoverable caption.
  // Idempotence guard via the data attribute so a content-script
  // reinjection doesn't double-add.
  if (siteConfig && typeof siteConfig.stylesheet === 'string' && siteConfig.stylesheet.trim()) {
    const TAG_ID = 'lws-site-style';
    if (!document.getElementById(TAG_ID)) {
      const style = document.createElement('style');
      style.id = TAG_ID;
      style.dataset.lwsSite = siteConfig.name || currentHost;
      style.textContent = siteConfig.stylesheet;
      (document.head || document.documentElement).appendChild(style);
    }
  }

  // Popup → content fallback for hostname lookup. Some Chrome states
  // return tab.url === undefined from chrome.tabs.query even with the
  // activeTab permission; the popup then has no way to identify the
  // current site. The content script always knows its own location, so
  // this handler bypasses that whole class of failures.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'lws-site-info') {
      sendResponse({
        host: currentHost,
        protocol: window.location.protocol,
        href: window.location.href,
      });
      return false;
    }
    return undefined;
  });

  let hostDisabled = false;
  let enabled = true;
  let defLang = DEF_LANG_DEFAULT;
  // Cached at init + kept current via storage.onChanged. Read by the
  // "Ask AI" pill on every sentence render — fetching from storage each
  // time would force buildSentenceNode to become async.
  let secondaryLang = SECONDARY_LANG_DEFAULT;
  let askAiPromptTemplate = DEFAULT_ASK_AI_PROMPT;
  let askAiProvider = DEFAULT_ASK_AI_PROVIDER;
  let askAiChatGptTemporary = false;
  let popupHost = null;
  let popupRoot = null;
  let activeWordEl = null;
  let lastPayload = null;
  let lastSentence = null;
  let hideTimer = null;
  let hoverTimer = null;
  let pendingRequestId = 0;
  let popupPinned = false;
  let popupPinnedSafetyTimer = null;
  // Video auto-pause/resume state. `pausedVideo` holds the element we
  // paused; `resumeOnHide` is the consent flag (cleared if the user
  // manually pauses again after our auto-pause); `suppressNextPause` lets
  // our own .pause() call's event slip past the listener without flipping
  // the flag.
  let pausedVideo = null;
  let resumeVideoOnHide = false;
  let suppressNextPauseEvent = false;
  let videoPauseListener = null;

  function isSkippableNode(node) {
    let p = node.parentNode;
    while (p && p.nodeType === 1) {
      if (SKIP_TAGS.has(p.tagName)) return true;
      if (p.isContentEditable) return true;
      if (p.classList && p.classList.contains(WORD_CLASS)) return true;
      p = p.parentNode;
    }
    return false;
  }

  function wrapTextNode(textNode) {
    const text = textNode.nodeValue;
    if (!text || !HANGUL_RE.test(text)) {
      HANGUL_RE.lastIndex = 0;
      return;
    }
    HANGUL_RE.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    while ((match = HANGUL_RE.exec(text)) !== null) {
      if (match.index > lastIndex) {
        const gap = document.createElement('span');
        gap.className = GAP_CLASS;
        gap.textContent = text.slice(lastIndex, match.index);
        frag.appendChild(gap);
      }
      const span = document.createElement('span');
      span.className = WORD_CLASS;
      span.dataset.surface = match[0];
      span.textContent = match[0];
      frag.appendChild(span);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      const gap = document.createElement('span');
      gap.className = GAP_CLASS;
      gap.textContent = text.slice(lastIndex);
      frag.appendChild(gap);
    }
    textNode.parentNode.replaceChild(frag, textNode);
  }

  function collectTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        if (isSkippableNode(node)) return NodeFilter.FILTER_REJECT;
        return HANGUL_RE.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    HANGUL_RE.lastIndex = 0;
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    HANGUL_RE.lastIndex = 0;
    return nodes;
  }

  function processInChunks(nodes, chunkSize = 80) {
    let i = 0;
    function step() {
      if (!enabled) return;
      const end = Math.min(i + chunkSize, nodes.length);
      for (; i < end; i++) {
        try { wrapTextNode(nodes[i]); } catch {}
      }
      if (i < nodes.length) {
        if ('requestIdleCallback' in window) requestIdleCallback(step, { timeout: 200 });
        else setTimeout(step, 0);
      }
    }
    step();
  }

  function scanRoot(root) {
    if (!enabled) return;
    const nodes = collectTextNodes(root);
    if (nodes.length) processInChunks(nodes);
  }

  // Undo every wrapTextNode() — replace each .lws-word span with a text
  // node containing its text content. Called when the user disables the
  // extension on this host so the dashed underline / cursor-help styling
  // goes away too, not just the popup. Re-enabling re-runs scanRoot which
  // re-wraps. The mutation observer's processInChunks is gated on
  // `enabled`, so the replacement DOM activity during unwrap doesn't
  // re-wrap anything.
  function unwrapAllWords() {
    const selector = 'span.' + WORD_CLASS + ', span.' + GAP_CLASS;
    const spans = document.querySelectorAll(selector);
    for (const span of spans) {
      const parent = span.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(span.textContent), span);
    }
  }

  // Resolve to a Promise that fulfils once the overlay bundle has loaded
  // and registered `window.__lwsOverlay`. Idempotent — repeated calls
  // share the same promise. We import via dynamic import using the
  // chrome.runtime.getURL() of the overlay bundle so the script runs in
  // the same isolated content-script realm as content.js itself — that
  // way `window.__lwsOverlay` is reachable from here (chrome content
  // scripts run in their own isolated world per extension id, shared by
  // both content.js and any WAR loaded via dynamic import from it).
  let overlayLoadPromise = null;
  function loadOverlayBundle() {
    if (overlayLoadPromise) return overlayLoadPromise;
    overlayLoadPromise = (async () => {
      try {
        const url = chrome.runtime.getURL('overlay/main.js');
        await import(url);
      } catch (err) {
        console.warn('[lws] content: overlay bundle load failed:', err);
        overlayLoadPromise = null;
        throw err;
      }
      // Wait one microtask so the bundle's top-level code (which calls
      // mount() and registers window.__lwsOverlay) has finished.
      await Promise.resolve();
      if (!window.__lwsOverlay) {
        throw new Error('overlay bundle loaded but window.__lwsOverlay missing');
      }
    })();
    return overlayLoadPromise;
  }

  function ensurePopup() {
    if (popupHost) return popupHost;
    popupHost = document.createElement('div');
    popupHost.className = HOST_CLASS;
    popupHost.style.all = 'initial';
    // Anchored at the document origin (not the viewport) so the popup
    // scrolls with the page. The overlay component positions itself
    // absolutely inside the shadow root using anchor rects in document
    // coordinates (passed in via OverlayPayload.anchor).
    popupHost.style.position = 'absolute';
    popupHost.style.top = '0';
    popupHost.style.left = '0';
    popupHost.style.zIndex = '2147483647';
    popupHost.style.pointerEvents = 'none';
    popupRoot = popupHost.attachShadow({ mode: 'open' });
    // Inject the overlay's compiled CSS into the shadow root. Vite emits
    // it at extension/overlay/main.css; without this link the overlay
    // styling is invisible (shadow roots don't inherit the host page's
    // stylesheets, and the overlay bundle's CSS would otherwise live in
    // the page DOM, not in the shadow root).
    const overlayStyle = document.createElement('link');
    overlayStyle.rel = 'stylesheet';
    overlayStyle.href = chrome.runtime.getURL('overlay/main.css');
    popupRoot.appendChild(overlayStyle);
    const mountPoint = document.createElement('div');
    mountPoint.id = 'lws-overlay-root';
    popupRoot.appendChild(mountPoint);
    document.documentElement.appendChild(popupHost);
    // Mouse enter/leave on the host (the overlay component will route
    // its own internal events; we still need the host-level handlers
    // for the hide-on-leave timer that the bridge owns).
    popupHost.addEventListener('mouseenter', () => {
      cancelHide();
      unpinPopup();
    });
    popupHost.addEventListener('mouseleave', scheduleHide);
    return popupHost;
  }

  function cancelHide() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function scheduleHide() {
    cancelHide();
    if (popupPinned) return;
    hideTimer = setTimeout(hidePopup, HIDE_DELAY_MS);
  }

  function pinPopup() {
    popupPinned = true;
    cancelHide();
    if (popupPinnedSafetyTimer) clearTimeout(popupPinnedSafetyTimer);
    // Safety: even if the user never re-engages the popup with their
    // cursor, drop the pin after 3 seconds so the next legitimate
    // mouseleave can hide the popup normally.
    popupPinnedSafetyTimer = setTimeout(() => {
      popupPinned = false;
      popupPinnedSafetyTimer = null;
    }, 3000);
  }

  function unpinPopup() {
    popupPinned = false;
    if (popupPinnedSafetyTimer) {
      clearTimeout(popupPinnedSafetyTimer);
      popupPinnedSafetyTimer = null;
    }
  }

  // Site adapters (site-configs.js) can expose a findVideo() that returns
  // the page's main video element. When present, the popup pauses it on
  // open and resumes on close — but only when *we* were the ones to pause
  // it. If the user pauses the video again after our auto-pause (signal
  // that they want it stopped), we suppress the auto-resume.
  function pauseVideoIfApplicable(anchor) {
    if (pausedVideo) return; // already handled this popup session
    const finder = siteConfig && siteConfig.findVideo;
    if (typeof finder !== 'function') return;
    // Only auto-pause when the hovered word is inside a caption container
    // (the same selector that lets the sentence-extractor recognize caption
    // text vs. surrounding prose). Hovering a comment, title, or video
    // description must not interrupt playback. If no sentenceContainer is
    // configured, fall through to the old behavior so non-video sites with
    // findVideo defined (none today) aren't silently broken.
    const container = siteConfig && siteConfig.sentenceContainer;
    if (container && anchor && typeof anchor.closest === 'function') {
      if (!anchor.closest(container)) return;
    }
    let v;
    try { v = finder(); } catch { return; }
    if (!v || v.paused) return;
    suppressNextPauseEvent = true;
    try { v.pause(); } catch { return; }
    pausedVideo = v;
    resumeVideoOnHide = true;
    videoPauseListener = () => {
      // Our own pause() emits a 'pause' event — swallow exactly one.
      if (suppressNextPauseEvent) {
        suppressNextPauseEvent = false;
        return;
      }
      // Any subsequent pause is the user; don't auto-resume.
      resumeVideoOnHide = false;
    };
    v.addEventListener('pause', videoPauseListener);
  }

  function resumeVideoIfApplicable() {
    if (pausedVideo && videoPauseListener) {
      pausedVideo.removeEventListener('pause', videoPauseListener);
    }
    if (resumeVideoOnHide && pausedVideo && pausedVideo.paused) {
      const r = pausedVideo.play();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    }
    pausedVideo = null;
    videoPauseListener = null;
    resumeVideoOnHide = false;
    suppressNextPauseEvent = false;
  }

  function hidePopup() {
    unpinPopup();
    clearLookupStatusTimers();
    if (window.__lwsOverlay && typeof window.__lwsOverlay.hide === 'function') {
      try { window.__lwsOverlay.hide(); } catch (err) {
        console.warn('[lws] content: overlay.hide failed', err);
      }
    }
    resumeVideoIfApplicable();
    activeWordEl = null;
    lastSentence = null;
    pendingRequestId++;
    popupPinned = false;
    if (popupPinnedSafetyTimer) {
      clearTimeout(popupPinnedSafetyTimer);
      popupPinnedSafetyTimer = null;
    }
  }

  /** @deprecated unused — kept for reference; will be removed in a later pass.
   *  The overlay component owns positioning in Task 7 onward. */
  function positionPopup(target) {
    // Compute everything in viewport coords first — that's what the
    // initial-fit clamps (flip above, clip to viewport edge) want, since
    // we're trying to keep the popup visible at the moment of show.
    const rect = target.getBoundingClientRect();
    const margin = 8;
    let top = rect.bottom + margin;
    let left = rect.left;
    if (top < margin) top = margin;
    if (left < margin) left = margin;
    return { top: top + window.scrollY, left: left + window.scrollX };
  }

  function computeAnchorRect(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') {
      return { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 };
    }
    const r = el.getBoundingClientRect();
    // Convert from viewport-relative to document-relative coords by adding
    // scrollX/scrollY. The overlay positions itself in document coords
    // (the shadow host is at top: 0; left: 0 of the document).
    const sx = window.scrollX || window.pageXOffset || 0;
    const sy = window.scrollY || window.pageYOffset || 0;
    return {
      top: r.top + sy,
      left: r.left + sx,
      bottom: r.bottom + sy,
      right: r.right + sx,
      width: r.width,
      height: r.height,
    };
  }

  // showPopup is now a thin proxy that ensures the shadow host exists,
  // loads the overlay bundle if needed, and forwards the frame to
  // window.__lwsOverlay.show. The frame describes what to render
  // (loading / error / payload); the overlay component owns all DOM.
  async function showPopup(frame) {
    ensurePopup();
    try {
      await loadOverlayBundle();
    } catch (err) {
      // If the bundle won't load, log and bail — the user sees nothing,
      // which is better than a broken popup.
      console.warn('[lws] content: showPopup aborted, overlay unavailable', err);
      return;
    }
    if (!window.__lwsOverlay) {
      console.warn('[lws] content: window.__lwsOverlay missing after bundle load');
      return;
    }
    window.__lwsOverlay.show(frame);
    // Pause the video on the first show of a session (matches existing
    // behaviour). pauseVideoIfApplicable is idempotent. The anchor element
    // is no longer reachable from the frame (it carries a rect, not a DOM
    // node), so the container check inside pauseVideoIfApplicable falls
    // through — the original behaviour relied on .closest() on the anchor.
    // This is a known trade-off in Task 6; revisit in Task 7 if needed.
    pauseVideoIfApplicable(null);
  }

  let lookupStatusTimers = [];
  function clearLookupStatusTimers() {
    for (const t of lookupStatusTimers) clearTimeout(t);
    lookupStatusTimers = [];
  }
  function setLookupStatus(key) {
    const label = LOOKUP_STAGE_LABELS[key];
    if (!label) {
      console.warn('[lws] setLookupStatus: unknown stage key', key);
    }
    if (window.__lwsOverlay && typeof window.__lwsOverlay.update === 'function') {
      try {
        window.__lwsOverlay.update({ lookupStatus: label || 'Looking up…' });
      } catch (err) {
        console.warn('[lws] setLookupStatus: overlay.update failed', err);
      }
    }
  }
  function scheduleLookupStatusSequence() {
    clearLookupStatusTimers();
    lookupStatusTimers.push(setTimeout(() => setLookupStatus('cache'), LOOKUP_STATUS_DELAY_MS));
    lookupStatusTimers.push(setTimeout(() => setLookupStatus('morpheme'), LOOKUP_STATUS_DELAY_MS + 150));
    lookupStatusTimers.push(setTimeout(() => setLookupStatus('krdict'), LOOKUP_STATUS_DELAY_MS + 450));
  }

  function extractSentence(wordEl) {
    // Hard ceiling: if the word lives inside a `.lws-sentence-root` element
    // (e.g. the notepad target div), never walk above it. This prevents
    // sibling instruction text in the same section from leaking into the
    // sentence context.
    const sentenceRoot = wordEl.closest('.lws-sentence-root');

    // Per-site override (see site-configs.js): sites that render text as
    // many flat sibling spans (YouTube subtitles, etc.) need a specific
    // ancestor selector — the default walk-up hits the body before finding
    // a useful block. If the hovered word isn't inside the configured
    // container (e.g. the user hovered a video-description word on
    // YouTube), `closest()` returns null and we fall through to the
    // default walk so non-caption text on the same page still works.
    let block = null;
    if (sentenceRoot) {
      block = sentenceRoot;
    } else if (siteConfig && siteConfig.sentenceContainer) {
      block = wordEl.closest(siteConfig.sentenceContainer);
    }
    if (!block) {
      block = wordEl.parentElement;
      while (block && !SENTENCE_BLOCK_TAGS.has(block.tagName)) {
        const next = block.parentElement;
        if (!next || next === document.body || next === document.documentElement) {
          // Fall back to a div with a reasonable amount of text, but never the body itself.
          if (block.tagName === 'DIV' && block !== document.body) break;
          return null;
        }
        block = next;
      }
    }
    if (!block) return null;

    const raw = block.textContent || '';
    const text = raw.replace(/\s+/g, ' ').trim();
    if (text.length < 3 || text.length > 800) return null;

    const surface = wordEl.dataset.surface;
    if (!surface) return null;
    const idx = text.indexOf(surface);
    if (idx < 0) return null;

    let before = text.slice(0, idx);
    let after = text.slice(idx + surface.length);
    if (before.length > SENTENCE_MAX_BEFORE) {
      before = '… ' + before.slice(before.length - SENTENCE_MAX_BEFORE);
    }
    if (after.length > SENTENCE_MAX_AFTER) {
      after = after.slice(0, SENTENCE_MAX_AFTER) + ' …';
    }
    return { before, word: surface, after };
  }

  // Map the user's secondaryLang code to a human-readable name for the
  // ChatGPT prompt. Falls back to the code itself when the code isn't in
  // our table (e.g. the user picked "off"), which still produces a
  // grammatical English sentence ("i'm a off student learning korean" is
  // not great, but it doesn't break the URL).
  function secondaryLangName(code) {
    if (!code) return SECONDARY_LANG_NAMES[SECONDARY_LANG_DEFAULT];
    return SECONDARY_LANG_NAMES[code] || code;
  }

  function currentProvider() {
    // Defend against the storage value not matching a registered
    // provider (e.g. user-edited storage, or we removed a provider in
    // a later release).
    return AI_PROVIDERS[askAiProvider] || AI_PROVIDERS[DEFAULT_ASK_AI_PROVIDER];
  }

  function buildAskAiUrl(sentence) {
    const langName = secondaryLangName(secondaryLang);
    const sentenceWithMark = `${sentence.before}\`${sentence.word}\`${sentence.after}`;
    // Use split/join (not replace) so user templates containing literal
    // $1/$&/$' aren't mangled by replacement-pattern interpolation.
    const prompt = (askAiPromptTemplate || DEFAULT_ASK_AI_PROMPT)
      .split('{sentence}').join(sentenceWithMark)
      .split('{word}').join(sentence.word)
      .split('{language}').join(langName);
    const base = `${currentProvider().urlPrefix}${encodeURIComponent(prompt)}`;
    if (askAiProvider === 'chatgpt' && askAiChatGptTemporary) {
      try {
        const u = new URL(base);
        u.searchParams.set('temporary-chat', 'true');
        return u.toString();
      } catch (err) {
        console.warn('[lws] buildAskAiUrl: could not append temporary-chat param', err);
        return base;
      }
    }
    return base;
  }

  async function performLookup(target, opts = {}) {
    // Two entry points share this:
    //   (a) page hover/click: target = the .lws-word in the DOM. We extract
    //       the sentence from the surrounding DOM and reposition the popup
    //       at the new word.
    //   (b) sentence-word click inside the popup: target = null,
    //       opts.surface = the clicked 어절, opts.sentence = the rebuilt
    //       sentence with that 어절 as the hit. Popup stays at its current
    //       position so the user's reading flow isn't disrupted.
    const surface = opts.surface != null
      ? opts.surface
      : (target && target.dataset.surface);
    if (!surface) return;
    const anchor = target || activeWordEl;
    if (!anchor) return;
    const reposition = Boolean(target);
    const requestId = ++pendingRequestId;
    // Compute the anchor rect in document coordinates so the overlay
    // can position itself without seeing the original DOM element.
    const anchorRect = computeAnchorRect(anchor);

    await showPopup({
      kind: 'loading',
      surface,
      anchor: anchorRect,
      reposition,
    });
    scheduleLookupStatusSequence();

    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: 'lookup', surface });
    } catch (err) {
      clearLookupStatusTimers();
      if (requestId !== pendingRequestId) return;
      await showPopup({
        kind: 'error',
        message: 'Extension is reloading. Hover again in a moment.',
        anchor: anchorRect,
        reposition,
      });
      return;
    }
    clearLookupStatusTimers();
    if (requestId !== pendingRequestId) return;
    if (!response) {
      await showPopup({
        kind: 'error',
        message: 'No response from extension.',
        anchor: anchorRect,
        reposition,
      });
      return;
    }
    if (response.error === 'NO_API_KEY') {
      await showPopup({
        kind: 'error',
        message: 'Set your KRDict API key to use the dictionary.',
        anchor: anchorRect,
        reposition,
        action: {
          label: 'Open settings',
          onClick: () => chrome.runtime.sendMessage({ type: 'openOptions' }).catch(() => {}),
        },
      });
      return;
    }
    if (response.error === 'FETCH_FAILED') {
      await showPopup({
        kind: 'error',
        message: "Couldn't reach the dictionary. Hover the word again to retry.",
        details: response.message,
        anchor: anchorRect,
        reposition,
      });
      return;
    }
    if (response.error) {
      await showPopup({
        kind: 'error',
        message: 'Lookup failed. Hover the word again to retry.',
        details: `${response.error}${response.message ? `: ${response.message}` : ''}`,
        anchor: anchorRect,
        reposition,
      });
      return;
    }
    lastPayload = response;
    const sentence = opts.sentence !== undefined
      ? opts.sentence
      : extractSentence(anchor);
    lastSentence = sentence;
    await showPopup({
      kind: 'payload',
      payload: {
        lookup: response,
        sentence,
        anchor: anchorRect,
        secondaryLang,
        defLang,
        askAiProvider,
        askAiPromptTemplate,
        askAiChatGptTemporary,
        reposition,
      },
    });
  }

  function onWordEnter(target) {
    if (!enabled) return;
    activeWordEl = target;
    cancelHide();
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (activeWordEl !== target) return;
      performLookup(target);
    }, HOVER_DELAY_MS);
  }

  function onWordLeave() {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    scheduleHide();
  }

  function onWordClick(target, e) {
    // Explicit-intent path: bypasses the hover delay and runs the lookup
    // immediately. Useful on sites where mouseenter is unreliable (some
    // overlays, custom event interceptors), and on touch where there's no
    // hover at all. We do NOT preventDefault/stopPropagation — if the word
    // happens to sit inside an <a> / <button> / etc., the user's click must
    // still trigger that element's behavior (navigation, etc.) alongside
    // our lookup.
    if (!enabled) return;
    activeWordEl = target;
    cancelHide();
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    performLookup(target);
  }

  function attachWordHandlers(root = document.body) {
    if (!root) return;
    root.addEventListener('mouseenter', delegateEnter, true);
    root.addEventListener('mouseleave', delegateLeave, true);
    root.addEventListener('click', delegateClick, true);
  }

  function delegateEnter(e) {
    const t = e.target;
    if (t && t.classList && t.classList.contains(WORD_CLASS)) onWordEnter(t);
  }
  function delegateLeave(e) {
    const t = e.target;
    if (t && t.classList && t.classList.contains(WORD_CLASS)) onWordLeave();
  }
  function delegateClick(e) {
    const t = e.target;
    if (t && t.classList && t.classList.contains(WORD_CLASS)) onWordClick(t, e);
  }

  function setupMutationObserver() {
    const obs = new MutationObserver((records) => {
      if (!enabled) return;
      const newNodes = [];
      for (const rec of records) {
        for (const added of rec.addedNodes) {
          if (added.nodeType === 3) {
            if (!isSkippableNode(added) && HANGUL_RE.test(added.nodeValue || '')) newNodes.push(added);
            HANGUL_RE.lastIndex = 0;
          } else if (added.nodeType === 1 && !added.classList.contains(WORD_CLASS) && !added.classList.contains(GAP_CLASS) && !added.classList.contains(HOST_CLASS)) {
            newNodes.push(...collectTextNodes(added));
          }
        }
      }
      if (newNodes.length) processInChunks(newNodes);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  async function loadSecondaryLang() {
    try {
      const d = await chrome.storage.sync.get(STORAGE_KEYS.SECONDARY_LANG);
      if (d && typeof d[STORAGE_KEYS.SECONDARY_LANG] === 'string' && d[STORAGE_KEYS.SECONDARY_LANG]) {
        secondaryLang = d[STORAGE_KEYS.SECONDARY_LANG];
      }
    } catch { /* keep default */ }
  }

  let adapterLoaded = false;
  function loadAdapter() {
    if (adapterLoaded) return;
    if (!siteConfig || !siteConfig.adapter) return;
    adapterLoaded = true;
    // Site-specific adapter: e.g. YouTube replaces native captions with
    // a dual-language overlay. Fire-and-forget — adapter manages its own
    // teardown on navigation / setting-toggle. We pass an `api` so the
    // adapter can ask us to unwrap/rescan around SPA navigations: on
    // YouTube, stale `.lws-word` spans in reused title / description /
    // sidebar containers confuse YouTube's renderer and cause text to
    // append rather than replace (the "AB" mangling).
    import(chrome.runtime.getURL(siteConfig.adapter))
      .then((mod) => {
        if (mod && typeof mod.setup === 'function') return mod.setup({
          unwrap: () => { if (enabled) unwrapAllWords(); },
          rescan: () => { if (enabled && document.body) scanRoot(document.body); },
        });
      })
      .catch((err) => console.warn('[learnwithsoju] adapter load failed:', err));
  }

  async function init() {
    chrome.runtime.sendMessage({ type: 'warmup' }).catch(() => {});
    const [syncData, localData] = await Promise.all([
      chrome.storage.sync.get([STORAGE_KEYS.DEF_LANG, STORAGE_KEYS.ASK_AI_PROMPT, STORAGE_KEYS.ASK_AI_PROVIDER, STORAGE_KEYS.ASK_AI_CHATGPT_TEMPORARY]),
      chrome.storage.local.get(DISABLED_HOSTS_KEY),
    ]);
    const disabledList = Array.isArray(localData[DISABLED_HOSTS_KEY]) ? localData[DISABLED_HOSTS_KEY] : [];
    hostDisabled = !!currentHost && disabledList.includes(currentHost);
    enabled = !hostDisabled;
    defLang = syncData[STORAGE_KEYS.DEF_LANG] === 'ko' ? 'ko' : DEF_LANG_DEFAULT;
    askAiPromptTemplate = (typeof syncData[STORAGE_KEYS.ASK_AI_PROMPT] === 'string'
      && syncData[STORAGE_KEYS.ASK_AI_PROMPT])
      ? syncData[STORAGE_KEYS.ASK_AI_PROMPT]
      : DEFAULT_ASK_AI_PROMPT;
    askAiProvider = (typeof syncData[STORAGE_KEYS.ASK_AI_PROVIDER] === 'string'
      && AI_PROVIDERS[syncData[STORAGE_KEYS.ASK_AI_PROVIDER]])
      ? syncData[STORAGE_KEYS.ASK_AI_PROVIDER]
      : DEFAULT_ASK_AI_PROVIDER;
    askAiChatGptTemporary = syncData[STORAGE_KEYS.ASK_AI_CHATGPT_TEMPORARY] === true;
    console.log('[lws] content init', { host: currentHost, hostDisabled, enabled, disabledList });
    await loadSecondaryLang();
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', init, { once: true });
      return;
    }
    // Handlers and observer always attach — they self-gate on `enabled`
    // and are cheap. This lets a popup toggle re-activate the extension
    // on this page without a reload, even if it loaded disabled.
    attachWordHandlers(document.body);
    setupMutationObserver();
    if (enabled) {
      scanRoot(document.body);
      loadAdapter();
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    let recompute = false;
    if (area === 'local' && DISABLED_HOSTS_KEY in changes) {
      const nextList = Array.isArray(changes[DISABLED_HOSTS_KEY].newValue)
        ? changes[DISABLED_HOSTS_KEY].newValue : [];
      hostDisabled = !!currentHost && nextList.includes(currentHost);
      recompute = true;
    }
    if (recompute) {
      const next = !hostDisabled;
      if (next && !enabled) {
        enabled = true;
        scanRoot(document.body);
        loadAdapter();
      } else if (!next && enabled) {
        enabled = false;
        hidePopup();
        unwrapAllWords();
      }
    }
    if (area !== 'sync') return;
    if (STORAGE_KEYS.DEF_LANG in changes) {
      const next = changes[STORAGE_KEYS.DEF_LANG].newValue;
      defLang = next === 'ko' ? 'ko' : DEF_LANG_DEFAULT;
      // The overlay component owns the live re-render; in Task 6 the
      // skeleton just acknowledges and Task 7 will add a defLang update.
    }
    if (STORAGE_KEYS.SECONDARY_LANG in changes) {
      const next = changes[STORAGE_KEYS.SECONDARY_LANG].newValue;
      secondaryLang = (typeof next === 'string' && next) ? next : SECONDARY_LANG_DEFAULT;
      // No rerender required — the pill's href is rebuilt on the next
      // buildSentenceNode call, and the dictionary UI is unaffected.
    }
    if (STORAGE_KEYS.ASK_AI_PROMPT in changes) {
      const next = changes[STORAGE_KEYS.ASK_AI_PROMPT].newValue;
      askAiPromptTemplate = (typeof next === 'string' && next) ? next : DEFAULT_ASK_AI_PROMPT;
      // No rerender — the pill's href is built fresh each render.
    }
    if (STORAGE_KEYS.ASK_AI_PROVIDER in changes) {
      const next = changes[STORAGE_KEYS.ASK_AI_PROVIDER].newValue;
      askAiProvider = (typeof next === 'string' && AI_PROVIDERS[next]) ? next : DEFAULT_ASK_AI_PROVIDER;
      // No rerender — pill href + tooltip are rebuilt on next render.
    }
    if (STORAGE_KEYS.ASK_AI_CHATGPT_TEMPORARY in changes) {
      askAiChatGptTemporary = changes[STORAGE_KEYS.ASK_AI_CHATGPT_TEMPORARY].newValue === true;
      // No rerender — pill href is rebuilt on next render.
    }
  });

  init();
})();
