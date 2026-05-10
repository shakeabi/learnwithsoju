# learnwithsoju

A free, OSS Chrome/Firefox extension that adds a hover-popup Korean dictionary to any webpage. Pure frontend — your queries go to the official KRDict and OpenDict APIs, and nothing else leaves the browser.

> Inspired by [Kimchi Reader](https://kimchi-reader.app), stripped to the core hover lookup.

## Features

- Hover any Korean word, see the dictionary entry inline.
- Real morpheme-level POS tagging via mecab-ko (vendored WASM), so irregular verbs, conjugated forms, and compound nouns all resolve to the right dictionary form (`먹었어요` → `먹다`, `학교에서` → `학교`, `친구들과` → `친구`, `한국말` → `한국말` or `한국`).
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
| KRDict (한국어기초사전) | <https://krdict.korean.go.kr/eng/openApi/openApiRegister> | yes |
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
   ├─ mecab-ko WASM (lazy-init on first hover) → POS-tagged morpheme tokens
   ├─ lemmatizer.js → candidate dictionary forms [먹다, 먹었어요]
   ├─ try each against KRDict /api/search → XML
   └─ fall back to OpenDict /api/search → XML if no KRDict hit (experimental)
   │
   ▼
content.js parses XML, renders popup inside a Shadow DOM
```

Extension footprint is ~22 MB on disk: 145 KB WASM + 22 MB gzipped dict (sys.dic + matrix.bin + entries.bin). Decompresses to ~90 MB in service worker memory at first hover; subsequent hovers reuse the in-memory tokenizer.

## Lemmatization

The extension uses a forked build of [mecab-ko-wasm](https://github.com/hephaex/mecab-ko) with a `from_bytes`/`withDictBytes` constructor we added so the dict can be supplied at runtime (the upstream npm release ships the engine without `mecab-ko-dic`, so `new Mecab()` errors in browsers — see [`docs/MECAB_INTEGRATION.md`](docs/MECAB_INTEGRATION.md)).

Concretely, `extension/lemmatizer.js` walks mecab's POS-tagged morphemes:

- Verb / adjective stems (`VV`, `VA`, `VX`, `VCN`, `VCP`, `XSV`, `XSA`) → append `다` to form the dictionary headword.
- Nouns / pronouns / numerals (`NNG`, `NNP`, `NR`, `NP`, `SL`, `SH`, `SN`) → the morpheme itself is the lemma.
- Particles (`JK*`, `JX`), endings (`E*`), and other non-content tags are skipped.
- The original surface form is always included as a fallback so compound nouns mecab splits apart (`한국말` → `한국` + `말`) still resolve when KRDict indexes the whole word.

If mecab fails to initialize for any reason, the service worker falls back to surface-only lookup so the extension still works (with weaker resolution).

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
  background.js          ← service worker: mecab init + orchestrates lookup
  api.js                 ← URL builders + looksEmpty (pure)
  lemmatizer.js          ← mecab tokens → candidate dictionary forms (pure)
  parsers.js             ← KRDict/OpenDict XML → entry objects (DOMParser injected)
  content.js             ← DOM walker, hover, popup rendering
  content.css            ← styles for wrapped Korean spans
  popup-shadow.css       ← styles loaded into the popup's shadow DOM
  options.{html,js,css}  ← settings page
  popup.{html,js,css}    ← toolbar action popup
  icons/                 ← 16/48/128 PNGs
  vendor/mecab-ko/       ← vendored mecab-ko-wasm + gzipped dict
                           ↳ mecab_ko_wasm{.js,.d.ts,_bg.wasm}  (built from our fork)
                           ↳ {sys.dic,matrix.bin,entries.bin}.gz  (mecab-ko-dic 2.1.1)
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

- First hover after the service worker wakes is slow (~1–2 s) while the dict loads. Subsequent hovers are instant.
- Per-domain disable list — not yet (toggle is global). Coming next.
- OpenDict popup toggle button — not yet (OpenDict appears automatically when KRDict has no result, marked "experimental").
- Pronunciation audio — not yet.
- Hanja per-character meanings — KRDict's `origin` field is rendered as-is; richer hanja decomposition is a follow-up.
- Firefox support — manifest is MV3 vanilla; small tweaks may be needed for Firefox MV3.

## Roadmap

The OSS extension is intentionally scoped to *static, client-side lookup*. Features that require a backend (vocabulary tracking, AI explanations, sync across devices) are planned as a separate paid SaaS project that this extension can optionally connect to.

## License

This extension's own code is released under the [MIT License](LICENSE).

Vendored third-party code lives in `extension/vendor/mecab-ko/`:

- **mecab-ko-wasm** (built from our fork at <https://github.com/hephaex/mecab-ko>) — MIT OR Apache-2.0
- **mecab-ko-dic 2.1.1** (built dict bytes) — Apache-2.0

KRDict and OpenDict data is fetched live from the user's API key — no NIKL data is bundled. See [`docs/THIRD-PARTY.md`](docs/THIRD-PARTY.md) for the full attribution policy.
