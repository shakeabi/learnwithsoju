# learnwithsoju

A free, open-source browser extension that turns any webpage into a Korean reading classroom. Hover any word — even a conjugated verb you don't recognize — and a popup shows you the dictionary entry plus a click-to-expand morpheme breakdown with the grammatical role of each piece.

## What you get when you hover

```
┌──────────────────────────────────────────────────┐
│ Given sentence                                   │
│ … 사람이 많아서 미리 [예약해야] 돼요.              │
├──────────────────────────────────────────────────┤
│ [예약하다]                       [영어] [한국어]  │
├──────────────────────────────────────────────────┤
│ [ Morpheme breakdown ]   ← click to expand        │
│   예약  ·  명  ·  noun                           │
│ + 해   ·  v.  ·  do (verb-forming suffix)        │
│ + 야   ·  end. ·  must / have to                 │
├──────────────────────────────────────────────────┤
│ 예약하다  [동사] ★★                              │
│ [동사]  [예ː야카다]  [豫約]                       │
│   1.                                             │
│   to make a reservation; book                    │
│   To arrange a place, room, object, etc., …      │
│                                                  │
│  ▸ Show examples (3)                             │
└──────────────────────────────────────────────────┘
```

## Features

- **Hover any Korean word** — works on any webpage with Korean text. The extension wraps Korean spans in the page and shows a floating popup on hover.
- **Real morpheme analysis** — uses the [MeCab-Ko](https://github.com/hephaex/mecab-ko) morphological analyzer compiled to WebAssembly. Conjugated verbs, inflected nouns, and compound words all resolve to the right dictionary form.
- **Morpheme breakdown on demand** — click the *Morpheme breakdown* tab to see every chunk of the hovered word with its part of speech and a short grammar gloss (subject marker, past tense, polite ending, …). Token-aware, so the same form with different POS gets different glosses (e.g. `을/JKO` object marker vs `을/ETM` future-tense modifier).
- **Tabs for homographs** — when KRDict returns multiple entries for the same headword, you can switch between them. Tab labels show the part of speech.
- **Per-character Hanja breakdown on demand** — for Sino-Korean entries, click the origin chip to expand a compact per-character breakdown (Sino-Korean reading + English gloss) from [hangulhanja.com](https://hangulhanja.com). Each character in the expanded panel also links out to its full hangulhanja.com page. The fetch is lazy — only fires on click — and results are cached locally so re-hovering the same Sino-Korean word is instant.
- **English / Korean toggle** — switch the popup definition language with one click. Preference is remembered.
- **Examples on demand** — KRDict examples are hidden by default to keep the popup compact; click *Show examples* per-sense to reveal.
- **Local cache** — every word you've looked up is cached on your machine, so you never hit the dictionary API twice for the same surface form. Clear the cache anytime from the settings page.
- **No backend** — everything runs in your browser. The only network calls are to the official Korean dictionary APIs, with your own free API key.
- **Light + dark themes** — automatic, follows your system preference.

## Install

### Chrome / Edge / Brave

1. Clone or [download](https://github.com/abishake/learnwithsoju/archive/refs/heads/main.zip) this repo.
2. Open `chrome://extensions`.
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** → pick the `extension/` folder.
5. The settings page opens automatically — paste your API key (see below).

### Firefox

Requires Firefox 121 or newer.

1. Clone or download this repo.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** → pick the `extension/manifest.json` file.
4. Open the extension's options page from `about:addons`, paste your API key.

(Temporary add-ons unload when Firefox restarts. Permanent installation will be available once we publish on AMO.)

## Get an API key

You'll need a free key from the National Institute of Korean Language. Approval is usually instant.

| Dictionary | Where to register | Required? |
|---|---|---|
| **KRDict** (한국어기초사전) | <https://krdict.korean.go.kr/eng/openApi/openApiRegister> | yes |
| **OpenDict** (우리말샘) | <https://opendict.korean.go.kr/service/openApiRegister> | optional, experimental |

**KRDict** is the primary dictionary — has English translations and learner-friendly definitions. **OpenDict** is a much larger fallback (~1.1M entries vs ~500K) used only when KRDict has no entry for a word; quality varies (community-edited) and registration may require a Korean phone number.

Paste your key into the extension's settings page (`chrome://extensions` → click the extension → details → Extension options, or the toolbar icon → *Open settings*).

## Usage

- **Hover** any Korean word on any webpage. The popup appears, and stays as long as your cursor is on the word or on the popup itself.
- **Click** a Korean word as a fallback — useful on sites where hover doesn't always fire (some video players, overlays). Click triggers the lookup immediately and doesn't navigate even if the word sits inside a link.
- **Click any word in the sentence** shown inside the popup to look that word up instead. The popup keeps the same sentence as context, just with the new word highlighted — so you can read through a sentence word by word without having to re-find each one on the page.
- **Click the toolbar icon** to toggle the extension on/off, or to open settings.
- **Click the EN / KR toggle** in the popup to switch the definition language. The choice persists.
- **Click a tab** when there are multiple homograph entries — the popup keeps its current position.
- **Click "+N related"** in the tab strip to fold in entries KRDict returned that aren't exact headword matches.
- **Click the Morpheme breakdown tab** (between the sentence and the dictionary entries) to see the mecab decomposition. Collapsed by default.
- **Click "Show examples"** under a sense to reveal example sentences (when KRDict provides them).
- **Click the Hanja chip** (Sino-Korean entries only) to expand a per-character breakdown — Sino-Korean reading + English gloss. The chip shows a `+` when collapsed and `−` when expanded. From the panel, clicking the character itself opens its full breakdown on hangulhanja.com.

The first hover after the extension wakes up takes ~1–2 seconds while the morphological analyzer's dictionary loads. After that, hovers are instant.

## Privacy

- The extension makes network requests **only** to `krdict.korean.go.kr`, `opendict.korean.go.kr` (when you've added the OpenDict key), and `hangulhanja.com` (only when you click a Hanja origin chip to expand its meanings — never automatically). Your API keys are sent only to the first two; the Hanja API takes the characters themselves as its query — no key, no other data.
- No analytics, no tracking, no telemetry.
- Your API keys and the lookup cache are stored locally via `chrome.storage` — never sent anywhere except the dictionary servers.

## Limitations & known gaps

- **First-hover latency.** ~1–2 seconds the first time you hover a word after the extension's service worker has been idle, while the ~22 MB compressed dictionary unzips and the WASM analyzer initializes. Hovers after that are instant.
- **No multi-morpheme grammar-pattern detection.** The morpheme breakdown labels each piece (e.g. `-야` → "must / have to") but the popup doesn't try to recognize whole textbook constructions like `아/어야 되다/하다`. A regex-on-text version of this existed in earlier builds but produced too many false positives (e.g. matching `-나` as the listing particle inside `-나요` question endings); doing it correctly requires token-aware pattern matching, which is a separate project.
- **No per-domain disable list** yet. The toolbar toggle is global.
- **No pronunciation audio playback** yet (KRDict has audio URLs; chips link to koreanverb.app's pronunciation page in the meantime).
- **No published Chrome Web Store / AMO listing** yet — install as unpacked / temporary for now.

## Roadmap

- Per-domain disable list
- Pronunciation audio playback (KRDict has audio URLs; just need to wire them in)
- Token-aware grammar-pattern detection — replacement for the removed regex-on-text matcher, using mecab POS sequences instead of text matching.

## Contributing & development

See [CONTRIBUTING.md](CONTRIBUTING.md) for local-dev setup and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for an architecture walkthrough.

## License

[MIT License](LICENSE) for the extension's own code. Vendored components keep their own licenses — see [docs/THIRD-PARTY.md](docs/THIRD-PARTY.md).

This project includes a fork of `mecab-ko-wasm` (MIT/Apache-2.0) and `mecab-ko-dic 2.1.1` (Apache-2.0). Full attribution is in [docs/THIRD-PARTY.md](docs/THIRD-PARTY.md).
