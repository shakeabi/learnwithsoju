# Korean Popup Dictionary — Browser Extension Build Prompt

## Context

I want to build a Chrome/Firefox browser extension that shows a popup dictionary when I hover over Korean words on any webpage. It is inspired by Kimchi Reader but stripped down to just the core popup feature — no account, no tracking, no backend, no Anki. Purely frontend, runs entirely in the browser.

This prompt contains everything you need to build it in one session.

---

## What the Extension Should Do

When I visit any webpage containing Korean text:

1. The extension detects Korean text on the page
2. It wraps individual Korean words in hoverable spans (without breaking page layout)
3. When I hover over a word, a floating popup appears showing:
   - **Word** (the dictionary/base form / lemma)
   - **Pronunciation** in Hangul (from KRDict data)
   - **Star frequency** (★★★ = beginner, ★★ = intermediate, ★ = advanced)
   - **English definition(s)** from KRDict (primary)
   - **Korean monolingual definition** from StDict (secondary / toggle)
   - **Hanja** if applicable — each character with its meaning
   - **Part of speech** label (noun, verb, adjective, etc.)
4. The popup disappears when I move the mouse away
5. A small extension icon in the toolbar lets me toggle the extension on/off for the current tab

---

## Technical Requirements

### Architecture: 100% Frontend, No Backend

- Pure browser extension (Manifest V3)
- No server, no login, no database
- All logic runs in content scripts injected into the page
- Dictionary data fetched live from free public APIs (KRDict + StDict)
- Lemmatization runs client-side using a JS/WASM library

### Target Browsers
- Chrome (primary)
- Firefox (secondary — same codebase with minor manifest differences if needed)

### File Structure
```
/extension
  manifest.json          ← Manifest V3
  content.js             ← Main logic: text detection, word wrapping, popup
  popup.html             ← Toolbar popup (on/off toggle UI)
  popup.js               ← Toggle logic
  style.css              ← Popup styles (injected into pages)
  icons/
    icon16.png
    icon48.png
    icon128.png
```

Keep it as few files as possible. No build step, no npm, no bundler. Vanilla JS only — it should work by just loading the unpacked extension folder in Chrome.

---

## APIs to Use

### 1. KRDict API (Primary — Free)
- **Get an API key at:** https://krdict.korean.go.kr/openApi/openApiInfo
- **Endpoint:** `https://krdict.korean.go.kr/api/search`
- **Key params:** `key=YOUR_KEY`, `q=WORD`, `part=word`, `translated=y`, `trans_lang=1` (English)
- Returns: definitions, pronunciation, part of speech, star frequency (★), hanja
- The API key field in the code should be a constant at the top of content.js: `const KRDICT_API_KEY = 'YOUR_KEY_HERE';`

### 2. StDict API (Secondary — Korean monolingual)
- **Endpoint:** `https://stdict.korean.go.kr/api/search.do`
- Use as fallback when KRDict has no result, or as a toggleable secondary view in the popup
- Same free key registration at NIKL (same account as KRDict)

### API Notes
- Both APIs return XML. Parse with `DOMParser`.
- Cache results in a `Map` (in-memory, per page session) to avoid re-fetching the same word.
- On API error or no result: show a minimal popup with just the raw word and "No definition found".

---

## Lemmatization (V1 — Keep It Simple)

Korean words on a page appear in inflected/conjugated form (e.g. 먹었어요 = "ate"), not dictionary form (먹다 = "to eat"). For V1, do NOT implement a full morphological analyzer — it adds complexity and the majority of words learners look up are nouns, which need no lemmatization at all.

### V1 Strategy: Try the surface form first, strip endings as fallback

```js
function getLemma(word) {
  // Step 1: try the word exactly as it appears
  // Step 2: strip common verb/adjective endings (아요, 어요, 었어요, 습니다, etc.)
  // Step 3: try progressively shorter versions (word.slice(0, -1), word.slice(0, -2))
  // Return whichever attempt gets a KRDict hit
}
```

This handles nouns perfectly and catches many common verb forms. Accept that conjugated verbs will sometimes miss — that's fine for a weekend build.

### Fallback chain
1. Raw surface form as-is
2. Strip last 1 character
3. Strip last 2 characters
4. Show "No definition found" gracefully

> **Note:** Full lemmatization is a planned future improvement — see the Future Steps section at the bottom of this document.

---

## Word Detection & Wrapping

### Korean Unicode Range
Korean characters fall in these ranges:
- Hangul syllables: `\uAC00–\uD7A3`
- Hangul Jamo: `\u1100–\u11FF`
- Hangul Compatibility Jamo: `\u3130–\u318F`

### Text Node Processing
- Walk the DOM using a `TreeWalker` targeting `TEXT_NODE`s
- Skip nodes inside `<script>`, `<style>`, `<textarea>`, `<input>`, `<code>`, `<pre>`
- For each text node containing Korean, split into segments: Korean words vs non-Korean text
- Wrap Korean segments in `<span class="kr-word">` with `data-surface="originalText"`
- Replace the original text node with the new mixed content
- Use `requestIdleCallback` or process in chunks to avoid freezing the page on large articles

### Hover Behavior
- Listen for `mouseenter` on `.kr-word` spans
- On hover: lemmatize the `data-surface` value, query KRDict, render popup
- Position the popup near the word (below it, flipping above if near viewport bottom)
- On `mouseleave` from both the word AND the popup: hide popup (with ~100ms delay to allow moving mouse into popup)

---

## Popup UI Design

The popup should look clean and minimal. Approximate layout:

```
┌─────────────────────────────────────────┐
│  먹다  [동사]  ★★★                       │
│  meok-da                                │
├─────────────────────────────────────────┤
│  🇬🇧  to eat; to have a meal            │
│       (of food or drink) to ingest...   │
├─────────────────────────────────────────┤
│  漢字  食 (먹을 식) — to eat, food       │
├─────────────────────────────────────────┤
│  [Korean ↕]                             │
└─────────────────────────────────────────┘
```

- Dark background (dark mode friendly): `#1e1e2e` background, white text
- Max width: 320px
- Soft rounded corners, subtle drop shadow
- The `[Korean ↕]` button at the bottom toggles the StDict Korean monolingual definition
- `z-index: 2147483647` (maximum, so it appears above all page content)
- The popup should NOT trigger its own mouseleave when moving into it from the word span

---

## Extension Toolbar Popup (popup.html)

Simple toggle UI:
- Title: "Korean Dictionary"
- Toggle switch: Enable / Disable on this tab
- State persists via `chrome.storage.local`
- When disabled, existing `.kr-word` spans are still there but hover does nothing (or unwrap them)

---

## Performance Considerations

- Debounce lemmatization: don't fire on every pixel of mouse movement, only on stable hover (50ms delay)
- Cache: `const definitionCache = new Map();` keyed by lemma string
- Don't process the entire DOM at once on large pages — use chunked processing with `setTimeout(..., 0)` between batches of 100 nodes
- The popup element should be a single persistent `<div id="kr-popup">` that gets repositioned and repopulated, not recreated each time

---

## What NOT to Build

- No Anki integration
- No vocabulary tracking / word status (unknown/seen/known)
- No user accounts or sync
- No content recommendations
- No subtitle injection for YouTube/Netflix
- No sentence mining
- No backend or server of any kind

---

## Known Hard Parts (Heads Up)

1. **Lemmatization accuracy** — Korean verb/adjective conjugations are complex. The first version will miss some edge cases. That's okay — nouns (which learners look up most) need no lemmatization at all.

2. **DOM mutation** — SPAs (single page apps) update the DOM after initial load. Consider a `MutationObserver` to re-process newly added text nodes.

3. **Cross-origin API calls** — KRDict API must be listed under `host_permissions` in manifest.json or calls will be blocked by CORS.

4. **XML Parsing** — KRDict returns XML, not JSON. Use `new DOMParser().parseFromString(text, 'text/xml')` and query with `getElementsByTagName`.

---

## Deliverable

Produce all files needed to load the extension as an unpacked Chrome extension:

- `manifest.json`
- `content.js`
- `style.css`
- `popup.html`
- `popup.js`
- Brief `README.md` with: how to get KRDict API key, how to load the extension in Chrome, known limitations

The code should work out of the box after the user inserts their KRDict API key into `content.js`.

---

## Testing Instructions (for you to verify it works)

After building, confirm the extension handles:
- [ ] A plain Korean noun (e.g. 사람, 학교) — should show definition immediately
- [ ] A conjugated verb (e.g. 먹었어요) — V1 may not fully resolve; fallback to surface or truncated form is acceptable
- [ ] A mixed Korean/English page — should only wrap Korean segments
- [ ] Rapid mouse movement across many words — should not lag or create duplicate popups
- [ ] A word not in KRDict — should show graceful fallback
- [ ] Near the bottom of the viewport — popup should flip above the word

---

## Future Steps (Post-Weekend)

Once the core popup is working, these are the natural next improvements in rough priority order:

### 1. Proper Lemmatization with mecab-ko-wasm
The biggest quality-of-life upgrade. Replace the simple suffix stripper with a real morphological analyzer running in the browser via WebAssembly.

- **Library:** `mecab-ko-wasm` — a WASM build of MeCab-Ko
- **How it works:** `mecab.morphs("먹었어요")` → `["먹", "었", "어요"]`, then reconstruct the verb stem `먹다`
- **Integration:** load the WASM file as an extension asset, initialize once on content script startup, then use synchronously per hover
- **Why it's deferred:** the WASM binary adds ~5–10MB to the extension and requires a bundling step or careful asset loading — not worth the complexity for a first build

### 2. Grammar Decomposition
Show how a word is morphologically broken down (stem + endings). The data for this exists as an open-source dataset at `github.com/Alaanor/kimchi-grammar` — it's the same one Kimchi Reader uses and is freely available.

### 3. MutationObserver for SPAs
Currently the extension only processes text nodes present at page load. Adding a `MutationObserver` would make it work on dynamically loaded content (Twitter/X feeds, YouTube comments, etc.).

### 4. Firefox Support
The codebase will be ~95% identical. The main differences are in `manifest.json` (use `browser_action` instead of `action`, adjust `host_permissions` format) and replacing `chrome.*` API calls with `browser.*` or a polyfill.

### 5. Pronunciation Audio
KRDict links to audio files for many words. These could be played on click of the pronunciation text in the popup, giving a real listening component.

### 6. YouTube / Netflix Subtitles
Injecting the popup dictionary into subtitle text on streaming sites. Requires matching the subtitle DOM for each platform separately — YouTube is the easiest starting point.

---

*Generated from a research session on May 2026. Build target: Chrome Manifest V3, vanilla JS, no bundler.*
