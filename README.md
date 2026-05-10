# learnwithsoju

A free, open-source browser extension that turns any webpage into a Korean reading classroom. Hover any word — even a conjugated verb you don't recognize — and a popup shows you the dictionary entry, the morpheme breakdown with grammatical role of each piece, and any grammar patterns the sentence is using.

Inspired by [Kimchi Reader](https://kimchi-reader.app), built as a pure-frontend, no-backend, free OSS alternative.

## What you get when you hover

```
┌──────────────────────────────────────────────────┐
│ Given sentence                                   │
│ … 사람이 많아서 미리 [예약해야] 돼요.              │
├──────────────────────────────────────────────────┤
│ [예약하다]                       [영어] [한국어]  │
├──────────────────────────────────────────────────┤
│ Morpheme breakdown                               │
│   예약  ·  명  ·  noun                           │
│ + 해   ·  v.  ·  do (verb-forming suffix)        │
│ + 야   ·  end. ·  must / have to                 │
├──────────────────────────────────────────────────┤
│ Grammar in this sentence                         │
│ [(으)ㄹ 수 있다/없다]   Ability or possibility    │
│ [아/어야 되다/하다]     Necessity to do something │
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
- **Morpheme breakdown** — every chunk in the hovered word is shown with its part of speech and a short grammar gloss (subject marker, past tense, polite ending, …).
- **Grammar pattern hints** — multi-morpheme grammar patterns from the [kimchi-grammar](https://github.com/Alaanor/kimchi-grammar) dataset (290 patterns covering most learner-textbook constructions) are flagged in the surrounding sentence.
- **Tabs for homographs** — when KRDict returns multiple entries for the same headword, you can switch between them. Tab labels show the part of speech.
- **Hanja link** — when an entry has a Sino-Korean origin, the Hanja chip links out to [hangulhanja.com](https://hangulhanja.com) for the per-character breakdown.
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

- **Hover** any Korean word on any webpage. The popup appears.
- **Click the toolbar icon** to toggle the extension on/off, or to open settings.
- **Click the EN / KR toggle** in the popup to switch the definition language. The choice persists.
- **Click a tab** when there are multiple homograph entries.
- **Click "Show examples"** under a sense to reveal example sentences (when KRDict provides them).
- **Click the Hanja chip** to open the per-character breakdown on hangulhanja.com.

The first hover after the extension wakes up takes ~1–2 seconds while the morphological analyzer's dictionary loads. After that, hovers are instant.

## Privacy

- The extension makes network requests **only** to `krdict.korean.go.kr` and `opendict.korean.go.kr` (when you've added the OpenDict key), using your API key.
- No analytics, no tracking, no telemetry.
- Your API keys and the lookup cache are stored locally via `chrome.storage` — never sent anywhere except the dictionary servers.

## Limitations & known gaps

- **First-hover latency.** ~1–2 seconds the first time you hover a word after the extension's service worker has been idle, while the ~22 MB compressed dictionary unzips and the WASM analyzer initializes. Hovers after that are instant.
- **Verb conjugation contractions** in grammar patterns. The grammar-pattern matcher derives its regexes from each pattern's display name, so contractions like `해야` (from `하 + 여야`) aren't expanded — patterns whose canonical form has these contractions may not match real text. The breakdown row still works correctly because mecab handles the conjugation on its own.
- **No per-domain disable list** yet. The toolbar toggle is global.
- **No pronunciation audio** yet.
- **No published Chrome Web Store / AMO listing** yet — install as unpacked / temporary for now.

## Roadmap

- Per-domain disable list
- Pronunciation audio (KRDict has audio links — wiring them up is small)
- Hanja per-character meanings (currently just shown as a single chip, link to hangulhanja.com)
- Sentence-level grammar matching using mecab tokens (current matcher is regex on text — would catch more conjugated forms)

## Contributing & development

See [CONTRIBUTING.md](CONTRIBUTING.md) for local-dev setup and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for an architecture walkthrough.

## License

[MIT License](LICENSE) for the extension's own code. Vendored components keep their own licenses — see [docs/THIRD-PARTY.md](docs/THIRD-PARTY.md).

This project includes a fork of `mecab-ko-wasm` (MIT/Apache-2.0), `mecab-ko-dic 2.1.1` (Apache-2.0), and the `kimchi-grammar` pattern dataset (CC-BY 4.0).
