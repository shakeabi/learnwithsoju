# learnwithsoju

A free, OSS Chrome/Firefox extension that adds a hover-popup Korean dictionary to any webpage. Pure frontend — your queries go to the official KRDict and OpenDict APIs, and nothing else leaves the browser.

> Inspired by [Kimchi Reader](https://kimchi-reader.app), stripped to the core hover lookup.

## Features

- Hover any Korean word, see the dictionary entry inline.
- Heuristic lemmatizer that recovers dictionary forms from common particle suffixes and verb endings (e.g. `학교에서` → `학교`, `먹었어요` → `먹다`). See [Lemmatization quality](#lemmatization-quality) below.
- KRDict (with English translations) as primary dictionary; OpenDict (우리말샘) as optional **experimental** fallback for words KRDict doesn't cover.
- No backend, no telemetry, no tracking.

## Install (developer / unpacked)

1. Clone this repo.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and pick the `extension/` folder.
4. Click the extension icon → **Open settings** → paste your API key(s).

## Get an API key

Both APIs are free and run by the National Institute of Korean Language (NIKL). The same NIKL account can register both keys.

| Dictionary | Get a key | Required? |
|---|---|---|
| KRDict (한국어기초사전) | <https://krdict.korean.go.kr/openApi/openApiInfo> | yes |
| OpenDict (우리말샘) | <https://opendict.korean.go.kr/service/openApiRegister> | optional, **experimental** (fallback when KRDict has no result) |

KRDict approval is usually instant. **OpenDict registration may require a Korean phone number for SMS verification** — that's why it's tagged optional/experimental in the settings page. The OpenDict integration is wired up so the moment you have a key, it works as a fallback.

## How it works

```
hover Korean word
   │
content.js (per tab)
   │  surface form (e.g. 먹었어요)
   ▼
background.js (service worker)
   ├─ lemmatizer.js → candidate dictionary forms [먹다, 먹었, 먹]
   ├─ try each against KRDict /api/search → XML
   └─ fall back to OpenDict /api/search → XML if no KRDict hit (experimental)
   │
   ▼
content.js parses XML, renders popup inside a Shadow DOM
```

Extension footprint is tiny (~30 KB code total — no WASM, no model files in V1).

## Lemmatization quality

V1 uses a heuristic suffix stripper in `extension/lemmatizer.js`. It generates a list of candidate dictionary forms by stripping common particles (`에서`, `이/가`, `을/를`, etc.) and verb/adjective endings (`습니다`, `어요`, `었어요`, etc.), and tries each candidate against KRDict in order.

What this **handles well:**
- Plain nouns (`사람`, `학교`) — the surface form *is* the dictionary form.
- Inflected nouns (`학교에서`, `친구들이`) — particle gets stripped.
- Regular verb conjugations (`먹었어요` → `먹다`, `갔습니다` → `가다`).

What it **misses:**
- Irregular verbs and adjectives where the stem itself changes (e.g. `예뻐요` should resolve to `예쁘다` but the suffix stripper only gets to `예뻐`).
- Compound endings the table doesn't cover.
- Distinguishing homographs.

**V2 plan:** swap the lemmatizer for a real morphological analyzer. The interface in `lemmatizer.js` (`lemmaCandidates(surface) => string[]`) stays the same; only the implementation changes. Two viable swap-in libraries:

- **mecab-ko-wasm** — would be ideal (small WASM, fast, MIT/Apache-2.0). Currently the upstream npm release ships the analyzer engine only — the dictionary is missing — so `new Mecab()` errors at runtime in the browser. Would need to fork and rebuild from Rust source with `mecab-ko-dic` embedded.
- **kiwi-nlp (Kiwi)** — best-in-class accuracy. ~3.8 MB WASM + ~84 MB model. Its wasm-bindgen output uses `new Function()` which MV3 CSP blocks in extension pages, so it needs a sandboxed iframe inside an offscreen document. Adds an extra messaging hop but works.

## Permissions

- `storage` — to remember your API keys and the on/off toggle.
- `host_permissions` to `krdict.korean.go.kr` and `opendict.korean.go.kr` — so the extension can call those APIs from the service worker.

That's it. No `<all_urls>` host permission, no network access to anywhere else.

## Tests

```bash
npm install     # one-time, only for the test harness (devDep: @xmldom/xmldom)
npm test
```

The extension itself ships with no build step or runtime dependencies — `package.json` and `node_modules/` exist solely for the Node test runner. Tests cover the lemmatizer, the API URL builders + `looksEmpty` heuristic, and the KRDict / StDict XML parsers.

## Project layout

```
extension/
  manifest.json
  background.js          ← service worker: orchestrates lemmatizer + fetches
  api.js                 ← URL builders + looksEmpty (pure)
  lemmatizer.js          ← surface form → candidate dictionary forms (pure)
  parsers.js             ← KRDict/OpenDict XML → entry objects (DOMParser injected)
  content.js             ← DOM walker, hover, popup rendering
  content.css            ← styles for wrapped Korean spans
  popup-shadow.css       ← styles loaded into the popup's shadow DOM
  options.{html,js,css}  ← settings page
  popup.{html,js,css}    ← toolbar action popup
  icons/                 ← 16/48/128 PNGs
tests/
  *.test.js              ← node:test suite (run with `npm test`)
  fixtures/              ← KRDict/OpenDict sample XML
```

## Testing

Open any page with Korean (Naver news, namu.wiki, Wikipedia ko, etc.) and hover a word. Try:

- A plain noun: `사람`, `학교`
- A conjugated verb: `먹었어요`, `갔습니다`
- An inflected noun: `학교에서`
- A word KRDict doesn't have: should show graceful "no definition found"

## Limitations & known gaps (V1)

- Lemmatization is heuristic — see [Lemmatization quality](#lemmatization-quality). Irregular verbs and adjectives often fall through.
- Per-domain disable list — not yet (toggle is global). Coming next.
- OpenDict popup toggle button — not yet (OpenDict appears automatically when KRDict has no result, marked "experimental").
- Pronunciation audio — not yet.
- Hanja per-character meanings — KRDict's `origin` field is rendered as-is; richer hanja decomposition is a follow-up.
- Firefox support — manifest is MV3 vanilla; small tweaks may be needed for Firefox MV3.

## Roadmap

The OSS extension is intentionally scoped to *static, client-side lookup*. Features that require a backend (vocabulary tracking, AI explanations, sync across devices) are planned as a separate paid SaaS project that this extension can optionally connect to.

## License

This extension's own code is released under the [MIT License](LICENSE).

V1 has no vendored third-party code. KRDict and OpenDict data is fetched live from the user's API key — no NIKL data is bundled. See [`docs/THIRD-PARTY.md`](docs/THIRD-PARTY.md) for the full attribution policy.
