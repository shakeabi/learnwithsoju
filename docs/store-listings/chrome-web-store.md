# Chrome Web Store — Draft Listing Copy

Version: 0.1.0
Last updated: 2026-05-31

This file is the source of truth for all copy pasted into the Chrome Web Store
Developer Dashboard. Update here first, then copy into the dashboard.
Character limits are noted per field; counts are approximate for drafting
purposes (verify with the dashboard's own counter before submitting).

---

## Name

> **Limit: 45 characters**

```
learnwithsoju — Korean Hover Dictionary
```

Character count: 39 — fits within limit.

---

## Summary

> **Limit: 132 characters**
> Shown in search results and the extension grid. Should be a self-contained
> one-liner — no "and much more".

```
Hover any Korean word for instant KRDict definitions, morpheme breakdowns, and dual subtitles on YouTube and Netflix.
```

Character count: ~118 — fits within limit.

---

## Detailed Description

> **Limit: 16,000 characters**
> Plain text only in the Chrome Web Store editor; markdown renders as literal
> asterisks. Use ALL-CAPS section headers and dashes for bullets.

---

### Hero paragraph

learnwithsoju turns any webpage into an interactive Korean dictionary. Hover
over any Korean word — on a news article, a webtoon, a blog post, anywhere —
and a popup appears with the KRDict dictionary entry, a click-to-expand
morpheme breakdown, and one-click links to a grammar deep-dive in your AI
assistant of choice. On YouTube and Netflix it goes one step further: the
extension overlays a second subtitle line in Korean so you can read and hover
while you watch, no caption-menu fiddling required.

Everything happens locally in your browser. The only outbound calls are to the
official Korean dictionary APIs — krdict.korean.go.kr and, optionally,
opendict.korean.go.kr — using an API key you supply. No analytics, no
tracking, no telemetry.

---

### What you can do

HOVER ANY KOREAN WORD
- Works on any webpage: news, webtoons, blogs, social media, Notion, anything.
- The popup shows the KRDict dictionary entry with English and Korean
  definitions, example sentences (tap to reveal), and word-grouped tabs for
  homographs (e.g. the verb 알다 and the noun 알 each get their own tab).
- For Sino-Korean words a Hanja chip shows each character's Chinese reading and
  English gloss — click to expand.
- Toggle between English and Korean definitions with one click; preference is
  remembered.

DUAL SUBTITLES ON YOUTUBE
- Play any YouTube video that has a Korean caption track. learnwithsoju
  detects the Korean track automatically and overlays it as a second line below
  the video's native subtitles.
- Every word in the Korean line is hoverable — same popup, same morpheme
  breakdown.
- Choose your secondary subtitle language from the toolbar popup; override
  per-video without touching the YouTube CC menu.

DUAL SUBTITLES ON NETFLIX
- Same idea on Netflix. The extension intercepts Netflix's own caption stream
  (TTML/IMSC1) and renders an always-visible Korean overlay that you can hover
  word by word.
- Language preference is configurable per title from the toolbar popup.

MORPHEME BREAKDOWN (MECAB-BASED)
- Click the morpheme strip below any definition to see each token in the word
  with its part of speech and a plain-English grammar gloss.
- Examples: 을/JKO → "object marker"; 았/EP → "past tense"; 요/EF → "polite
  speech-level ending"; 을/ETM → "future/potential modifier".
- Powered by a local mecab-ko WASM binary — no server call, no latency after
  the first warm-up.

ASK AI GRAMMAR DEEP-DIVE
- Every popup has an "Ask AI" button. Tap it to open ChatGPT, Claude, or
  Gemini in a new tab with a structured grammar prompt pre-filled for the word
  you hovered — conjugation, formality level, related patterns, example
  contexts.
- You can fully customize the prompt template in Options → Advanced.
- The extension opens a link; it does not call any AI API itself.

NOTEPAD PAGE
- Open the Notepad page (toolbar icon → Notepad) and paste any Korean text.
  The text is live-wrapped as you type, and every word is hoverable just like
  on a real webpage.
- Useful for studying TOPIK reading passages, song lyrics, or any text you
  copy-paste from outside the browser.

MORPHEME INSPECTOR
- Developer / power-user tool. Open the Morpheme Inspector page, type any
  Korean string, and see the raw mecab-ko tokenization: every token, its POS
  tag, and all mecab fields.
- Handy for understanding why a particular word lemmatized the way it did.

PER-SITE DISABLE
- Use the toolbar popup to disable learnwithsoju on any website where the
  popup gets in the way (e.g. an online editor where you use Korean input
  natively).
- Re-enable with one click. The disable list is stored locally.

---

### How it works under the hood

Korean morphological analysis is done entirely in your browser by a compiled
WebAssembly build of mecab-ko, an open-source Korean morphological analyzer,
bundled with the mecab-ko-dic 2.1.1 dictionary (~22 MB compressed, decompresses
to ~90 MB in memory). The first hover after the extension starts takes 1–2
seconds while the WASM module unpacks; subsequent hovers are instant. Dictionary
lookups go directly from your browser to the NIKL KRDict API at
krdict.korean.go.kr — learnwithsoju is not a proxy. No page text is ever sent
to a learnwithsoju server because there is no learnwithsoju server.

---

### Setup — three steps

1. GET A FREE KRDICT API KEY
   Visit https://krdict.korean.go.kr/eng/openApi/openApiRegister and register.
   Approval is usually instant.

2. INSTALL AND CONFIGURE
   After installing, the Options page opens automatically. Paste your KRDict
   API key into the field provided. That is the only required configuration.

3. HOVER
   Visit any webpage with Korean text and hover over a word. The popup appears.
   On YouTube or Netflix, play any video with a Korean caption track — the
   dual-subtitle overlay appears automatically.

Optional: a second key for OpenDict (우리말샘) at
opendict.korean.go.kr/service/openApiRegister can be added in Options. OpenDict
is used as a fallback when KRDict has no entry. Registration may require a
Korean phone number.

---

### Free and open source

learnwithsoju is released under the GNU Affero General Public License v3.0 or
later (AGPL-3.0-or-later). The source code is at:
<!-- TODO: actual GitHub repo URL -->
https://github.com/abishake/learnwithsoju

All contributions are welcome. Forks and derivatives must likewise be released
under AGPL-3.0-or-later with source available.

---

### Privacy

learnwithsoju makes exactly three kinds of outbound network calls:

1. Dictionary lookups — to krdict.korean.go.kr (required) and
   opendict.korean.go.kr (optional), using the API key you provide. Only the
   lemmatized word form is sent, never surrounding page text or your identity.

2. Hanja lookups — to hangulhanja.com, only when you click the Hanja chip on
   a Sino-Korean entry. The request is a single character or short string; it
   is not associated with your identity.

3. YouTube caption fetches — on YouTube, the extension fetches the same
   /api/timedtext URLs that the YouTube player itself would fetch. No
   additional data is sent.

The "Ask AI" button opens a link in a new browser tab. The extension does not
call any AI API; it constructs a URL with a pre-filled prompt and lets your
browser open it.

Your API keys, prompt template, per-site disable list, language preferences,
and the lookup cache are stored locally in your browser via chrome.storage.
They are never sent to any learnwithsoju server.

No analytics. No crash reporting. No telemetry of any kind.

---

## Category

**Recommendation: Education**

`Productivity` is a reasonable secondary option if Education is saturated,
but the primary use case — learning Korean vocabulary while reading and
watching — fits `Education` more precisely.

---

## Language(s)

- **Extension UI language:** English
- **Content language served:** Korean
- **Target users:** English-speaking Korean language learners

List in the dashboard: **English**, **Korean**

---

## Screenshots

> **Max: 5 screenshots at 1280×800 or 640×400 px**
> Actual screenshots to be captured from the live extension before submission.

<!-- TODO: capture all screenshots from a real browser session before submitting -->

**Screenshot 1 — Hover popup with morpheme breakdown**
Show the popup open over a conjugated Korean verb (e.g. 먹었어요) on a plain
Korean webpage or news article. The popup should display:
- The dictionary entry for the verb lemma (먹다)
- The morpheme breakdown strip expanded, showing tokens with POS glosses
  (past tense EP, polite EF, etc.)
- The "Ask AI" pill visible at the bottom

**Screenshot 2 — YouTube dual subtitles**
Show a YouTube video playing with:
- The video's native English subtitle line (or no native subs)
- The Korean dual-subs overlay line visible below the player controls
- If possible, the hover popup open over one Korean word in the overlay

**Screenshot 3 — Netflix dual subtitles**
Similar to Screenshot 2 but on Netflix. The Korean overlay should be clearly
visible against the video content. Keep the Netflix UI minimal to focus on
the subtitle overlay.

**Screenshot 4 — Options page**
Show the Options page with the KRDict API key field (value redacted with
asterisks or a placeholder), the secondary subtitle language selector, the
AI provider selector, and the three "Clear Cache" buttons. Demonstrates
user control over the extension's behavior.

**Screenshot 5 — Morpheme inspector**
Show the Morpheme Inspector page with a Korean phrase entered (e.g. 오늘도
열심히 공부해야 해요) and the per-token mecab field table fully expanded.
Communicates power-user depth without cluttering the main popup screenshots.

---

## Promotional Images

> **Small tile: 440×280 px (optional)**
> **Marquee: 1400×560 px (optional, required for featuring)**

<!-- TODO: design both images before submitting; brief below -->

**Small tile (440×280)**
Dark background. The learnwithsoju wordmark on one side; a cropped stylized
popup card showing a Korean word and its definition on the other. Keep it
legible at thumbnail size.

**Marquee (1400×560)**
Full-width hero. Left half: Korean sentence with one word highlighted and the
popup open. Right half: a YouTube frame showing the dual-subtitle overlay.
Tagline across the top: "Read Korean. Watch Korean. Learn Korean."

---

## Privacy Practices

Answers to the Chrome Web Store privacy disclosure questionnaire.

### Personally identifiable information

**Collected: NO.**

The extension does not collect, transmit, or process any personally
identifiable information. It does not know who you are.

### Health information

**Collected: NO.**

### Financial information

**Collected: NO.**

### Authentication information

**Collected: NO.**

The KRDict API key you enter is stored locally in chrome.storage and sent only
to krdict.korean.go.kr as a URL parameter in dictionary requests. It is not
sent to any learnwithsoju server.

### Personal communications

**Collected: NO.**

### Location

**Collected: NO.**

### Web history

**Collected: NO.**

### User activity

**Collected: NO.**

No clicks, interactions, or usage patterns are recorded or transmitted.

### Web content

**Read: YES — to detect Korean text on the current page.**
**Transmitted: NO.**

The content script reads the text of the page you are viewing in order to
detect Korean text and enable hover popups. That text is processed entirely
within your browser (by the local mecab-ko WASM module). No page text is
ever sent to any external server. Dictionary queries contain only the
lemmatized Korean word form, not surrounding sentence context.

### Remote code

**NO.**

All JavaScript and WebAssembly is bundled within the extension package and
served from the extension itself. The extension does not download or execute
any remote code at runtime. The content_security_policy in the manifest
restricts script sources to `'self'` and `'wasm-unsafe-eval'` (required for
the bundled WASM module); no external script sources are permitted.

### What data is sent over the network

1. Korean word lookups — the lemmatized word form sent to
   krdict.korean.go.kr (and optionally opendict.korean.go.kr) as a search
   query parameter. Request includes the user's own API key as a URL parameter.
   No identity or session data.

2. Hanja character lookups — a single character or short Sino-Korean string
   sent to hangulhanja.com when the user explicitly clicks the Hanja chip.

3. YouTube caption data — the extension fetches YouTube's /api/timedtext URLs
   (the same URLs the YouTube player fetches) to obtain the Korean caption
   track for the dual-subtitle overlay. No additional data is sent to YouTube
   beyond what a normal page load would send.

4. Ask AI — clicking the "Ask AI" button causes the user's own browser to
   open a new tab to ChatGPT/Claude/Gemini with a prompt URL parameter.
   The extension itself makes no API call to any AI service.

---

## Permissions Justifications

Taken from `extension/manifest.json` permissions and host_permissions.

**`storage`**
Saves user preferences (API keys, language settings, per-site disable list,
AI provider choice, prompt template) and the dictionary lookup cache. Without
this the user would need to re-enter their API key on every browser start.

**`unlimitedStorage`**
The dictionary response cache grows over time as the user looks up more words.
The standard storage quota (5 MB) is quickly exhausted by a learner who reads
Korean regularly; unlimitedStorage removes that cap.

**`activeTab`**
Allows the toolbar popup to read the URL and tab ID of the currently active
tab so it can: (a) display the correct per-site disable toggle, (b) send
messages to the content script running in that tab to query subtitle status on
YouTube and Netflix.

**`https://krdict.korean.go.kr/*` (host permission)**
Required to make dictionary lookup requests to the KRDict API. All lookups go
directly from your browser to NIKL's servers.

**`https://opendict.korean.go.kr/*` (host permission)**
Required for the optional OpenDict (우리말샘) fallback lookup. Only used if
the user has entered an OpenDict API key in Options.

**`https://hangulhanja.com/*` (host permission)**
Required to fetch per-character Hanja meanings when the user clicks the Hanja
chip on a Sino-Korean dictionary entry.

**`<all_urls>` (content script match)**
Korean text appears on any website — news sites, social media, webtoons,
online study tools, language-exchange platforms. The hover popup must work
everywhere, not just on a predefined list of sites. This is the standard
pattern for dictionary/reading-aid extensions.

---

## Single Purpose Statement

> Required by Chrome Web Store policy for extensions that request broad
> host permissions.

"Help Korean language learners by providing instant hover-popup definitions
and dual-language subtitles."

---

## Support URL

<!-- TODO: add support URL (GitHub issues page or dedicated support page) -->
https://github.com/abishake/learnwithsoju/issues

## Homepage URL

<!-- TODO: confirm once repo is public -->
https://github.com/abishake/learnwithsoju

---

*End of Chrome Web Store draft. Review all TODO markers before submitting.*
