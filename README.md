# learnwithsoju

Korean popup-dictionary extension with hover lookups, dual subs on YouTube + Netflix, and AI-powered grammar deep-dives.

Free, open-source, MV3 — runs entirely in your browser. The only network calls are to the official Korean dictionary APIs (with your own free key) and, on click, to ChatGPT / Claude / Gemini for grammar deep-dives.

<!-- TODO: screenshot of popup with morpheme breakdown -->
<!-- TODO: gif of dual subs on YouTube -->
<!-- TODO: screenshot of Netflix dual-subs overlay -->

## Features

- **Hover any Korean word** — works on any webpage. Inflected verbs, conjugated adjectives, compound nouns, and proper nouns all resolve to the right dictionary form via local mecab-ko morphological analysis (no server, no telemetry).
- **Dual Korean + secondary-language subtitles** on YouTube and Netflix — auto-primed so you never have to fiddle with CC menus. The Korean line is hoverable like any other text on the page.
- **Word-grouped tabs** for homograph results, with same-word POS variants collapsed and a "+N related" pill that folds in less-relevant matches on demand.
- **Top-5 n-best candidate fan-out** — when mecab's most-likely parse is wrong, the next-best parses still get a chance to surface the right lemma.
- **Proper-noun fallback** — when KRDict has no entry for a name / place / brand, a synthesized "고유명사" tab is shown at position 0 so the user still gets confirmation that mecab recognized it.
- **Click-to-expand morpheme breakdown** — every chunk of the hovered word with its part of speech and a short grammar gloss (subject marker, past tense, polite ending, …). Token-aware: `을/JKO` (object marker) gets a different gloss than `을/ETM` (future-tense modifier).
- **Per-character Hanja breakdown** for Sino-Korean words — Sino reading + English gloss per character, lazy-fetched on click from hangulhanja.com and cached locally.
- **English / Korean definition toggle** with persistence; KRDict examples hidden by default and revealed per-sense.
- **"Ask AI" pill** — one-click link that opens ChatGPT / Claude / Gemini in a new tab with a structured grammar deep-dive prompt pre-filled. Ephemeral-chat option for ChatGPT. Fully customizable prompt template in Options → Advanced.
- **Notepad page** for pasting Korean text and hovering inline — wraps the text live as you type.
- **Morpheme inspector page** for debugging tokenization — see every mecab field for an arbitrary input.
- **Per-site enable / disable** from the toolbar popup, configurable default secondary subtitle language, and per-video / per-title overrides for the secondary language.
- **Light + dark themes** — automatic, follows your system preference.

## Install

### From the Web Store

- **Chrome / Edge / Brave** — *coming soon* — <!-- TODO: Web Store URL after publish -->
- **Firefox** — *coming soon* — <!-- TODO: AMO URL after publish -->

### From source (Chrome / Edge / Brave)

1. Clone this repo: `git clone https://github.com/abishake/learnwithsoju.git`
2. Open `chrome://extensions`.
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** → pick the `extension/` folder.
5. The options page opens automatically — paste your KRDict API key.

### From source (Firefox 121+)

1. Clone this repo.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** → pick `extension/manifest.json`.
4. Open the extension's options from `about:addons`, paste your KRDict API key.

(Temporary add-ons unload when Firefox restarts. Permanent installation will be available once we publish on AMO.)

For maintainers: `npm run package:firefox` produces a Firefox-ready .zip
in `dist/`. See [`docs/firefox-build.md`](docs/firefox-build.md) for
the AMO submission walkthrough and a field-by-field rundown of why
one manifest works in both browsers.

## First 30 seconds

1. **Get a free KRDict API key** from the [National Institute of Korean Language](https://krdict.korean.go.kr/eng/openApi/openApiRegister). Approval is usually instant.
2. **Paste it** into the extension's Options page (toolbar icon → *Open settings*).
3. **Hover** any Korean text on any webpage — the popup appears with the dictionary entry and an expandable morpheme breakdown.
4. **On YouTube / Netflix**: just play any video with a Korean caption track. The dual-subs overlay engages automatically — no need to toggle CC manually. Per-video / per-title secondary language is configurable from the toolbar popup.

The first hover after the extension wakes up takes ~1–2 seconds while the mecab-ko WASM unpacks; hovers after that are instant.

A second API key for **OpenDict** (우리말샘) is optional — it's used as a fallback when KRDict has no entry. Register at <https://opendict.korean.go.kr/service/openApiRegister> (may require a Korean phone number).

## Tech stack

Manifest V3, vanilla JS (no build step), local mecab-ko WASM for morphological analysis, KRDict + OpenDict for definitions, hangulhanja.com for Hanja breakdowns.

The contents of `extension/` are what get loaded into the browser — no bundler, no transpiler. `npm install` exists only for the Node test harness.

## Privacy

- Network calls only to `krdict.korean.go.kr`, `opendict.korean.go.kr` (if configured), and `hangulhanja.com` (only when you click a Hanja chip).
- On YouTube the extension also fetches YouTube's own `/api/timedtext` URLs (the same ones the player is about to fetch anyway).
- The "Ask AI" pill is an outbound link only — clicking it opens the AI provider in a new tab with a `?q=` URL parameter; the extension does not fetch from those services itself.
- API keys, prompt template, per-site disable list, secondary-language preferences, and the lookup cache are stored locally via `chrome.storage` — never sent anywhere except the dictionary servers.
- No analytics, no tracking, no telemetry.

## Contributing

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — local dev setup, test loop, style.
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — architecture index; links out to per-topic docs.
- [`docs/adding-a-site-adapter.md`](docs/adding-a-site-adapter.md) — how to add support for a new streaming site (Disney+, Hulu, Viki, …).
- [`docs/lemmatizer-guards.md`](docs/lemmatizer-guards.md) — how to add a lemmatizer guard when you spot a mis-lemmatized Korean word.

## License

Released under **AGPL-3.0-or-later**. Forks, derivatives, and any hosted/networked use must be released under AGPL-3.0-or-later with full attribution and source available. See [LICENSE](LICENSE).

## Acknowledgements

Built on:

- [**mecab-ko**](https://bitbucket.org/eunjeon/mecab-ko/) — Korean fork of the MeCab morphological analyzer.
- [**mecab-ko-dic**](https://bitbucket.org/eunjeon/mecab-ko-dic/) — the dictionary that powers it.
- [**KRDict**](https://krdict.korean.go.kr) and [**OpenDict**](https://opendict.korean.go.kr) — Korean dictionaries published by the National Institute of Korean Language.
- [**hangulhanja.com**](https://hangulhanja.com) — per-character Hanja breakdowns.

Full attribution and per-component licenses in [`docs/THIRD-PARTY.md`](docs/THIRD-PARTY.md).
