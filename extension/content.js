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
  const STORAGE_KEYS = { ENABLED: 'enabled', DEF_LANG: 'defLang' };
  const DEF_LANG_DEFAULT = 'en';

  const parsers = await import(chrome.runtime.getURL('parsers.js'));
  const {
    parseKrdictXml,
    parseOpendictXml,
    filterTranslations,
    gradeToStars,
    gradeToTooltip,
    posToEnglish,
    posToShortform,
    hangulHanjaUrl,
    hangulHanjaSlug,
  } = parsers;

  let enabled = true;
  let defLang = DEF_LANG_DEFAULT;
  let popupHost = null;
  let popupRoot = null;
  let popupEl = null;
  let activeWordEl = null;
  let lastPayload = null;
  let activeTabIdx = 0;
  let popupMinHeight = 0;
  let popupMinWidth = 0;
  let expandedExamples = new Set();
  let hideTimer = null;
  let hoverTimer = null;
  let pendingRequestId = 0;

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

  function ensurePopup() {
    if (popupHost) return;
    popupHost = document.createElement('div');
    popupHost.className = HOST_CLASS;
    popupHost.style.all = 'initial';
    popupHost.style.position = 'fixed';
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

    popupEl.addEventListener('mouseenter', cancelHide);
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
    hideTimer = setTimeout(hidePopup, HIDE_DELAY_MS);
  }

  function hidePopup() {
    if (popupEl) {
      popupEl.style.display = 'none';
      popupEl.innerHTML = '';
    }
    activeWordEl = null;
    pendingRequestId++;
  }

  function positionPopup(target) {
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

    popupEl.style.left = `${Math.max(0, left)}px`;
    popupEl.style.top = `${Math.max(0, top)}px`;
  }

  function showPopup(target, contentNode) {
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
    requestAnimationFrame(() => {
      // After paint, capture the actual rendered size so future renders can't
      // shrink below it. Monotonic non-decreasing for the popup's lifetime.
      const h = popupEl.offsetHeight;
      const w = popupEl.offsetWidth;
      if (h > popupMinHeight) popupMinHeight = h;
      if (w > popupMinWidth) popupMinWidth = w;
      positionPopup(target);
    });
  }

  function buildLoadingNode(surface) {
    const div = document.createElement('div');
    div.className = 'lws-popup-body lws-loading';
    div.textContent = `Looking up ${surface}…`;
    return div;
  }

  function extractSentence(wordEl) {
    let block = wordEl.parentElement;
    while (block && !SENTENCE_BLOCK_TAGS.has(block.tagName)) {
      const next = block.parentElement;
      if (!next || next === document.body || next === document.documentElement) {
        // Fall back to a div with a reasonable amount of text, but never the body itself.
        if (block.tagName === 'DIV' && block !== document.body) break;
        return null;
      }
      block = next;
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

  function buildSentenceNode(sentence) {
    const wrap = document.createElement('div');
    wrap.className = 'lws-sentence';
    const label = document.createElement('span');
    label.className = 'lws-sentence-label';
    label.textContent = 'Given sentence';
    wrap.appendChild(label);
    const body = document.createElement('div');
    body.className = 'lws-sentence-text';
    body.appendChild(document.createTextNode(sentence.before));
    const hit = document.createElement('span');
    hit.className = 'lws-sentence-hit';
    hit.textContent = sentence.word;
    body.appendChild(hit);
    body.appendChild(document.createTextNode(sentence.after));
    wrap.appendChild(body);
    return wrap;
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

  function buildResultNode(payload, options = {}) {
    const root = document.createElement('div');

    const krEntries = parseKrdictXml(payload.krXml, DOMParser);
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

    if (krEntries.length > 1) {
      if (activeTabIdx >= krEntries.length) activeTabIdx = 0;
      root.appendChild(buildTabBar(krEntries));
      root.appendChild(buildKrEntryNode(krEntries[activeTabIdx]));
    } else if (krEntries.length === 1) {
      root.appendChild(buildKrEntryNode(krEntries[0]));
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

  function buildTabBar(entries) {
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
    const sentence = extractSentence(activeWordEl);
    showPopup(activeWordEl, buildResultNode(lastPayload, { sentence }));
  }

  function buildKrEntryNode(entry) {
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
    if (entry.pos) meta.appendChild(makeChip(displayPos(entry.pos), 'cyan'));
    if (entry.pronunciation) meta.appendChild(makeChip(`[${entry.pronunciation}]`, 'soft'));
    if (entry.origin) meta.appendChild(makeHanjaChip(entry.word, entry.origin));
    if (meta.children.length) wrap.appendChild(meta);

    if (entry.senses.length > 0) {
      const senses = document.createElement('div');
      senses.className = 'lws-senses';
      const showMultiple = entry.senses.length > 1;
      entry.senses.forEach((sense, i) => {
        const senseId = `kr:${activeTabIdx}:${i}`;
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
      if (entry.pos) meta.appendChild(makeChip(displayPos(entry.pos), 'cyan'));
      if (entry.origin) meta.appendChild(makeHanjaChip(entry.word, entry.origin));
      wrap.appendChild(meta);
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

  function makeChip(text, variant, opts = {}) {
    const chip = document.createElement(opts.href ? 'a' : 'span');
    chip.className = `lws-chip lws-chip-${variant}` + (opts.href ? ' lws-chip-link' : '');
    chip.textContent = text;
    if (opts.href) {
      chip.href = opts.href;
      chip.target = '_blank';
      chip.rel = 'noreferrer noopener';
    }
    if (opts.title) chip.title = opts.title;
    return chip;
  }

  function makeHanjaChip(hangulWord, origin) {
    const url = hangulHanjaUrl(hangulWord, origin);
    if (url) {
      const slug = hangulHanjaSlug(hangulWord, origin);
      return makeChip(origin, 'amber', {
        href: url,
        title: `Hanja breakdown for ${slug}`,
      });
    }
    return makeChip(origin, 'amber');
  }

  function displayPos(pos) {
    return defLang === 'en' ? posToEnglish(pos) : pos;
  }

  async function performLookup(target) {
    const surface = target.dataset.surface;
    if (!surface) return;
    const requestId = ++pendingRequestId;
    // Reset session size tracking — each new word starts with a fresh popup.
    popupMinHeight = 0;
    popupMinWidth = 0;
    expandedExamples = new Set();
    if (popupEl) {
      popupEl.style.minHeight = '';
      popupEl.style.minWidth = '';
    }
    showPopup(target, buildLoadingNode(surface));

    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: 'lookup', surface });
    } catch (err) {
      if (requestId !== pendingRequestId) return;
      showPopup(target, buildErrorNode('Extension is reloading. Hover again in a moment.'));
      return;
    }
    if (requestId !== pendingRequestId) return;
    if (!response) {
      showPopup(target, buildErrorNode('No response from extension.'));
      return;
    }
    if (response.error === 'NO_API_KEY') {
      showPopup(target, buildErrorNode('Set your KRDict API key to use the dictionary.', {
        label: 'Open settings',
        onClick: () => chrome.runtime.sendMessage({ type: 'openOptions' }).catch(() => {}),
      }));
      return;
    }
    if (response.error === 'FETCH_FAILED') {
      showPopup(target, buildErrorNode(
        'Couldn\'t reach the dictionary. Hover the word again to retry.',
        null,
        response.message,
      ));
      return;
    }
    if (response.error) {
      showPopup(target, buildErrorNode(
        'Lookup failed. Hover the word again to retry.',
        null,
        `${response.error}${response.message ? `: ${response.message}` : ''}`,
      ));
      return;
    }
    lastPayload = response;
    activeTabIdx = 0;
    const sentence = extractSentence(target);
    showPopup(target, buildResultNode(response, { sentence }));
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

  function attachWordHandlers(root = document.body) {
    if (!root) return;
    root.addEventListener('mouseenter', delegateEnter, true);
    root.addEventListener('mouseleave', delegateLeave, true);
  }

  function delegateEnter(e) {
    const t = e.target;
    if (t && t.classList && t.classList.contains(WORD_CLASS)) onWordEnter(t);
  }
  function delegateLeave(e) {
    const t = e.target;
    if (t && t.classList && t.classList.contains(WORD_CLASS)) onWordLeave();
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

  async function init() {
    const stored = await chrome.storage.sync.get([STORAGE_KEYS.ENABLED, STORAGE_KEYS.DEF_LANG]);
    enabled = stored[STORAGE_KEYS.ENABLED] !== false;
    defLang = stored[STORAGE_KEYS.DEF_LANG] === 'ko' ? 'ko' : DEF_LANG_DEFAULT;
    if (!enabled) return;
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', init, { once: true });
      return;
    }
    scanRoot(document.body);
    attachWordHandlers(document.body);
    setupMutationObserver();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (STORAGE_KEYS.ENABLED in changes) {
      const next = changes[STORAGE_KEYS.ENABLED].newValue !== false;
      if (next && !enabled) {
        enabled = true;
        scanRoot(document.body);
      } else if (!next && enabled) {
        enabled = false;
        hidePopup();
      }
    }
    if (STORAGE_KEYS.DEF_LANG in changes) {
      const next = changes[STORAGE_KEYS.DEF_LANG].newValue;
      defLang = next === 'ko' ? 'ko' : DEF_LANG_DEFAULT;
      rerenderActivePopup();
    }
  });

  init();
})();
