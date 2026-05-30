# Extension surfaces — popup, options, notepad, inspector

The four extension-context HTML pages that ship with the extension.
None of them touch host webpage DOM (that's `content.js`'s job).

Related reading:
- [file-walkthroughs.md](file-walkthroughs.md) — per-file purpose +
  module-level state
- [storage-and-caching.md](storage-and-caching.md) — every storage
  key these surfaces read/write
- [site-adapters.md](site-adapters.md) — what the per-site popup
  modules talk to

---

## Toolbar popup (`popup.html` / `popup.js` / `popup.css`)

The panel that opens when the user clicks the extension's toolbar
icon. Four sections, top to bottom:

### Per-site toggle

Shown only on `http(s):` pages. `resolveActiveSite()` reads the
active tab's hostname via `chrome.tabs.query` first, falling back
to a `lws-site-info` message to the content script (which always
knows `window.location`). The toggle reads/writes membership in
`disabledHosts` (a `chrome.storage.local` array). When flipped, the
content script's `onChanged` listener for `disabledHosts`
activates/deactivates immediately; site adapters react too. There
is no global hover-dictionary toggle — for "off everywhere", use
`chrome://extensions`.

### Per-site adapter section

Generic shell. `loadAdapterSection()` resolves the active tab's
hostname against `findSiteConfig(...)` from `site-configs.js`, and
if the matched config declares a `popupModule`, dynamic-imports
that module and calls `renderSection({ tab, href, container })`.
The module owns all DOM under `<section id="site-adapter-section">`
and is responsible for `container.hidden = false`. Currently:

- `youtube-popup.js` for `youtube.com`
- `netflix-popup.js` for `netflix.com`

### Links row

Left-aligned inline-SVG icons at the bottom of the popup. Always-
present icons baked into `popup.html`:

- **Notepad** — `href` resolved at popup-open time via
  `chrome.runtime.getURL('notepad.html')`.
- **Settings** — gear `<button>` wired to
  `chrome.runtime.openOptionsPage()`.

External links (GitHub, Discord) live in a `LINKS` dict at the top
of `popup.js`: a non-empty URL renders an active `<a>`, an empty
string renders a greyed placeholder.

### Ko-fi support banner

Full-width red button below the links row. Gated by `LINKS.kofi`:
empty string leaves it dimmed and non-interactive; setting a URL
flips it to an active link.

### `youtube-popup.js`

Popup-side counterpart to `youtube-adapter.js`. Exports
`renderSection({ tab, href, container })`:

1. Returns silently if the tab isn't on `/watch`.
2. Renders an italic "Asking the page…" status line and unhides the
   container so the user sees something while waiting.
3. Sends `lws-yt-popup-info` to the active tab; the adapter
   responds with `{ tracks, secondaryLang, ... }`.
4. Replaces the status line with a single `<select>` (label
   "Secondary") containing every distinct non-Korean language in
   the tracklist. ASR-only tracks get an `(auto)` suffix; the
   user's currently-selected secondary, if not natively in the
   tracklist, is surfaced as `(translated)`. Final option is `Off`.
5. Writes the per-video selection to
   `chrome.storage.local.dualSubsOverrides`; the adapter's
   `onChanged` listener picks it up and re-activates without a
   direct message.

### `netflix-popup.js`

Mirror of `youtube-popup.js` for Netflix. Exports `renderSection`:

1. Returns silently if the tab isn't on `/watch/*`.
2. Sends `lws-nx-popup-info` to the active tab; the adapter
   responds with the captured-so-far tracks list (CC variants get a
   `(CC)` suffix) and the current `secondaryLang`.
3. Renders a Secondary Subs dropdown — every non-Korean language
   captured so far.
4. Writes the per-title selection to
   `chrome.storage.local.dualSubsOverridesNetflix[titleId]`. The
   adapter's `onChanged` listener re-kicks the prime dance for the
   newly chosen secondary (cheap when Netflix has already loaded
   the track in the same session) and re-renders the overlay. No
   full deactivate/activate — captured tracks stay; only the choice
   of which one renders as line 2 changes.

---

## Options page (`options.html` / `options.js` / `options.css`)

Linked from the popup (gear icon) and from `chrome://extensions`
via the manifest's `options_page` field. Sections:

### API keys

KRDict (required) + OpenDict (optional, experimental). Both inputs
are `type="password"`. A "Test KRDict key" button hits the real API
with `q=사람` and surfaces the error code or success.

### Behaviour

- Dual-subs toggle (YouTube) — writes `dualSubsYouTube` (sync)
- Dual-subs toggle (Netflix) — writes `dualSubsNetflix` (sync)
- Default secondary language dropdown — writes `secondaryLang`
  (sync)

### Advanced (collapsible)

- **Ask AI prompt template** textarea + "Reset to default" button.
  Auto-saves to `askAiPrompt` (sync) on blur. Saving an empty value
  or the default text removes the key so the live default re-
  applies.
- **AI provider** `<select>` populated dynamically from
  `ai-providers.js` and bound to `askAiProvider` (sync). When the
  selected provider is ChatGPT, a "Use temporary (ephemeral)
  ChatGPT chats" checkbox appears (hidden otherwise) and is bound
  to `askAiChatGptTemporary` (sync); when checked, `buildAskAiUrl`
  appends `?temporary-chat=true`.
- **Morpheme inspector link** — opens `morpheme-inspector.html` in
  a new tab. `href` resolved via `chrome.runtime.getURL` at load.

### Cache

Three buttons, each with a live `(~N)` entry count refreshed via
the `cacheCounts` RPC:

- **Clear lookup cache** — wipes `lookup:` only
- **Clear Hanja cache** — wipes `hanja:` only
- **Clear all caches** — wipes all four namespaces

After every action, `refreshCacheCounts()` re-reads the counts and
re-labels the buttons. See [storage-and-caching.md](storage-and-caching.md)
for the four-namespace layout and [message-flows.md](message-flows.md)
for the wire shape of `clearCache` / `cacheCounts`.

### Settings propagation

Every settings change is written to `chrome.storage.sync` and
propagates to all content scripts via the `onChanged` event — no
direct messaging from the options page. The options page is plain
settings — paste-a-word lookup has moved to its own Notepad page
(see below), so `options.html` no longer embeds `content.js` or
`content.css`.

---

## Notepad (`notepad.html` / `notepad.js`)

Standalone extension page reached from the toolbar popup's links
row. Two cards:

### "Paste text"

A `<textarea>` autofocused on landing. There are **no Add/Clear
buttons**: `notepad.js` wires the textarea's `input` event to set
`target.textContent = input.value` with a 150 ms debounce, so
Korean words wrap and become hoverable within ~150 ms of the user
stopping typing.

### "Hoverable text"

A target `<div>` with `white-space: pre-wrap` so paragraph breaks
from the paste survive. `content.js`'s mutation observer wraps each
Korean run in a `.lws-word` span, and the regular in-page hover
popup machinery takes over — same dictionary popup the user gets on
any webpage.

The target div carries the class `lws-sentence-root`;
`extractSentence` in `content.js` treats the nearest
`.lws-sentence-root` ancestor as the **hard ceiling** when walking
up the DOM, so the sentence context is scoped to the typed text
only and never includes sibling instruction text in the same card.

The page links `content.css` (for the `.lws-word` underline) and
loads `content.js` as a plain `<script src>` at the bottom — its
`chrome.*` calls and dynamic imports work identically in extension
and content-script contexts. `findSiteConfig(extensionHost)`
returns null so no site adapter loads.

No persistence — the paste is ephemeral, and a page refresh resets
everything.

---

## Morpheme inspector (`morpheme-inspector.html` / `.js` / `.css`)

Developer / curious-learner tool reached from the options page's
Advanced section. A single textarea drives a live analysis (200 ms
debounce) that sends `{ type: 'mecab-inspect', text, nbest: 5 }` to
the background service worker. The response carries three fields:

- `singlePath` — the 1-best tokenization
- `nbestPaths` — up to 5 alternative paths with cost
- `candidates` — the flat deduplicated lemma list that
  `lemmaCandidatesFromNbest` would feed to KRDict

These are rendered as three cards:

### Single best path

An HTML table with columns: Surface, POS, Type, First pos,
Last pos, Decomp, Reading, Full features. The features column is
monospace and truncated with an ellipsis; hovering reveals the full
CSV via `title`.

### N-best paths

One collapsible `<details>` card per path. Path 0 is open by
default; the rest are collapsed. Each card's body uses the same
table layout as the single-best card.

### Lemma candidates

The flat string list from `lemmaCandidatesFromNbest` rendered as
accent-coloured chips; these are exactly the strings that would be
queried against KRDict.

The background `mecab-inspect` handler re-uses `ensureMecab()`
(same lazy-init path as the lookup pipeline) and a `serializeToken`
helper that extracts the four sub-fields from the raw features CSV
(type at index 4, first_pos at 5, last_pos at 6, decomp at 7). The
page does NOT load `content.js` — it needs no hover popup
machinery; it's a pure data inspector.
