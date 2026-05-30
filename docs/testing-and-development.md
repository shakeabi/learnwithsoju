# Testing and development workflow

How to run the tests, debug the extension, and find your way around
when making changes.

Related reading:
- [CONTRIBUTING.md](../CONTRIBUTING.md) — getting-started recipe
  (install Node, npm test, load unpacked)
- [file-walkthroughs.md](file-walkthroughs.md) — where every file
  lives and what it does
- [LEMMATIZATION.md](LEMMATIZATION.md) — adding a new
  candidate-generation rule (and the test for it)

---

## Running the unit tests

```
npm test
```

Runs `node --test 'tests/**/*.test.js'`. 145 tests today, all
green. Pure-module coverage only — no jsdom, no Chrome stubs.

| File                            | Tests | Covers                                                                                                                          |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| `tests/api.test.js`             | ~30   | URL builders for KRDict / OpenDict; `looksEmpty`; `extractApiError`; `extractItemWords`; `groupByWord`; `pickTabsAndUnrelated`  |
| `tests/cache.test.js`           | ~11   | Two-tier cache: set/get round-trip; namespacing; LRU eviction; clear with and without `getKeys`                                 |
| `tests/grammar-glosses.test.js` | ~11   | `morphemeGloss` three-tier lookup; homograph disambiguation; `isContentMorpheme` filter                                         |
| `tests/lemmatizer.test.js`      | ~29   | Verb / adjective stems; Inflect decomposition; compound nouns; ambiguous-ㄹ guard (5 cases); particle skipping; dedup            |
| `tests/parsers.test.js`         | ~51   | KRDict and OpenDict XML parsing; example extraction; POS translation tables; Hanja URL builders; grade-to-stars                  |

The five pure modules — `core/api.js`, `core/cache.js`,
`core/grammar-glosses.js`, `core/lemmatizer.js`, `core/parsers.js` —
have full coverage of their public
APIs. **Adding a new candidate-generation rule or a new
POS-to-English mapping should always come with a test.**

---

## Files without unit tests

| File                                         | Why no test                                                                                                          |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `content.js`                                 | Touches the DOM, Shadow DOM, chrome.runtime, chrome.storage.onChanged. Would need jsdom + Chrome-API stubs.          |
| `background.js`                              | Service worker; needs `chrome.runtime`, `chrome.storage.local`, `DecompressionStream`, and the WASM analyzer.        |
| `pages/popup/popup.js`, `pages/options/options.js`, `pages/notepad/notepad.js`, `pages/morpheme-inspector/morpheme-inspector.js` | Settings/UI; trivial DOM event handlers. Tested manually.                              |
| `adapters/youtube/adapter.js`, `adapters/youtube/page-hook.js` | Depend on YouTube player's page-world objects, `/api/timedtext` HTTP behavior, and Chrome's main-world injection.    |
| `adapters/netflix/adapter.js`, `adapters/netflix/page-hook.js` | Same story — depend on `window.netflix` + Netflix's TTML/DFXP responses.                                             |
| `core/ai-providers.js`, `core/site-configs.js`         | Data-only modules. Exercised indirectly through the consumers.                                                       |

All are exercised manually in Chrome by hovering Korean words on
real pages.

---

## CI

`.github/workflows/ci.yml`. Three jobs in one workflow:

1. `npm ci && npm test` — run the suite on Node 20.
2. Parse-check every `extension/*.js` with `node --check`. Catches
   syntax errors without trying to actually run the SW code in
   Node.
3. Validate `manifest.json` is valid JSON with
   `python3 -c "import json; json.load(open(...))"`.

The `node --check` syntax pass is the cheapest correctness check
available; run it before committing.

---

## Loading the extension into Chrome / Firefox

1. `chrome://extensions` → enable Developer mode → "Load
   unpacked" → select the `extension/` directory.
2. Open the service worker's DevTools (the "service worker" link
   in the extension's card on `chrome://extensions`) to see
   `background.js` logs.
3. Open page DevTools to see `content.js` / adapter logs.
4. Open the popup with the toolbar icon; right-click → "Inspect"
   to open its DevTools.

For Firefox, `about:debugging#/runtime/this-firefox` → "Load
Temporary Add-on" → select `manifest.json`. Firefox 121+ for MV3
service-worker support.

---

## Debugging tips

### "Wrong lemma" hover result

1. Open the toolbar popup → Notepad link.
2. Paste the surface, hover it.
3. The popup's morpheme breakdown shows the mecab tokens that
   drove the lemma. Click "Advanced" in the options page →
   Morpheme inspector for the full per-field breakdown plus the
   n-best alternative paths and the candidate chips that
   `lemmaCandidatesFromNbest` produced.
4. For the lemma chain itself (candidates / queriesUsed), inspect
   the page DevTools to see the `lookup` response from
   background.

### YouTube dual-subs not engaging

1. Open the page DevTools. Look for `[lws-yt]` and `[lws-yt-diag]`
   logs.
2. The state machine prints transitions on every CC poll —
   `state: CC_OFF → CC_ON — getOption returned=...`.
3. If you see "no Korean track in tracklist", the video genuinely
   has no KO track (`pickPrimarySource` returns null). Auto-
   translated KO is not in the tracklist — only manual + ASR
   are.

### Netflix dual-subs not engaging

1. Open the page DevTools. Look for `[lws-nx-prime]` logs —
   they trace which path succeeded (dance / manifest / manual).
2. If you see `no Korean track in list`, the title has no Korean
   text track at all. Dual-subs without Korean is meaningless and
   the adapter bails by design.
3. The dance can take seconds (3-6 setTextTrack round-trips).
   Be patient before assuming it failed.
4. The diagnostic flags `LWS_NX_DIAG_PRIME` and `LWS_NX_DIAG_API`
   in `adapters/netflix/page-hook.js` enable very verbose probe logging if
   Netflix changes the player API shape and we need to re-
   discover.

### Service worker is slow on first hover

The dict files (~22 MB compressed, ~90 MB raw) gunzip on first
`ensureMecab()` call. To skip the wait:

- Open the SW's DevTools and let it sit idle for 30+ seconds.
- The SW will be killed by Chrome.
- Open it again — `onStartup` fires `ensureMecab()` synchronously,
  so by the time you switch to the page tab, mecab is warm.

content.js's `init()` also sends `warmup` so the first hover after
a fresh SW wake-up still typically only pays the network/cache
fetch cost, not the dict-inflate cost.

---

## Where to make changes for common requests

| User request                                       | What to change                                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Add a new POS-to-English mapping                   | `core/parsers.js` `KOREAN_POS_TO_ENGLISH` + test                                                            |
| Add a morpheme gloss for a new particle            | `core/grammar-glosses.js` `FORM_GLOSSES` + test                                                             |
| Fix a wrong lemma for a specific surface           | `core/lemmatizer.js` candidate ordering + test (see [LEMMATIZATION.md](LEMMATIZATION.md))                   |
| Debug a "wrong lemma" hover result                 | Notepad + Morpheme inspector (see "Debugging tips" above)                                                   |
| Add a new site-specific sentence selector          | `core/site-configs.js` entry                                                                                |
| Auto-pause a page's video on popup open            | `findVideo` in the `core/site-configs.js` entry                                                             |
| Fix hovers being eaten by a player control overlay | `stylesheet` field on the `core/site-configs.js` entry — z-index promo for the caption layer                |
| Replace a site's captions with dual subs           | New `adapters/<site>/adapter.js` + SITE_CONFIGS entry + manifest WAR                                        |
| Add a toolbar-popup section for a site             | New `adapters/<site>/popup.js` + `popupModule` on the SITE_CONFIGS entry                                    |
| Add a new "Ask AI" provider (ChatGPT-style)        | One entry in `core/ai-providers.js` `AI_PROVIDERS`                                                          |
| Add a new persistent setting                       | UI in `pages/options/options.html` / `options.js`; storage onChanged listener in the consumer               |
| Hook a new dictionary API                          | `core/api.js` URL builder + `core/parsers.js` XML parser + `background.js` `handleLookup`                   |
| Change in-page hover-popup look                    | `core/popup-shadow.css`, NOT `pages/popup/popup.css`                                                        |
| Change toolbar popup look                          | `pages/popup/popup.css`                                                                                     |
| Change settings page look                          | `pages/options/options.css`                                                                                 |
| Tweak word scanning (e.g. add a skip tag)          | `content.js` `SKIP_TAGS`                                                                                    |
| Change the default "Ask AI" prompt                 | `DEFAULT_ASK_AI_PROMPT` in BOTH `content.js` and `pages/options/options.js` (kept in sync)                  |

When in doubt, search the codebase for the user-facing string you
see in the popup — almost all rendering goes through
`buildResultNode`, `buildSectionNode`, `buildSenseNode`, `makeChip`,
or `makeHanjaChip`. From there it's one or two hops back to
whichever pure module produced the data.

---

## Design principles for any extension surface

- **Fail open, log a named reason**. When a guard rejects, log
  `[lws] <context>: <why>` and proceed safely. Silent
  `try {…} catch { return; }` blocks have repeatedly hidden real
  bugs in this codebase — an undefined `isKoreanCode()` killed
  dual subs for weeks because the only signal was a quiet `null`
  return. Reserve fail-closed for security boundaries; for
  behavior gates, prefer fail-open with a downstream check.
- **Async guards need generation tokens**. Anything that does
  `deactivate(); await initThing(); mount(...)` needs to handle
  the user / host re-triggering before `initThing()` resolves.
  Bump a counter in every entry-and-exit, compare after each
  `await`, tear down your own work on supersession.
- **No global state hidden in closures**. Adapter and popup module
  parameters (`setup({unwrap, rescan})`,
  `renderSection({tab, href, container})`) are explicit so future
  maintainers can see the contract without grepping for
  who-calls-who.
- **Storage keys are durable**. Once shipped, you can't rename a
  key without migration code. Pick names you can live with — the
  `disabledHosts` array got moved from `sync` to `local` mid-
  flight and we just orphaned the old `sync` value (users had no
  UI to set it, so harmless).
- **Tests cover pure modules** (`core/lemmatizer.js`,
  `core/parsers.js`, `core/grammar-glosses.js`, `core/cache.js`).
  DOM-touching code (`content.js`, `adapters/youtube/adapter.js`,
  `adapters/netflix/adapter.js`, popup files) has no harness —
  be extra careful there.
- **Commit code + docs together**. When a behavior change lands,
  the matching doc update goes in the same commit. The split
  topic docs make this easier: usually only one or two files need
  to change.

---

## Common gotchas

A grab bag of things that bit us during development and would bite
a new contributor too.

### Isolated world vs page main world

Content scripts run in an "isolated world" — same DOM as the page,
but a separate global scope. You can read element attributes,
observe mutations, register event listeners. You CANNOT see:

- Page-script-created expandos on `window` or DOM elements (e.g.
  `html5VideoPlayer.getOption` is a YouTube player expando).
- Page-script monkey-patches of built-ins (the page's own `fetch`
  override isn't visible from the isolated world).
- Page-script-defined custom elements' shadow DOMs (mode: closed).

To bridge: inject a `<script src=chrome-extension://.../...>` tag
and communicate via `window.postMessage`. That's what
`adapters/youtube/page-hook.js` and
`adapters/netflix/page-hook.js` exist for.

### `chrome.storage.session` is forbidden in content scripts

`chrome.storage.session` is gated to "trusted contexts" by default
in MV3. From a content script, calls to `session.get/set` throw
silently. We use `chrome.storage.local` for per-video YouTube
overrides and per-title Netflix overrides for this reason — it's
unrestricted and persists across browser restarts.

### Mecab dict is heavy; lazy is mandatory

The dict is ~22 MB compressed, ~90 MB raw. Loading it eagerly in
`background.js` top-level would make the SW unkillable for ~2 s on
every wake-up. We init lazily on first `lookup` request (with
warmup nudges from `onInstalled`, `onStartup`, and content.js
init).

If you're tempted to load it eagerly via top-level `await`, don't
— the MV3 SW lifecycle is hostile to long startup. The SW will be
killed by the browser for "taking too long to start" on slow
machines.

### Popup uses Shadow DOM with adopted styles

The popup is mounted into a Shadow Root attached to a host div at
`document.documentElement`. Its styles come from a
`<link rel=stylesheet>` loaded from
`chrome.runtime.getURL('core/popup-shadow.css')`.

Why Shadow DOM: page CSS leaks into anything in the light DOM.
Sites that have aggressive `* { ... }` rules or that target
generic class names would otherwise mangle our popup. The shadow
root gives us a clean styling context.

Side effect: keyboard events bubble up through the shadow root as
normal, so global page hotkeys still work. But CSS does NOT
inherit through the shadow boundary — anything the popup needs
has to be declared in `core/popup-shadow.css`.

### The video-pause flag dance

When the popup opens on a video page, we auto-pause the video.
When the popup closes, we auto-resume IF we're the ones who paused
it. The play/pause state changes also fire `pause` events —
including our own programmatic `video.pause()` call. So:

- `suppressNextPauseEvent` swallows exactly one event (the one our
  own `.pause()` emits).
- Any subsequent `pause` event is the user clicking pause again —
  they want it stopped, so we set `resumeVideoOnHide = false` to
  skip the auto-resume.

### core/popup-shadow.css `position: absolute`, not `fixed`

The popup is `position: absolute` against the host div anchored at
`(0, 0)` on `document.documentElement`. When the user scrolls the
page, the popup scrolls with it — by design. If a tab click grows
the popup past the viewport edge, the user can scroll the page to
read the rest, instead of being stuck with content clipped off-
screen.

The flip side is that `positionPopup` has to compute viewport
coords (for the initial fit clamps) and THEN convert to document
coords (`+ window.scrollX/Y`) before writing. Get that wrong and
the popup either lands in the wrong place or mysteriously moves on
scroll.

### Multi-frame: only top-level frames are scanned

`manifest.json` has `all_frames: false`, so `content.js` only runs
in the top-level frame of each tab. Iframes (ads, embedded media,
cross-origin widgets) don't get the dictionary. This is deliberate
— many embeds use Korean text in their controls / branding and
showing the popup over an ad is jarring.

### Popup minimum-size monotonic growth

`popupMinHeight` and `popupMinWidth` start at 0 on every fresh
lookup (reset in `performLookup`). After every show,
`requestAnimationFrame` captures the actual rendered size and
bumps the min-size memos UPWARD only. The popup grows as the user
clicks tabs and expands sections; it never shrinks. The cursor
stays inside the popup boundary across the entire interaction. If
the user moves to a new word and triggers a fresh lookup, the
memos reset.

### YouTube and Netflix audio-language detection (don't add it)

See the postmortem in [site-adapters.md](site-adapters.md). Short
version: it went through three iterations and we eventually
deleted it entirely. The current behaviour is "engage dual subs if
there's any Korean track in the list" — equivalent in effect, far
simpler to reason about.
