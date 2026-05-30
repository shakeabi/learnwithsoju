# Mozilla Add-ons (AMO) — Draft Listing Copy

Version: 0.1.0
Last updated: 2026-05-31

This file is the source of truth for all copy pasted into the Mozilla
Add-ons Developer Hub (addons.mozilla.org). Update here first, then
copy into the hub. Character limits and field notes are below each section.

---

## Name

> **Limit: 50 characters**

```
learnwithsoju — Korean Hover Dictionary
```

Character count: 39 — fits within limit.

---

## Summary

> **Limit: 250 characters**
> Shown in search results and the add-on grid. AMO's longer limit allows a
> fuller pitch than Chrome's 132-char summary — use it.

```
Hover any Korean word on any webpage for instant KRDict definitions and morpheme breakdowns. Adds dual Korean subtitles on YouTube and Netflix. Runs entirely in your browser — no telemetry, no proxy.
```

Character count: ~199 — fits within limit.

---

## Description

> **No strict character cap.** Markdown is supported in AMO descriptions.
> The shape mirrors the Chrome listing but you can be slightly more expansive.

### What is learnwithsoju?

learnwithsoju turns any webpage into an interactive Korean dictionary. Hover
over a Korean word — on a news article, a webtoon, a study sheet, a Discord
message, anywhere — and a popup appears with the KRDict dictionary entry, a
click-to-expand morpheme breakdown showing each grammatical piece of the word,
and a one-click link to grammar deep-dives in your AI assistant of choice.

On YouTube and Netflix the extension adds a second subtitle line in Korean so
you can read and hover while you watch, without ever touching the CC menu.

Everything runs locally in your browser. The only outbound network calls are
to the official Korean dictionary APIs (krdict.korean.go.kr and optionally
opendict.korean.go.kr) using an API key you provide, and to hangulhanja.com
when you explicitly request a Hanja breakdown. No analytics. No crash
reporting. No telemetry of any kind.

---

### Features

#### Hover any Korean word

Works on any webpage — no site allowlist required. The popup shows:

- **KRDict dictionary entry** with English and Korean definitions, organized
  into word-grouped tabs when a surface form has multiple homographs (e.g. the
  verb 알다 and the noun 알 each get their own tab). Same-word part-of-speech
  variants are collapsed within a tab; a "+N related" pill reveals less-common
  matches on demand.
- **Example sentences** hidden by default, revealed per sense with one click.
- **English/Korean definition toggle** — switch the definition language and the
  preference is saved.
- **Hanja breakdown** for Sino-Korean words: click the Hanja chip to see each
  character's Chinese reading and English gloss, fetched from hangulhanja.com
  and cached locally.

#### Morpheme breakdown

Every popup has a morpheme strip at the bottom. Click to expand and see the
Korean word broken into its grammatical tokens, each labeled with:

- Its part-of-speech tag (verb stem, object marker, past-tense suffix, polite
  speech-level ending, future-tense modifier…)
- A plain-English grammar gloss written for learners, not linguists

For example, hover over 먹었어요 and the breakdown shows:

```
먹  — verb stem (eat)
었  — past tense suffix
어  — connective
요  — polite speech-level sentence-ender
```

The analysis is done by a local WebAssembly build of mecab-ko bundled inside
the extension — no server call, and instant after the first warm-up.

#### Top-5 candidate fan-out

Korean morphological analysis sometimes has multiple valid parses. learnwithsoju
asks mecab-ko for its top 5 most-probable parses and tries each candidate lemma
against KRDict, so if the most-likely parse doesn't yield a dictionary match the
extension surfaces the next-best candidate that does. You see the right entry
more often, even for irregular verbs.

#### Proper-noun recognition

When you hover a Korean name, place, or brand that has no KRDict entry, the
popup shows a "고유명사 (proper noun)" tab at the top confirming that mecab-ko
recognized it as a proper noun — so you get feedback instead of an empty popup.

#### Dual subtitles on YouTube

1. Play any YouTube video that has a Korean caption track.
2. learnwithsoju detects the Korean track automatically.
3. A Korean subtitle line appears overlaid on the video.
4. Every word is hoverable — same popup and morpheme breakdown.

No need to open the CC menu or switch tracks. Choose your secondary language
(the non-Korean line) from the toolbar popup. Override per-video.

#### Dual subtitles on Netflix

Same experience on Netflix. The extension intercepts Netflix's TTML caption
stream and renders a persistent Korean overlay on the video frame that you can
hover word by word. Secondary language is configurable per title from the
toolbar popup.

#### Ask AI grammar deep-dive

Every popup has an "Ask AI" pill. Click it to open ChatGPT, Claude, or Gemini
(your choice, configured in Options) in a new tab with a structured grammar
prompt pre-filled: conjugation analysis, formality level, related grammatical
patterns, and example sentences in context.

The prompt template is fully customizable in Options → Advanced. The extension
opens a link; it does not call any AI API itself and does not have access to
your AI account.

#### Notepad page

Toolbar icon → Notepad opens a blank page where you can paste any Korean text.
The text is live-wrapped as you type and every word is hoverable, just like on
a real webpage. Useful for studying TOPIK reading passages, song lyrics, or
anything you copy from outside the browser.

#### Morpheme inspector

Toolbar icon → Options → Advanced → Morpheme Inspector opens a page where you
type any Korean string and see the raw mecab-ko tokenization: every token, its
POS tag, and all mecab dictionary fields. Intended for power users who want to
understand why a word lemmatized in a particular way.

#### Per-site disable

The toolbar popup shows a toggle to disable learnwithsoju on the current
website. Useful on sites where you write Korean natively (online editors,
language-exchange platforms) and don't want the popup intercepting clicks. The
disable list is stored locally; re-enable with one click.

#### Light + dark themes

The popup and all extension pages follow your system's preferred color scheme
automatically.

---

### Setup — three steps

**Step 1: Get a free KRDict API key**
Visit https://krdict.korean.go.kr/eng/openApi/openApiRegister and register.
Approval is usually instant.

**Step 2: Configure the extension**
After installing, open the Options page (toolbar icon → Open settings) and
paste your KRDict API key. That is the only required configuration.

**Step 3: Hover**
Visit any webpage with Korean text and hover a word. The popup appears. On
YouTube or Netflix, play a video with a Korean caption track and the dual-
subtitle overlay appears automatically.

Optional: add an OpenDict (우리말샘) key from
opendict.korean.go.kr/service/openApiRegister for a broader vocabulary
fallback. Registration may require a Korean phone number.

---

### Privacy

learnwithsoju makes exactly four kinds of outbound network requests:

1. **Dictionary lookups** — the lemmatized word form sent to
   krdict.korean.go.kr (required) and opendict.korean.go.kr (optional) as a
   search query parameter, along with the API key you provided. Only the word
   being looked up is transmitted — not the page URL, not surrounding text,
   not your identity.

2. **Hanja lookups** — a single character or short Sino-Korean string sent to
   hangulhanja.com, only when you explicitly click the Hanja chip. Not
   triggered automatically.

3. **YouTube caption data** — on YouTube, the extension fetches the same
   /api/timedtext URLs that the YouTube player itself fetches. No additional
   data is sent to YouTube beyond a normal page load.

4. **Ask AI link** — clicking "Ask AI" causes your browser to open a new tab
   to ChatGPT/Claude/Gemini with a prompt URL parameter. The extension itself
   makes no API call to any AI service.

Your API keys, language preferences, per-site disable list, and the lookup
cache are stored in browser local storage (browser.storage). They leave your
device only as described above.

No analytics. No crash reporting. No usage telemetry. No learnwithsoju server.

---

### Free and open source

learnwithsoju is released under the **GNU Affero General Public License
v3.0 or later (AGPL-3.0-or-later)**. Source code:
<!-- TODO: confirm public repo URL before submitting -->
https://github.com/abishake/learnwithsoju

Forks, derivatives, and any hosted or networked use must be released under
AGPL-3.0-or-later with full attribution and source available.

---

## Categories

> AMO allows one primary category and one optional secondary category.

**Primary: Language Support**
The extension's primary function is aiding Korean language comprehension —
this maps directly to AMO's Language Support category.

**Secondary: Education**
A reasonable secondary choice since the extension is explicitly a learning
tool, not a translation tool.

---

## Tags

> AMO allows up to 10 tags. Choose for search discoverability.

```
korean
dictionary
popup
subtitles
netflix
youtube
language-learning
mecab
hangul
topik
```

---

## Screenshots

> Same 5 screenshots as Chrome. AMO accepts various sizes; 1280×800 works well.
> Actual screenshots to be captured from a real browser session before submission.

<!-- TODO: capture all screenshots before submitting to AMO -->

**Screenshot 1 — Hover popup with morpheme breakdown**
Show the popup open over a conjugated Korean verb (e.g. 먹었어요) on a plain
Korean webpage. The popup should display the dictionary entry, the morpheme
breakdown strip expanded with token glosses, and the "Ask AI" pill.

**Screenshot 2 — YouTube dual subtitles**
Show a YouTube video playing with the Korean dual-subs overlay line visible
below (or above) the native subtitle line. If possible, the hover popup should
be open over one Korean word in the overlay.

**Screenshot 3 — Netflix dual subtitles**
Show the Netflix player with the Korean subtitle overlay clearly visible against
the video content. Keep branding minimal to focus on the feature.

**Screenshot 4 — Options page**
Show the Options page with the KRDict API key field (value redacted), the
secondary subtitle language selector, the AI provider selector, and the cache
management section. Demonstrates user control.

**Screenshot 5 — Morpheme inspector**
Show the Morpheme Inspector page with a Korean phrase entered (e.g. 오늘도
열심히 공부해야 해요) and the token table fully expanded.

---

## Source Code Disclosure

> AMO requires disclosure of any GPL-family code bundled in the extension.
> This section covers everything the reviewer needs; submit the source ZIP
> alongside the XPI.

### Extension license

**AGPL-3.0-or-later**

Source repository:
<!-- TODO: confirm public repo URL -->
https://github.com/abishake/learnwithsoju

The extension contains no minified or obfuscated code and no build step —
`extension/` is loaded directly into the browser.

### Vendored components

#### mecab-ko-wasm (forked)

- **License:** MIT OR Apache-2.0 (user's option)
- **Upstream:** https://github.com/hephaex/mecab-ko
- **Our fork:** <!-- TODO: push fork to a public GitHub repo before submitting to AMO -->
  https://github.com/abishake/mecab-ko-wasm (placeholder — will be public before submission)
- **What we changed:** Added `SystemDictionary::from_bytes()`,
  `Tokenizer::from_dict_bytes()`, and the JS-facing `Mecab.withDictBytes()`
  so the analyzer can be initialized in browsers from in-memory bytes. The
  upstream npm release expects a filesystem, which is unavailable in MV3.
- **Bundled files:** `extension/vendor/mecab-ko/mecab_ko_wasm.js`,
  `mecab_ko_wasm.d.ts`, `mecab_ko_wasm_bg.wasm`, `mecab_ko_wasm_bg.wasm.d.ts`
- **Build:** `wasm-pack build --target web --release` from `crates/mecab-ko-wasm/`
  in the fork.

Full attribution: [`docs/THIRD-PARTY.md`](../THIRD-PARTY.md)

#### mecab-ko-dic 2.1.1 (compiled binary form)

- **License:** Apache-2.0
- **Upstream source:** https://bitbucket.org/eunjeon/mecab-ko-dic/downloads/mecab-ko-dic-2.1.1-20180720.tar.gz
- **Bundled files:** `extension/vendor/mecab-ko/sys.dic.gz`,
  `matrix.bin.gz`, `entries.bin.gz` (~22 MB compressed; ~90 MB decompressed)
- **How it was built:** Compiled from the upstream source CSVs using
  `mecab-ko-dict-builder --compression 0`, then gzip-compressed at level 9.
  The source tarball is unmodified; only the binary compilation step is ours.

Full attribution: [`docs/THIRD-PARTY.md`](../THIRD-PARTY.md)

### Runtime API services (no data bundled)

The following services are called at runtime; no data from them is bundled
into the extension package:

- **KRDict** (krdict.korean.go.kr) — Korean dictionary by NIKL; MIT-licensed
  API, user-supplied key.
- **OpenDict / 우리말샘** (opendict.korean.go.kr) — expanded Korean
  dictionary by NIKL; optional, user-supplied key.
- **hangulhanja.com** — per-character Hanja lookup; called on demand.

---

## Author / Contact

<!-- TODO: add author name and contact before submitting -->
Author: Nora (abishake.dev@gmail.com)

---

## Privacy Policy

> AMO requires a privacy policy URL for add-ons that handle any user data.
> The inline summary below should match the linked policy.

**Privacy Policy URL:**
<!-- TODO: publish a real privacy policy page before submitting -->
https://learnwithsoju.example/privacy

### Inline privacy summary

learnwithsoju does not collect, store, or transmit any personally identifiable
information. The following outbound network requests are made:

- Korean word lookups to krdict.korean.go.kr and (if configured)
  opendict.korean.go.kr, using the API key you supply. Only the word being
  looked up is sent.
- Hanja character lookups to hangulhanja.com, only on explicit user action.
- On YouTube: caption track fetches to YouTube's own /api/timedtext endpoints
  (the same requests the player would make).
- The "Ask AI" feature opens a URL in a new tab; the extension does not call
  any AI API.

All other data — API keys, preferences, per-site disable list, lookup cache —
is stored locally in the browser via browser.storage and never leaves your
device except as described above.

Full privacy policy: https://learnwithsoju.example/privacy

---

## License

```
AGPL-3.0-or-later
```

Select "GNU Affero General Public License v3.0" in the AMO license dropdown.

---

## Version Notes (v0.1.0 — Initial Release)

> Shown on the add-on's version history page and in the "What's new" section.

**v0.1.0 — Initial release**

First public release of learnwithsoju.

- Hover popup definitions powered by KRDict (National Institute of Korean
  Language), with optional OpenDict (우리말샘) fallback.
- Local mecab-ko WASM morphological analysis — morpheme breakdown with
  plain-English grammar glosses for every token.
- Top-5 n-best candidate fan-out so irregular-verb hovers surface the right
  lemma even when the most-probable parse differs.
- Proper-noun recognition: names, places, and brands show a "고유명사" tab
  when KRDict has no entry.
- Dual Korean subtitles on YouTube and Netflix — auto-detected, hoverable
  word by word.
- Hanja breakdown for Sino-Korean words (per character, on demand).
- "Ask AI" pill — opens ChatGPT, Claude, or Gemini with a structured grammar
  deep-dive prompt pre-filled. Customizable prompt template.
- Notepad page for pasting and hovering Korean text offline.
- Morpheme Inspector page for power-user tokenization debugging.
- Per-site disable toggle in toolbar popup.
- Light and dark themes following system preference.
- No telemetry. No remote code. All dictionary analysis runs locally.

---

*End of Mozilla AMO draft. Review all TODO markers before submitting.*
*Specifically: push the mecab-ko-wasm fork to a public GitHub repo;*
*publish the privacy policy page; confirm the extension repo URL.*
