(async () => {
  const HANGUL_RE = /[가-힣ᄀ-ᇿ㄰-㆏]+/g;
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'NOSCRIPT', 'IFRAME', 'CANVAS', 'SVG']);
  const POPUP_ID = 'lws-popup';
  const HOST_CLASS = 'lws-host';
  const WORD_CLASS = 'lws-word';
  const HIDE_DELAY_MS = 120;
  const HOVER_DELAY_MS = 60;
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
  };
  // Per-site disable list lives in chrome.storage.local (see popup.js for
  // rationale — sync was dropping per-site writes).
  const DISABLED_HOSTS_KEY = 'disabledHosts';
  // Default Ask-AI prompt template. Kept in sync with options.js
  // (DEFAULT_ASK_AI_PROMPT) — if you change one, change the other.
  // Placeholders: {sentence}, {word}, {language}.
  const DEFAULT_ASK_AI_PROMPT = `You are a Korean language expert helping a {language} learner. The focus word is \`{word}\` (in backticks). The sentence is "{sentence}".

Reply in {language} using exactly this structure (skip a section if it genuinely doesn't apply, but never add sections, preamble, or closing remarks):

**Focus** — meaning of \`{word}\` *in this sentence* (one sentence). Note the dictionary lemma if the surface form differs.

**Translation** — one natural {language} sentence.

**Breakdown** — markdown table. Columns: Korean | Lemma | POS | Meaning. One row per surface word, left to right.

**Grammar of \`{word}\`** — exhaustive analysis of the focus word only. Cover every grammatical feature: morphological decomposition (stem + each suffix/auxiliary in order), tense/aspect/mood, speech level, attached particles, and every grammar pattern present. For each pattern, use a sub-heading and include:
  - Pattern in code-ticks (e.g. \`-아/어 보다\`) and its literal meaning
  - Nuance / when a native uses it
  - One short example sentence in a different context, with its translation
  - Register or common collocations if notable
Don't skip the "obvious" ones — be thorough. Order patterns from outermost (closest to the stem) to innermost suffix.

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

  const parsers = await import(chrome.runtime.getURL('parsers.js'));
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

  const glosses = await import(chrome.runtime.getURL('grammar-glosses.js'));
  const { morphemeGloss, isContentMorpheme } = glosses;

  const sites = await import(chrome.runtime.getURL('site-configs.js'));
  const { findSiteConfig } = sites;

  const aiProvidersMod = await import(chrome.runtime.getURL('ai-providers.js'));
  const { AI_PROVIDERS, DEFAULT_ASK_AI_PROVIDER } = aiProvidersMod;
  // Resolved once per content-script lifetime — frames don't navigate between
  // sites without a reload, which re-injects content.js.
  const currentHost = (window.location && window.location.hostname || '').toLowerCase();
  const siteConfig = findSiteConfig(currentHost);

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
  let popupHost = null;
  let popupRoot = null;
  let popupEl = null;
  let activeWordEl = null;
  let lastPayload = null;
  let lastSentence = null;
  // Which "insights" panel is open. Null means it's collapsed.
  let activeInsightTab = null;
  let activeTabIdx = 0;
  let relatedExpanded = false;
  let popupMinHeight = 0;
  let popupMinWidth = 0;
  let expandedExamples = new Set();
  let expandedHanja = new Set();
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
        frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      const span = document.createElement('span');
      span.className = WORD_CLASS;
      span.dataset.surface = match[0];
      span.textContent = match[0];
      frag.appendChild(span);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
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
    const spans = document.querySelectorAll('span.' + WORD_CLASS);
    for (const span of spans) {
      const parent = span.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(span.textContent), span);
    }
  }

  function ensurePopup() {
    if (popupHost) return;
    popupHost = document.createElement('div');
    popupHost.className = HOST_CLASS;
    popupHost.style.all = 'initial';
    // Anchored at the document origin (not the viewport) so the popup
    // scrolls with the page. The popup inside uses `position: absolute`
    // and document-relative coords (see positionPopup).
    popupHost.style.position = 'absolute';
    popupHost.style.top = '0';
    popupHost.style.left = '0';
    popupHost.style.zIndex = '2147483647';
    popupHost.style.pointerEvents = 'none';
    popupRoot = popupHost.attachShadow({ mode: 'open' });
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = chrome.runtime.getURL('popup-shadow.css');
    popupRoot.appendChild(styleLink);
    popupEl = document.createElement('div');
    popupEl.id = POPUP_ID;
    popupEl.setAttribute('role', 'tooltip');
    popupEl.style.display = 'none';
    popupRoot.appendChild(popupEl);
    document.documentElement.appendChild(popupHost);

    popupEl.addEventListener('mouseenter', () => {
      cancelHide();
      unpinPopup();
    });
    popupEl.addEventListener('mouseleave', scheduleHide);
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
    if (popupEl) {
      popupEl.style.display = 'none';
      popupEl.innerHTML = '';
    }
    resumeVideoIfApplicable();
    activeWordEl = null;
    lastSentence = null;
    activeInsightTab = null;
    pendingRequestId++;
  }

  function positionPopup(target) {
    // Compute everything in viewport coords first — that's what the
    // initial-fit clamps (flip above, clip to viewport edge) want, since
    // we're trying to keep the popup visible at the moment of show.
    const rect = target.getBoundingClientRect();
    const popupRect = popupEl.getBoundingClientRect();
    const margin = 8;
    let top = rect.bottom + margin;
    let left = rect.left;

    if (top + popupRect.height > window.innerHeight - margin) {
      top = rect.top - popupRect.height - margin;
    }
    if (top < margin) top = margin;
    if (left + popupRect.width > window.innerWidth - margin) {
      left = window.innerWidth - popupRect.width - margin;
    }
    if (left < margin) left = margin;

    // Convert to document coords before writing — popupEl is
    // `position: absolute` (see popup-shadow.css) and popupHost is
    // anchored at the document origin, so document-relative coords mean
    // the popup scrolls with the page. If the popup grows after a tab
    // click and would exceed the viewport, the user can simply scroll the
    // page to read the rest, instead of being stuck with content clipped
    // off-screen that they can't reach.
    popupEl.style.left = `${Math.max(0, left + window.scrollX)}px`;
    popupEl.style.top = `${Math.max(0, top + window.scrollY)}px`;
  }

  function showPopup(target, contentNode, opts = {}) {
    ensurePopup();
    popupEl.innerHTML = '';
    popupEl.appendChild(contentNode);
    // Apply remembered min-height / min-width so the popup never shrinks below
    // the largest size the user has seen this session — keeps the cursor
    // inside the popup boundary across tab/lang/example toggles.
    popupEl.style.minHeight = popupMinHeight ? `${popupMinHeight}px` : '';
    popupEl.style.minWidth = popupMinWidth ? `${popupMinWidth}px` : '';
    popupEl.style.display = 'block';
    popupEl.style.pointerEvents = 'auto';
    popupHost.style.pointerEvents = 'none';
    // Idempotent: only pauses on the first showPopup of a session, so
    // rerenders triggered by tab clicks / language toggle / chip expand
    // don't re-pause the (already-paused) video. The anchor is passed so
    // pause can verify the hovered word is in a caption container.
    pauseVideoIfApplicable(target);
    const reposition = opts.reposition !== false;
    requestAnimationFrame(() => {
      // After paint, capture the actual rendered size so future renders can't
      // shrink below it. Monotonic non-decreasing for the popup's lifetime.
      const h = popupEl.offsetHeight;
      const w = popupEl.offsetWidth;
      if (h > popupMinHeight) popupMinHeight = h;
      if (w > popupMinWidth) popupMinWidth = w;
      // Reposition only when this is a fresh show (new target / new lookup).
      // Rerenders triggered by tab clicks, the related-pill expand, or the
      // EN/KO toggle keep the current position — moving the popup mid-click
      // is what was eating tab clicks after the +N expand.
      if (reposition) positionPopup(target);
    });
  }

  function buildLoadingNode(surface) {
    const div = document.createElement('div');
    div.className = 'lws-popup-body lws-loading';
    div.textContent = `Looking up ${surface}…`;
    return div;
  }

  function extractSentence(wordEl) {
    // Per-site override (see site-configs.js): sites that render text as
    // many flat sibling spans (YouTube subtitles, etc.) need a specific
    // ancestor selector — the default walk-up hits the body before finding
    // a useful block. If the hovered word isn't inside the configured
    // container (e.g. the user hovered a video-description word on
    // YouTube), `closest()` returns null and we fall through to the
    // default walk so non-caption text on the same page still works.
    let block = null;
    if (siteConfig && siteConfig.sentenceContainer) {
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
    return `${currentProvider().urlPrefix}${encodeURIComponent(prompt)}`;
  }

  function buildAiPill(sentence) {
    const a = document.createElement('a');
    a.className = 'lws-ai-pill';
    a.href = buildAskAiUrl(sentence);
    a.target = '_blank';
    a.rel = 'noreferrer noopener';
    a.title = `Ask ${currentProvider().name} to explain this sentence and the highlighted word`;
    const icon = document.createElement('span');
    icon.className = 'lws-ai-pill-icon';
    icon.textContent = '✨';
    icon.setAttribute('aria-hidden', 'true');
    a.appendChild(icon);
    const text = document.createElement('span');
    text.textContent = 'Ask AI';
    a.appendChild(text);
    // The popup container swallows clicks for the dictionary UI; the pill
    // is an anchor with target=_blank so the click needs to escape, but
    // we still stop propagation so the popup doesn't reposition / rerender.
    a.addEventListener('click', (e) => e.stopPropagation());
    return a;
  }

  function buildSentenceNode(sentence) {
    const wrap = document.createElement('div');
    wrap.className = 'lws-sentence';
    const header = document.createElement('div');
    header.className = 'lws-sentence-header';
    const label = document.createElement('span');
    label.className = 'lws-sentence-label';
    label.textContent = 'Given sentence';
    header.appendChild(label);
    header.appendChild(buildAiPill(sentence));
    wrap.appendChild(header);
    const body = document.createElement('div');
    body.className = 'lws-sentence-text';

    // Reconstruct the full sentence string so per-word click handlers can
    // build a new {before, word, after} pointing at the clicked occurrence
    // (the same word can appear multiple times — we want the right one).
    const fullText = sentence.before + sentence.word + sentence.after;
    appendSentenceWords(body, sentence.before, 0, fullText);
    const hit = document.createElement('span');
    hit.className = 'lws-sentence-hit';
    hit.textContent = sentence.word;
    body.appendChild(hit);
    appendSentenceWords(body, sentence.after, sentence.before.length + sentence.word.length, fullText);

    wrap.appendChild(body);
    return wrap;
  }

  // Walk `text` (one side of the active hit), splitting it into whitespace
  // runs and 어절 chunks. Each chunk's Hangul "core" (stripped of leading
  // and trailing punctuation) becomes a clickable span that re-looks up
  // that word and keeps the same sentence as the popup context. Non-Hangul
  // pieces — punctuation, ellipsis markers, embedded latin — render as
  // plain text inside the same line.
  function appendSentenceWords(parent, text, baseOffset, fullText) {
    if (!text) return;
    const chunkRe = /\S+/g;
    let lastEnd = 0;
    let m;
    while ((m = chunkRe.exec(text)) !== null) {
      if (m.index > lastEnd) {
        parent.appendChild(document.createTextNode(text.slice(lastEnd, m.index)));
      }
      const chunk = m[0];
      const start = chunk.search(/[가-힣ᄀ-ᇿ㄰-㆏]/);
      if (start < 0) {
        parent.appendChild(document.createTextNode(chunk));
      } else {
        let end = chunk.length;
        while (end > start && !/[가-힣ᄀ-ᇿ㄰-㆏]/.test(chunk.charAt(end - 1))) end--;
        if (start > 0) parent.appendChild(document.createTextNode(chunk.slice(0, start)));
        const surface = chunk.slice(start, end);
        const surfaceOffset = baseOffset + m.index + start;
        const span = document.createElement('span');
        span.className = 'lws-sentence-word';
        span.textContent = surface;
        span.setAttribute('role', 'button');
        span.tabIndex = 0;
        span.title = `Look up ${surface}`;
        const trigger = (e) => {
          e.stopPropagation();
          e.preventDefault();
          onSentenceWordClick(surface, fullText, surfaceOffset);
        };
        span.addEventListener('click', trigger);
        span.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') trigger(e);
        });
        parent.appendChild(span);
        if (end < chunk.length) parent.appendChild(document.createTextNode(chunk.slice(end)));
      }
      lastEnd = m.index + chunk.length;
    }
    if (lastEnd < text.length) parent.appendChild(document.createTextNode(text.slice(lastEnd)));
  }

  function onSentenceWordClick(surface, fullText, offset) {
    if (!surface) return;
    const newSentence = {
      before: fullText.slice(0, offset),
      word: surface,
      after: fullText.slice(offset + surface.length),
    };
    pinPopup();
    performLookup(null, { surface, sentence: newSentence });
  }

  function buildDecompositionNode(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) return null;
    const morphemes = tokens
      .map((t) => ({ form: t.surface, pos: t.pos || '' }))
      .filter((m) => m.form && isContentMorpheme(m));
    // Don't render the section when it's a single one-morpheme word — the
    // headword section already shows the same info.
    if (morphemes.length < 2) return null;

    const wrap = document.createElement('div');
    wrap.className = 'lws-decomp';
    // The tab label already says "Morpheme breakdown" — no inline header.
    const stack = document.createElement('div');
    stack.className = 'lws-decomp-stack';
    morphemes.forEach((m, i) => {
      stack.appendChild(buildMorphemeRow(m, i > 0));
    });
    wrap.appendChild(stack);
    return wrap;
  }

  function buildMorphemeRow(morpheme, withPlus) {
    const row = document.createElement('div');
    row.className = 'lws-morph-row';
    const op = document.createElement('span');
    op.className = 'lws-morph-op' + (withPlus ? '' : ' lws-morph-op-empty');
    op.textContent = withPlus ? '+' : '';
    op.setAttribute('aria-hidden', 'true');
    row.appendChild(op);
    row.appendChild(buildMorphemeChip(morpheme));
    return row;
  }

  function buildMorphemeChip({ form, pos }) {
    const chip = document.createElement('span');
    chip.className = 'lws-morph';
    const formEl = document.createElement('span');
    formEl.className = 'lws-morph-form';
    formEl.textContent = form;
    chip.appendChild(formEl);

    const tag = posToShortform(displayPosKoreanToEnglishMaybe(pos), defLang);
    const short = tag || (pos.split('+')[0] || '');
    if (short) {
      const sep = document.createElement('span');
      sep.className = 'lws-morph-sep';
      sep.textContent = '·';
      chip.appendChild(sep);
      const tagEl = document.createElement('span');
      tagEl.className = 'lws-morph-tag';
      tagEl.textContent = short;
      chip.appendChild(tagEl);
    }

    const gloss = morphemeGloss(form, pos);
    if (gloss) {
      // Tooltip on hover; also rendered as faint text below for readability.
      chip.title = gloss;
      const glossEl = document.createElement('span');
      glossEl.className = 'lws-morph-gloss';
      glossEl.textContent = gloss;
      chip.appendChild(glossEl);
    }
    return chip;
  }

  // posToShortform expects KRDict-style Korean POS labels like 명사 / 동사,
  // but mecab uses Sejong tags like NNG / VV. This adapter translates the
  // common Sejong lead tags into the Korean POS strings the shortform
  // table understands; everything else passes through and falls back to
  // the lead Sejong tag itself.
  const SEJONG_TO_KOREAN_POS = {
    NNG: '명사', NNP: '명사', NNB: '의존 명사', NR: '수사', NP: '대명사',
    VV: '동사', VA: '형용사', VX: '보조 동사', VCP: '동사', VCN: '동사',
    MM: '관형사', MAG: '부사', MAJ: '부사', IC: '감탄사',
    JKS: '조사', JKC: '조사', JKO: '조사', JKG: '조사', JKB: '조사',
    JKV: '조사', JKQ: '조사', JX: '조사', JC: '조사',
    EP: '어미', EF: '어미', EC: '어미', ETN: '어미', ETM: '어미',
    XPN: '접두사', XSN: '접미사', XSV: '접미사', XSA: '접미사', XR: '어근',
    SL: '명사', SH: '명사', SN: '수사',
  };
  function displayPosKoreanToEnglishMaybe(pos) {
    if (!pos) return '';
    const lead = pos.split('+')[0];
    return SEJONG_TO_KOREAN_POS[lead] || lead;
  }

  // Click-to-expand toggle for the morpheme breakdown. Hidden entirely when
  // mecab didn't produce 2+ content morphemes (single-content-morpheme nouns
  // like 학교 have nothing to decompose). Sits between the sentence band
  // and the dictionary entries.
  function buildInsightsNode(payload) {
    const tokens = payload && Array.isArray(payload.tokens) ? payload.tokens : [];
    const breakdownMorphemes = tokens
      .map((t) => ({ form: t.surface, pos: t.pos || '' }))
      .filter((m) => m.form && isContentMorpheme(m));
    if (breakdownMorphemes.length < 2) return null;

    const wrap = document.createElement('div');
    wrap.className = 'lws-insights';

    const tabs = document.createElement('div');
    tabs.className = 'lws-insights-tabs';
    tabs.appendChild(buildInsightTab('breakdown'));
    wrap.appendChild(tabs);

    if (activeInsightTab === 'breakdown') {
      const node = buildDecompositionNode(tokens);
      if (node) wrap.appendChild(node);
    }
    return wrap;
  }

  function buildInsightTab(id) {
    const labels = id === 'breakdown'
      ? { en: 'Morpheme breakdown', ko: '형태소 분석' }
      : { en: id, ko: id };
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lws-insights-tab';
    btn.textContent = defLang === 'ko' ? labels.ko : labels.en;
    btn.setAttribute('aria-pressed', activeInsightTab === id ? 'true' : 'false');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      activeInsightTab = (activeInsightTab === id) ? null : id;
      rerenderActivePopup();
    });
    return btn;
  }

  function buildErrorNode(message, action, details) {
    const div = document.createElement('div');
    div.className = 'lws-popup-body lws-error';
    const p = document.createElement('div');
    p.className = 'lws-error-msg';
    p.textContent = message;
    div.appendChild(p);
    if (details) {
      const d = document.createElement('div');
      d.className = 'lws-error-detail';
      d.textContent = details;
      div.appendChild(d);
    }
    if (action) {
      const btn = document.createElement('button');
      btn.className = 'lws-action-btn';
      btn.type = 'button';
      btn.textContent = action.label;
      btn.addEventListener('click', action.onClick);
      div.appendChild(btn);
    }
    return div;
  }

  // Dedupe KRDict entries across N parallel query results. KRDict's word
  // search is approximate, so adjacent queries (반말 + 반, 파티원들 + 파티 +
  // 원, etc.) occasionally overlap when one query's broad-match list
  // bleeds into another's exact-word territory. We keep the first
  // occurrence in iteration order — earlier groups (more-specific queries
  // first) win.
  function mergeKrEntriesAll(groups) {
    if (!groups || groups.length === 0) return [];
    if (groups.length === 1) return groups[0] || [];
    const keyOf = (e) => {
      const word = (e.word || '').trim();
      const pos = (e.pos || '').trim();
      const def = ((e.senses && e.senses[0] && e.senses[0].definition) || '').slice(0, 40);
      return `${word}|${pos}|${def}`;
    };
    const seen = new Set();
    const out = [];
    for (const group of groups) {
      if (!group) continue;
      for (const e of group) {
        const k = keyOf(e);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(e);
      }
    }
    return out;
  }

  function buildResultNode(payload, options = {}) {
    const root = document.createElement('div');

    // Background may have run up to 4 parallel KRDict queries for
    // multi-constituent compounds. Read the new krXmls array if present;
    // fall back to the old krXml + krXmlExtra fields for cached payloads
    // from earlier versions.
    const xmls = Array.isArray(payload.krXmls) && payload.krXmls.length > 0
      ? payload.krXmls
      : [payload.krXml, payload.krXmlExtra].filter(Boolean);
    const parsedGroups = xmls.map((x) => parseKrdictXml(x, DOMParser));
    const krEntries = mergeKrEntriesAll(parsedGroups);
    const odEntries = parseOpendictXml(payload.odXml, DOMParser);

    const showLemmaChip = payload.queryUsed && payload.queryUsed !== payload.surface;
    if (showLemmaChip || krEntries.length > 0 || odEntries.length > 0) {
      root.appendChild(buildStripNode({
        showLemmaChip,
        lemma: payload.queryUsed,
      }));
    }

    if (options.sentence) {
      root.appendChild(buildSentenceNode(options.sentence));
    }

    const insights = buildInsightsNode(payload);
    if (insights) root.appendChild(insights);

    if (krEntries.length === 0 && odEntries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lws-popup-body lws-empty';
      const surf = document.createElement('div');
      surf.className = 'lws-empty-surface';
      surf.textContent = payload.surface;
      empty.appendChild(surf);
      const msg = document.createElement('div');
      msg.className = 'lws-empty-msg';
      msg.textContent = payload.lemma && payload.lemma !== payload.surface
        ? `No definition found for ${payload.lemma} or ${payload.surface}.`
        : 'No definition found.';
      empty.appendChild(msg);
      root.appendChild(empty);
      return root;
    }

    // Partition: KRDict often returns the headword we asked for plus loosely
    // related forms (compound words containing it, derived nouns, etc.).
    // Headword matches get the default tabs; the rest sit behind a "+N related"
    // pill that, when clicked, appends them as additional tabs inline.
    //
    // We also promote the +하다 (action verb) and +되다 (passive) forms of a
    // queried noun — `예약` and `예약하다` belong together for a learner, not
    // split across a fold. Keeps "related" for genuinely tangential entries
    // like compound nouns (`예약자`, `예약금`).
    // For pure-noun compounds (multiPrimary=true), every constituent we
    // queried is a primary tab — 파티원들 surfaces both 파티 and 원 in
    // the tab strip rather than burying one behind +N related. For verb
    // compounds (multiPrimary=false), only the lemma is primary and the
    // constituents (예약, 하다 etc.) stay related.
    const queriesUsed = Array.isArray(payload.queriesUsed) && payload.queriesUsed.length > 0
      ? payload.queriesUsed
      : [payload.queryUsed, payload.queryUsedExtra].filter(Boolean);
    const multiPrimary = payload.multiPrimary === true;
    const promoteAll = multiPrimary ? queriesUsed : queriesUsed.slice(0, 1);
    const surfaceLiteral = (payload.surface || '').trim();
    const PROMOTED_SUFFIXES = ['', '하다', '되다'];
    const promotedForms = new Set();
    // Always include the literal surface — KRDict's broad-match often
    // returns the exact word the user hovered even when our `q=<surface>`
    // query came back empty (e.g. 창조자: q=창조자 may be empty but q=창조
    // includes 창조자 in its broad-match results).
    if (surfaceLiteral) {
      for (const suf of PROMOTED_SUFFIXES) promotedForms.add(surfaceLiteral + suf);
    }
    for (const q of promoteAll) {
      const trimmed = (q || '').trim();
      if (!trimmed) continue;
      for (const suf of PROMOTED_SUFFIXES) promotedForms.add(trimmed + suf);
    }
    const isExactMatch = (e) => promotedForms.has((e.word || '').trim());
    const exactEntries = krEntries.filter(isExactMatch);
    const relatedEntries = krEntries.filter((e) => !isExactMatch(e));
    // If KRDict didn't return any headword exact match (unusual — the query
    // hit something looser), fall back to the original behavior: show all
    // entries as tabs rather than burying them all.
    const primaryEntries = exactEntries.length > 0 ? exactEntries : krEntries;
    const hiddenRelated = exactEntries.length > 0 ? relatedEntries : [];
    // Sort primary so entries whose word equals the literal hovered surface
    // lead. Stable JS sort — same-priority entries keep their merge order.
    if (surfaceLiteral && primaryEntries.length > 1) {
      primaryEntries.sort((a, b) => {
        const aMatch = (a.word || '').trim() === surfaceLiteral ? 0 : 1;
        const bMatch = (b.word || '').trim() === surfaceLiteral ? 0 : 1;
        return aMatch - bMatch;
      });
    }
    const displayedEntries = relatedExpanded
      ? primaryEntries.concat(hiddenRelated)
      : primaryEntries;
    const showExpandPill = !relatedExpanded && hiddenRelated.length > 0;

    if (displayedEntries.length > 1 || showExpandPill) {
      if (activeTabIdx >= displayedEntries.length) activeTabIdx = 0;
      root.appendChild(buildTabBar(displayedEntries, {
        expandCount: showExpandPill ? hiddenRelated.length : 0,
      }));
    }
    if (displayedEntries.length > 0) {
      root.appendChild(buildKrEntryNode(displayedEntries[activeTabIdx]));
    }

    if (odEntries.length > 0) {
      const sep = document.createElement('div');
      sep.className = 'lws-section-label';
      const label = document.createElement('span');
      label.textContent = 'OpenDict ';
      sep.appendChild(label);
      const beta = document.createElement('span');
      beta.className = 'lws-beta';
      beta.textContent = 'experimental';
      sep.appendChild(beta);
      root.appendChild(sep);
      for (const entry of odEntries) root.appendChild(buildOdEntryNode(entry));
    }

    return root;
  }

  function buildTabBar(entries, opts = {}) {
    const labels = computeTabLabels(entries);
    const bar = document.createElement('div');
    bar.className = 'lws-tabs';
    bar.setAttribute('role', 'tablist');
    labels.forEach((label, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lws-tab';
      btn.textContent = label;
      // Tab text uses POS shortform to stay narrow; full form goes in the
      // tooltip so the meaning is one hover away.
      const fullPos = displayPos(entries[i].pos);
      if (fullPos) btn.title = `${entries[i].word || ''} — ${fullPos}`.trim();
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', i === activeTabIdx ? 'true' : 'false');
      btn.dataset.idx = String(i);
      btn.addEventListener('click', () => onTabClick(i));
      bar.appendChild(btn);
    });
    if (opts.expandCount > 0) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lws-tab lws-tab-expand';
      btn.textContent = `+${opts.expandCount} related`;
      btn.title = 'Show related entries KRDict returned for this query';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        relatedExpanded = true;
        rerenderActivePopup();
      });
      bar.appendChild(btn);
    }
    return bar;
  }

  function computeTabLabels(entries) {
    // Tab format: "<headword> (<pos shortform>)" — e.g. "예약하다 (v.)".
    // When the same headword + POS combo appears twice (rare KRDict homograph),
    // append a numeric disambiguator.
    const base = entries.map((e) => {
      const word = e.word || '·';
      const short = posToShortform(e.pos, defLang);
      return short ? `${word} (${short})` : word;
    });
    const counts = new Map();
    base.forEach((l) => counts.set(l, (counts.get(l) || 0) + 1));
    const seen = new Map();
    return base.map((l) => {
      if (counts.get(l) === 1) return l;
      const n = (seen.get(l) || 0) + 1;
      seen.set(l, n);
      return `${l} ${n}`;
    });
  }

  function onTabClick(idx) {
    if (activeTabIdx === idx) return;
    activeTabIdx = idx;
    rerenderActivePopup();
  }

  function buildStripNode({ showLemmaChip, lemma }) {
    const strip = document.createElement('div');
    strip.className = 'lws-strip';

    const lemmaWrap = document.createElement('div');
    lemmaWrap.className = 'lws-strip-lemma';
    if (showLemmaChip && lemma) {
      const chip = document.createElement('span');
      chip.className = 'lws-chip lws-chip-amber';
      chip.textContent = lemma;
      lemmaWrap.appendChild(chip);
    }
    strip.appendChild(lemmaWrap);

    const toggle = document.createElement('div');
    toggle.className = 'lws-toggle';
    toggle.setAttribute('role', 'group');
    toggle.setAttribute('aria-label', 'Definition language');

    const enBtn = makeToggleBtn('en', '영어');
    const koBtn = makeToggleBtn('ko', '한국어');
    toggle.appendChild(enBtn);
    toggle.appendChild(koBtn);
    strip.appendChild(toggle);

    return strip;
  }

  function makeToggleBtn(lang, label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lws-toggle-btn';
    btn.textContent = label;
    btn.setAttribute('aria-pressed', defLang === lang ? 'true' : 'false');
    btn.dataset.lang = lang;
    btn.addEventListener('click', () => onToggleLang(lang));
    return btn;
  }

  async function onToggleLang(lang) {
    if (defLang === lang) return;
    defLang = lang;
    try { await chrome.storage.sync.set({ [STORAGE_KEYS.DEF_LANG]: lang }); } catch {}
    rerenderActivePopup();
  }

  function rerenderActivePopup() {
    if (!activeWordEl || !lastPayload || !popupEl || popupEl.style.display === 'none') return;
    // Use the sentence captured at lookup time, not a fresh extract from
    // activeWordEl — that way a sentence-word click that rebuilt the
    // {before, word, after} doesn't snap back to the page's DOM-derived
    // sentence on the next rerender.
    showPopup(
      activeWordEl,
      buildResultNode(lastPayload, { sentence: lastSentence }),
      { reposition: false },
    );
  }

  function buildKrEntryNode(entry, senseKeyPrefix = `kr:${activeTabIdx}`) {
    const wrap = document.createElement('div');
    wrap.className = 'lws-entry';

    const headline = document.createElement('div');
    headline.className = 'lws-headline';
    const word = document.createElement('span');
    word.className = 'lws-word-form';
    word.textContent = entry.word || '';
    headline.appendChild(word);
    const stars = gradeToStars(entry.grade);
    if (stars) {
      const s = document.createElement('span');
      s.className = 'lws-stars';
      s.textContent = stars;
      const tooltip = gradeToTooltip(entry.grade);
      if (tooltip) {
        s.title = tooltip;
        s.setAttribute('aria-label', tooltip);
      }
      headline.appendChild(s);
    }
    wrap.appendChild(headline);

    const meta = document.createElement('div');
    meta.className = 'lws-meta-row';
    if (entry.pos) meta.appendChild(makePosChip(entry.word, entry.pos));
    if (entry.pronunciation) {
      const pron = makePronChip(entry.word, entry.pronunciation);
      if (pron) meta.appendChild(pron);
    }
    if (entry.origin) meta.appendChild(makeHanjaChip(entry.origin));
    if (meta.children.length) wrap.appendChild(meta);

    if (entry.origin) {
      const meanings = buildHanjaMeaningsNode(entry.origin);
      if (meanings) wrap.appendChild(meanings);
    }

    if (entry.senses.length > 0) {
      const senses = document.createElement('div');
      senses.className = 'lws-senses';
      const showMultiple = entry.senses.length > 1;
      entry.senses.forEach((sense, i) => {
        const senseId = `${senseKeyPrefix}:${i}`;
        senses.appendChild(buildSenseNode(sense, showMultiple ? i + 1 : null, senseId));
      });
      wrap.appendChild(senses);
    }

    return wrap;
  }

  function buildSenseNode(sense, num, senseId) {
    const senseEl = document.createElement('div');
    senseEl.className = 'lws-sense';
    if (num !== null) {
      const n = document.createElement('span');
      n.className = 'lws-sense-num';
      n.textContent = `${num}.`;
      senseEl.appendChild(n);
    }
    if (defLang === 'en') {
      const tr = sense.translations[0];
      if (tr && tr.trans_word) {
        const w = document.createElement('div');
        w.className = 'lws-trans-word';
        w.textContent = tr.trans_word;
        senseEl.appendChild(w);
      }
      if (tr && tr.trans_dfn) {
        const d = document.createElement('div');
        d.className = 'lws-trans-dfn';
        d.textContent = tr.trans_dfn;
        senseEl.appendChild(d);
      }
      if ((!tr || (!tr.trans_word && !tr.trans_dfn)) && sense.definition) {
        // fall back to Korean definition if English is missing
        const d = document.createElement('div');
        d.className = 'lws-ko-def';
        d.textContent = sense.definition;
        senseEl.appendChild(d);
      }
    } else if (sense.definition) {
      const d = document.createElement('div');
      d.className = 'lws-ko-def';
      d.textContent = sense.definition;
      senseEl.appendChild(d);
    }
    appendExamplesToggle(senseEl, sense.examples, senseId);
    return senseEl;
  }

  function appendExamplesToggle(senseEl, examples, senseId) {
    if (!examples || examples.length === 0) return;
    const isOpen = expandedExamples.has(senseId);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'lws-examples-toggle';
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    toggle.textContent = isOpen
      ? `▾ Hide examples (${examples.length})`
      : `▸ Show examples (${examples.length})`;
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (expandedExamples.has(senseId)) expandedExamples.delete(senseId);
      else expandedExamples.add(senseId);
      rerenderActivePopup();
    });
    senseEl.appendChild(toggle);
    if (isOpen) {
      const list = document.createElement('ul');
      list.className = 'lws-examples';
      for (const ex of examples) {
        const li = document.createElement('li');
        li.textContent = ex;
        list.appendChild(li);
      }
      senseEl.appendChild(list);
    }
  }

  function buildOdEntryNode(entry) {
    const wrap = document.createElement('div');
    wrap.className = 'lws-entry lws-od-entry';
    const headline = document.createElement('div');
    headline.className = 'lws-headline';
    const word = document.createElement('span');
    word.className = 'lws-word-form';
    word.textContent = entry.word || '';
    headline.appendChild(word);
    wrap.appendChild(headline);

    if (entry.pos || entry.origin) {
      const meta = document.createElement('div');
      meta.className = 'lws-meta-row';
      if (entry.pos) meta.appendChild(makePosChip(entry.word, entry.pos));
      if (entry.origin) meta.appendChild(makeHanjaChip(entry.origin));
      wrap.appendChild(meta);
    }

    if (entry.origin) {
      const meanings = buildHanjaMeaningsNode(entry.origin);
      if (meanings) wrap.appendChild(meanings);
    }

    const senses = document.createElement('div');
    senses.className = 'lws-senses';
    const showMultiple = entry.senses.length > 1;
    entry.senses.forEach((sense, i) => {
      const senseId = `od:${i}`;
      senses.appendChild(buildOdSenseNode(sense, showMultiple ? i + 1 : null, senseId));
    });
    wrap.appendChild(senses);
    return wrap;
  }

  function buildOdSenseNode(sense, num, senseId) {
    const senseEl = document.createElement('div');
    senseEl.className = 'lws-sense';
    if (num !== null) {
      const n = document.createElement('span');
      n.className = 'lws-sense-num';
      n.textContent = `${num}.`;
      senseEl.appendChild(n);
    }
    if (defLang === 'en') {
      const enTrans = filterTranslations(sense.translations, 'en');
      const tr = enTrans[0];
      if (tr && tr.trans_word) {
        const w = document.createElement('div');
        w.className = 'lws-trans-word';
        w.textContent = tr.trans_word;
        senseEl.appendChild(w);
      }
      if (tr && tr.trans_dfn) {
        const d = document.createElement('div');
        d.className = 'lws-trans-dfn';
        d.textContent = tr.trans_dfn;
        senseEl.appendChild(d);
      }
      if ((!tr || (!tr.trans_word && !tr.trans_dfn)) && sense.definition) {
        const d = document.createElement('div');
        d.className = 'lws-ko-def';
        d.textContent = sense.definition;
        senseEl.appendChild(d);
      }
    } else if (sense.definition) {
      const d = document.createElement('div');
      d.className = 'lws-ko-def';
      d.textContent = sense.definition;
      senseEl.appendChild(d);
    }
    appendExamplesToggle(senseEl, sense.examples, senseId);
    return senseEl;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  // "Arrow out of box" external-link icon. Stroke uses currentColor so it
  // inherits the chip's text color and stays in sync with each variant.
  const EXT_ICON_PATHS = [
    'M8.5 2h3.5v3.5',
    'M12 2 6.5 7.5',
    'M11 8.5V11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h2.5',
  ];
  function buildExternalIcon() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 14 14');
    svg.setAttribute('width', '11');
    svg.setAttribute('height', '11');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.4');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('lws-ext-icon');
    for (const d of EXT_ICON_PATHS) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
    return svg;
  }

  function makeChip(text, variant, opts = {}) {
    const chip = document.createElement(opts.href ? 'a' : 'span');
    chip.className = `lws-chip lws-chip-${variant}` + (opts.href ? ' lws-chip-link' : '');
    const label = document.createElement('span');
    label.className = 'lws-chip-label';
    label.textContent = text;
    chip.appendChild(label);
    if (opts.href) {
      chip.href = opts.href;
      chip.target = '_blank';
      chip.rel = 'noreferrer noopener';
      chip.appendChild(buildExternalIcon());
    }
    if (opts.title) chip.title = opts.title;
    return chip;
  }

  // Amber pill showing the origin text (e.g. "豫約"). When the origin contains
  // at least one Hanja character the pill becomes a button — clicking it
  // expands the per-character meanings panel below the meta row. The `+`/`−`
  // indicator and the tooltip make the affordance discoverable; non-Hanja
  // origins (rare malformed data) fall back to a plain non-interactive chip.
  function makeHanjaChip(origin) {
    if (!origin) return null;
    const chars = [...origin].filter(isHanjaChar).join('');
    if (chars.length === 0) return makeChip(origin, 'amber');

    const charCount = [...chars].length;
    const isOpen = expandedHanja.has(chars);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'lws-chip lws-chip-amber lws-chip-button';
    chip.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    chip.title = isOpen
      ? `Hide Hanja meanings (${charCount} character${charCount === 1 ? '' : 's'})`
      : `Show Hanja meanings (${charCount} character${charCount === 1 ? '' : 's'})`;

    const label = document.createElement('span');
    label.className = 'lws-chip-label';
    label.textContent = origin;
    chip.appendChild(label);

    const indicator = document.createElement('span');
    indicator.className = 'lws-chip-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    indicator.textContent = isOpen ? '−' : '+';
    chip.appendChild(indicator);

    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      if (expandedHanja.has(chars)) expandedHanja.delete(chars);
      else expandedHanja.add(chars);
      rerenderActivePopup();
    });
    return chip;
  }

  // Session-level cache for Hanja meanings — avoids refetching when the popup
  // rerenders (tab switch, lang toggle, examples expand). Values: array of
  // {character, sino, summary} on success, null on failure / no results.
  // Background.js holds the persistent chrome.storage.local cache.
  const hanjaSession = new Map();

  // Returns the per-character meanings panel when the user has expanded the
  // Hanja pill, otherwise `null`. The expand/collapse affordance now lives on
  // the pill itself (see makeHanjaChip); this function just renders the body.
  function buildHanjaMeaningsNode(origin) {
    if (!origin) return null;
    const chars = [...origin].filter(isHanjaChar).join('');
    if (!chars || !expandedHanja.has(chars)) return null;
    const panel = document.createElement('div');
    panel.className = 'lws-hanja-meanings';
    if (hanjaSession.has(chars)) {
      const cached = hanjaSession.get(chars);
      if (cached && cached.length > 0) renderHanjaMeanings(panel, cached);
      else panel.appendChild(buildHanjaErrorRow());
      return panel;
    }
    // First expansion of this Hanja set — fire the lookup.
    const loading = document.createElement('div');
    loading.className = 'lws-hanja-loading';
    loading.textContent = 'Loading…';
    panel.appendChild(loading);
    chrome.runtime.sendMessage({ type: 'lookupHanja', chars })
      .then((resp) => {
        const hanjas = (resp && !resp.error && Array.isArray(resp.hanjas))
          ? resp.hanjas
          : null;
        hanjaSession.set(chars, hanjas);
        // The panel may have been detached by a subsequent rerender; in that
        // case the rerender path will read from hanjaSession and render the
        // cached value directly.
        if (panel.isConnected) {
          panel.innerHTML = '';
          if (hanjas && hanjas.length > 0) renderHanjaMeanings(panel, hanjas);
          else panel.appendChild(buildHanjaErrorRow());
        }
      })
      .catch(() => {
        hanjaSession.set(chars, null);
        if (panel.isConnected) {
          panel.innerHTML = '';
          panel.appendChild(buildHanjaErrorRow());
        }
      });
    return panel;
  }

  function buildHanjaErrorRow() {
    const row = document.createElement('div');
    row.className = 'lws-hanja-empty';
    row.textContent = 'Could not load Hanja meanings.';
    return row;
  }

  function renderHanjaMeanings(panel, hanjas) {
    for (const h of hanjas) {
      const row = document.createElement('div');
      row.className = 'lws-hanja-row';
      const charUrl = hanjaCharUrl(h.character);
      let charEl;
      if (charUrl) {
        charEl = document.createElement('a');
        charEl.href = charUrl;
        charEl.target = '_blank';
        charEl.rel = 'noreferrer noopener';
        charEl.title = `Hanja breakdown for ${h.character} on hangulhanja.com`;
      } else {
        charEl = document.createElement('span');
      }
      charEl.className = 'lws-hanja-row-char';
      charEl.textContent = h.character;
      row.appendChild(charEl);
      if (h.sino) {
        const sino = document.createElement('span');
        sino.className = 'lws-hanja-row-sino';
        sino.textContent = h.sino;
        row.appendChild(sino);
      }
      if (h.summary) {
        const sum = document.createElement('span');
        sum.className = 'lws-hanja-row-summary';
        sum.textContent = h.summary;
        row.appendChild(sum);
      }
      panel.appendChild(row);
    }
  }

  function makePosChip(hangulWord, pos) {
    // Tooltip explains what the POS means in the user's language. For verb/
    // adjective POS the chip also doubles as a koreanverb.app link; the
    // external-link icon on the chip signals that clickability separately,
    // so the title stays focused on the linguistic meaning.
    const expl = posExplanation(pos, defLang);
    const opts = {};
    const url = koreanVerbUrl(hangulWord, pos);
    if (url) opts.href = url;
    if (expl) opts.title = expl;
    return makeChip(displayPos(pos), 'cyan', opts);
  }

  function makePronChip(word, pronunciation) {
    if (!pronunciation) return null;
    const label = `၊၊||၊ ${pronunciation}`;
    const w = (word || '').trim();
    if (!w) return makeChip(label, 'soft');
    return makeChip(label, 'soft', {
      href: `https://koreanverb.app/pronounce?search=${encodeURIComponent(w)}`,
      title: defLang === 'ko'
        ? `${w} 발음 듣기 — koreanverb.app`
        : `Pronunciation guide for ${w} on koreanverb.app`,
    });
  }

  function displayPos(pos) {
    return defLang === 'en' ? posToEnglish(pos) : pos;
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
    // Reset session size tracking — each new word starts with a fresh popup.
    popupMinHeight = 0;
    popupMinWidth = 0;
    expandedExamples = new Set();
    expandedHanja = new Set();
    relatedExpanded = false;
    activeInsightTab = null;
    if (popupEl) {
      popupEl.style.minHeight = '';
      popupEl.style.minWidth = '';
    }
    showPopup(anchor, buildLoadingNode(surface), { reposition });

    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: 'lookup', surface });
    } catch (err) {
      if (requestId !== pendingRequestId) return;
      showPopup(anchor, buildErrorNode('Extension is reloading. Hover again in a moment.'), { reposition });
      return;
    }
    if (requestId !== pendingRequestId) return;
    if (!response) {
      showPopup(anchor, buildErrorNode('No response from extension.'), { reposition });
      return;
    }
    if (response.error === 'NO_API_KEY') {
      showPopup(anchor, buildErrorNode('Set your KRDict API key to use the dictionary.', {
        label: 'Open settings',
        onClick: () => chrome.runtime.sendMessage({ type: 'openOptions' }).catch(() => {}),
      }), { reposition });
      return;
    }
    if (response.error === 'FETCH_FAILED') {
      showPopup(anchor, buildErrorNode(
        'Couldn\'t reach the dictionary. Hover the word again to retry.',
        null,
        response.message,
      ), { reposition });
      return;
    }
    if (response.error) {
      showPopup(anchor, buildErrorNode(
        'Lookup failed. Hover the word again to retry.',
        null,
        `${response.error}${response.message ? `: ${response.message}` : ''}`,
      ), { reposition });
      return;
    }
    lastPayload = response;
    activeTabIdx = 0;
    const sentence = opts.sentence !== undefined
      ? opts.sentence
      : extractSentence(anchor);
    lastSentence = sentence;
    // Grammar matches are computed lazily — only when the user clicks the
    // Grammar tab. Decomposition uses `payload.tokens` which is already
    // present, so it renders instantly when its tab is clicked.
    showPopup(anchor, buildResultNode(response, { sentence }), { reposition });
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
    // hover at all. preventDefault keeps the click from navigating when the
    // word happens to sit inside an <a> (e.g. linked subtitles).
    if (!enabled) return;
    e.preventDefault();
    e.stopPropagation();
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
          } else if (added.nodeType === 1 && !added.classList.contains(WORD_CLASS) && !added.classList.contains(HOST_CLASS)) {
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
    // teardown on navigation / setting-toggle.
    import(chrome.runtime.getURL(siteConfig.adapter))
      .then((mod) => {
        if (mod && typeof mod.setup === 'function') return mod.setup();
      })
      .catch((err) => console.warn('[learnwithsoju] adapter load failed:', err));
  }

  async function init() {
    const [syncData, localData] = await Promise.all([
      chrome.storage.sync.get([STORAGE_KEYS.DEF_LANG, STORAGE_KEYS.ASK_AI_PROMPT, STORAGE_KEYS.ASK_AI_PROVIDER]),
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
      console.log('[lws] content onChanged', { area, hostDisabled, was: enabled, now: next });
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
      rerenderActivePopup();
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
  });

  init();
})();
