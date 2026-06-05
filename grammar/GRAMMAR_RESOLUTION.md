# Grammar resolution — composable, extensible design

Status: **design / ideation** (not yet implemented beyond v0 prototype).

This document specifies a grammar identification system that can grow to cover
**any** Korean grammar pattern — including patterns that span words, merge
fundamentals (`어` + `요` → `~아/어요`), and compose from a shared building-block
library. It supersedes the ad-hoc matching in `extension/core/grammar-match.js`
as the target architecture.

Related: [`LEMMATIZATION.md`](LEMMATIZATION.md) (catalog + lemmatizer roadmap),
[`htsk_grammar_catalog.csv`](htsk_grammar_catalog.csv) (684 HTSK entries).

---

## 1. Problem statement

### What learners need

When hovering a word, the learner wants to know **which grammar constructions**
touch that word — not just which morphemes mecab split the surface into.

| Need | Example |
|---|---|
| Named textbook pattern | `~ㄹ/을 수 있다`, not bare `ㄹ` + `수` + `있` |
| Composed ending | `~았/었어요`, not `었` + `어` + `요` separately |
| Cross-word span | hover `갈` in `갈 수 있어요` → still `~ㄹ/을 수 있다` |
| Quote in sentence | surface realization: `갈 수 있` |
| Fundamentals optional | expand to see `ㄹ/을` + `수` + `있다` underneath |

### What we have today

| Layer | Scope | Limit |
|---|---|---|
| `grammar-glosses.js` | ~50 morpheme glosses | No pattern names, no composition |
| `grammar-match.js` v0 | Single 어절 token tail | No sentence context, flat variant lists |
| Ask AI prompt | Full sentence | Network, not instant, not structured |
| `htsk_grammar_catalog.csv` | 684 human entries | Not machine-matchable yet |

### Core insight

**Morpheme analysis and grammar identification are different problems.**

- **Morpheme breakdown** answers: "how did the analyzer carve this word?"
- **Grammar resolution** answers: "what constructions is this word participating in?"

Grammar resolution needs:

1. **Token evidence** (mecab) — forms + POS constraints
2. **Sentence context** — adjacent words for cross-word patterns
3. **A composable pattern library** — fundamentals that combine into named patterns
4. **An anchor** — which word/token the learner is asking about

---

## 2. Design principles

1. **Extensible by data, not by code.** Adding a grammar pattern should be a
   catalog entry (or fundamental + composition rule), not a code change.
2. **Composable.** Speech-level endings, tense, honorifics, connectives, and
   bound-noun chains are **fundamentals** that higher patterns reference.
3. **Sentence-aware.** Resolver input is a **context window**, not a single token list.
4. **Anchor-relative.** Every match is tied to the focus word; spans may extend
   forward/backward but the pattern "belongs to" the hover target.
5. **Graceful degradation.** No sentence → intra-word only. No neighbor tokens
   yet → show partial matches with "needs next word" hint.
6. **Experimental until proven.** Opt-in toggle; show confidence / experimental note.
7. **Shared inventory with lemmatizer.** The same compiled ending catalog serves
   grammar ID (Use A) and rule-based lemmatization (Use B in LEMMATIZATION.md).

---

## 3. Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        GrammarContext                            │
│  sentence {before, word, after}  +  focus word  +  token window │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   ContextBuilder (content.js)                    │
│  split sentence → word list → tokenize focus + neighbors         │
│  (lazy via background mecab-inspect, cached by surface)          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              TokenStream (flattened, word-boundary marked)       │
│  [w0:t0, w0:t1 | w1:t0 | w2:t0, w2:t1, w2:t2 | ...]             │
│  + focusStemIndex + focusWordIndex                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   GrammarResolver (pure function)                │
│  1. Cross-word patterns (longest span, anchor at focus)          │
│  2. Intra-word composed patterns                                 │
│  3. Optional: unresolved fundamentals (debug / advanced mode)    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     GrammarMatch[] → popup UI                    │
│  display, gloss, sentenceQuote, composeTree, lesson link         │
└─────────────────────────────────────────────────────────────────┘
```

**Catalog pipeline (offline):**

```
htsk_grammar_catalog.csv  ─┐
fundamentals.yaml         ─┼─►  compile-grammar.js  ─►  grammar.bundle.json
composition rules         ─┘         (CI / npm script)
```

Runtime loads `grammar.bundle.json` lazily when the experimental Grammar tab opens.

---

## 4. Core concepts

### 4.1 Fundamental (atom)

The smallest reusable grammatical unit. Fundamentals are **shared** — the same
`fund:polite_yo` appears inside `~아/어요`, `~았/었어요`, `~겠어요`, etc.

```json
{
  "id": "fund:polite_yo",
  "role": "speech_level",
  "display": "요",
  "gloss": "polite speech-level ending",
  "match": {
    "forms": [
      ["요"],
      ["어", "요"],
      ["아", "요"],
      ["여", "요"],
      ["어요"],
      ["아요"],
      ["여요"]
    ],
    "pos": ["EF"]
  }
}
```

Fundamentals match **form sequences** (fused or split) with optional POS hints.
They do not know about sentence context by themselves.

**Role taxonomy** (extensible):

| Role | Examples |
|---|---|
| `tense` | 았/었, 겠 |
| `speech_level` | 요, 습니다, 다 |
| `connective` | 아/어, 으 |
| `modifier` | ㄴ/은, ㄹ/을, 는 |
| `nominalizer` | 기, 음 |
| `particle` | 에, 에서, 을/를 |
| `bound_noun` | 수, 것, 적, 때 |
| `auxiliary` | 보, 주, 있다 |
| `honorific` | (으)시 |
| `nuance` | 네, 군, 죠/지 |

### 4.2 Slot

A position in a pattern that must be filled by a fundamental (or sub-pattern).
Slots can carry **word-offset** for cross-word matching.

```json
{
  "slot": "s1",
  "fundamental": "fund:bound_su",
  "wordOffset": 1,
  "required": true
}
```

- `wordOffset: 0` — same word as anchor (default)
- `wordOffset: 1` — next whitespace-delimited word
- `wordOffset: -1` — previous word (for `안 ~`, `못 ~` chains)

### 4.3 Pattern

A named grammar construction — either **atomic** (one fundamental promoted to
pattern for display) or **composed** (sequence of slots / sub-patterns).

```json
{
  "id": "pat:eul_su_itta",
  "display": "~ㄹ/을 수 있다",
  "gloss": "can / is able to",
  "lesson": 45,
  "link": "https://www.howtostudykorean.com/...",
  "anchor": {
    "word": "focus",
    "attach": "after_stem"
  },
  "span": {
    "wordsForward": 2,
    "wordsBackward": 0
  },
  "compose": [
    { "slot": "s0", "fundamental": "fund:etm_future" },
    { "slot": "s1", "fundamental": "fund:bound_su", "wordOffset": 1 },
    { "slot": "s2", "fundamental": "fund:verb_itda", "wordOffset": 1, "matchMode": "prefix" }
  ],
  "priority": 80
}
```

**`matchMode: prefix`** — for auxiliaries where mecab may split `있어요` →
`있` + `어요`; slot matches if the word's token stream *starts with* the
fundamental.

### 4.4 Composition (derived patterns)

Higher patterns **reference** lower ones without duplicating variant lists:

```json
{
  "id": "pat:past_polite",
  "display": "~았/었어요",
  "compose": [
    { "ref": "fund:past_tense" },
    { "ref": "fund:connective_aeo" },
    { "ref": "fund:polite_yo" }
  ],
  "derived": true
}
```

At compile time, the compiler **expands** derived patterns into concrete
form-sequence variants for fast matching, while keeping the compose tree for UI.

```
~았/었어요
├── 았/었/였  (past tense)
├── 아/어     (connective)
└── 요        (polite)
```

This is how we avoid hand-maintaining `[['었','어','요'], ['었','어요'], ...]`
for every combination — the compiler generates variants from fundamentals +
composition rules (including vowel harmony where rule-driven).

### 4.5 Anchor & span

Every pattern declares where it attaches:

| `attach` | Meaning |
|---|---|
| `after_stem` | Match begins at first suffix token after VV/VA/VX/NNG stem on focus word |
| `whole_word` | Pattern covers entire focus word (standalone particles, copula) |
| `before_stem` | Negation (`안`, `못`) on previous word or prefix |

| `span` | Meaning |
|---|---|
| `wordsForward: N` | May consume tokens from up to N following words |
| `wordsBackward: N` | May look at N preceding words |

Cross-word patterns **must** declare span explicitly. Intra-word patterns default
to `wordsForward: 0`.

---

## 5. GrammarContext — resolver input

```typescript
/** One whitespace-delimited 어절 in the sentence window */
type ContextWord = {
  index: number;           // position in word array
  surface: string;         // e.g. "있어요"
  isFocus: boolean;
  tokens: MecabToken[];    // lazily filled; [] until tokenized
};

type GrammarContext = {
  /** Focus word surface (hover target) */
  focusSurface: string;
  focusWordIndex: number;

  /** Words in the analysis window (typically focus ± 2) */
  words: ContextWord[];

  /** Flattened token stream for matching */
  stream: StreamToken[];

  /** Index in stream where focus word's stem ends / suffix begins */
  anchorIndex: number;

  /** Original sentence text, for quoting */
  sentence: { before: string; word: string; after: string } | null;
};

type StreamToken = {
  form: string;
  pos: string;
  wordIndex: number;
  tokenIndexInWord: number;
  streamIndex: number;
};
```

**ContextBuilder** responsibilities (content script):

1. Split `before + word + after` into word array (same rules as sentence band).
2. Locate focus index.
3. Take window `[focusIndex - W, focusIndex + W]` (default W=2).
4. Use focus tokens from lookup payload; tokenize neighbors via
   `{ type: 'mecab-inspect', text: surface }` (cached by surface in memory).
5. Flatten into `stream` with word-boundary metadata.
6. Compute `anchorIndex` — last stem token on focus word + 1.

If `sentence` is null, build single-word context (degraded mode).

---

## 6. Matching engine

### 6.1 Three-pass resolution

| Pass | Patterns | Strategy |
|---|---|---|
| **A — Cross-word** | `span.wordsForward > 0` | Anchor at focus suffix; match slots with wordOffset; longest span wins |
| **B — Intra-word composed** | `span.wordsForward === 0`, derived | Match from anchorIndex forward; greedy longest-first |
| **C — Residual fundamentals** | Optional / debug | Unmatched suffix tokens → show atom glosses only if no composed match covered them |

Pass A runs before B so `~ㄹ/을 수 있다` wins over bare `~ㄹ/을` modifier on `갈`.

### 6.2 Slot matching algorithm

For pattern P with compose slots `[s0, s1, ...]`:

```
cursor = anchorIndex
for each slot in order:
  wordBase = focusWordIndex + slot.wordOffset
  tokens = tokens of words[wordBase] (or stream slice for that word)
  match fundamental against tokens at cursor (or word start if wordOffset ≠ 0)
  if no match: pattern fails
  advance cursor past matched token span
return match success + matched ranges
```

**Longest-first:** when multiple patterns match, sort by:

1. Total matched token count (desc)
2. `priority` field (desc)
3. Cross-word span length (desc)
4. Pattern id (stable tie-break)

**Non-overlap:** matched token ranges are marked consumed. Lower-priority
patterns may not reuse those tokens (but a higher pattern and its compose tree
fully explain them).

### 6.3 Allomorph & harmony rules (compile-time)

Rather than enumerating every variant by hand, the compiler applies rules:

| Rule | Example |
|---|---|
| Vowel harmony | stem ㅏ/ㅗ → `아`, else → `어`; `하` → `여` |
| Consonant batchim | `(으)` slots present only after batchim |
| Fusion | `ㄹ/을` ETM fuses into stem — match on surface, not split form |
| Optional `(에)` | `때문` vs `때문에` — slot marked `optional: true` |

Rules live in `grammar/rules/` as small JS modules the compiler imports.
Fundamentals declare which rules apply via `"harmony": "aeo"` etc.

### 6.4 Output: GrammarMatch

```typescript
type GrammarMatch = {
  patternId: string;
  display: string;
  gloss: string;
  lesson?: number;
  link?: string;

  /** Surface text from the actual sentence (may span words) */
  sentenceQuote: string;

  /** Token ranges in stream (for highlighting) */
  ranges: { start: number; end: number; wordIndex: number }[];

  /** Composition tree for UI expand */
  compose: {
    fundamentalId: string;
    display: string;
    gloss: string;
    surface: string;
  }[];

  /** experimental metadata */
  confidence: 'high' | 'partial' | 'low';
};
```

**Confidence:**

| Level | When |
|---|---|
| `high` | All required slots matched, sentence available, focus anchored |
| `partial` | Pattern matched but neighbor word wasn't tokenized yet / optional slot skipped |
| `low` | Sentence-less fallback or ambiguous overlap |

---

## 7. Pattern library schema (formal)

### 7.1 Bundle file layout

```json
{
  "version": 1,
  "fundamentals": { "fund:polite_yo": { ... }, ... },
  "patterns": { "pat:past_polite": { ... }, ... },
  "compiled": {
    "pat:past_polite": {
      "variants": [["었","어","요"], ["었","어요"], ...],
      "compose": [ ... ]
    }
  }
}
```

Runtime matcher reads **`compiled`** for speed; UI reads **`patterns`** +
**`fundamentals`** for display and links.

### 7.2 Adding new grammar (author workflow)

1. **Check if fundamentals exist.** If not, add to `fundamentals.yaml`.
2. **Add pattern** referencing slots / compose refs in `patterns.yaml` (or CSV row mapped by compiler).
3. Run `npm run build:grammar` → updates `grammar.bundle.json`.
4. Add test case in `tests/grammar-fixtures/` (context + expected matches).
5. No extension code change.

### 7.3 CSV integration

Each HTSK CSV row maps to a pattern stub:

| CSV column | Pattern field |
|---|---|
| `grammar` | `display` (normalized: strip parens → slots) |
| `meaning` | `gloss` |
| `lesson`, `link` | carried through |
| `type` | hints `role`, `attach`, `span` defaults |

Human-authored rows like `~ㄴ/은 (형용사 → 명사 수식)` compile to:

- `display: ~ㄴ/은`
- `attach: after_stem`
- `posHint: VA|VV`
- `fundamental: fund:etm_past_modifier` (with allomorphs ㄴ/은)

Some CSV rows are **vocabulary / honorific verbs** (`드리다`) — compiler marks
them `"matchable": false` (reference links only, no morpheme matching).

---

## 8. Composition examples

### 8.1 Intra-word: ~겠어요

```
pat:future_polite
  compose: [ fund:future_gess, fund:connective_aeo, fund:polite_yo ]
  span: { wordsForward: 0 }
```

Matches: `겠어요` | `겠`+`어요` | `겠`+`어`+`요`

### 8.2 Cross-word: ~ㄹ/을 수 있다

```
pat:eul_su_itta
  compose:
    - fund:etm_future        @ focus+0
    - fund:bound_su          @ focus+1 (word "수")
    - fund:verb_itda         @ focus+1 prefix ("있...")
  span: { wordsForward: 2 }
```

Sentence: `갈 수 있어요`, focus `갈` → quote `갈 수 있`

### 8.3 Cross-word: ~ㄴ/은 적이 있다

```
pat:eun_jeogi_itta
  compose:
    - fund:etm_past_modifier @ focus+0
    - fund:bound_jeok        @ focus+1
    - fund:particle_i        @ focus+1
    - fund:verb_itda         @ focus+1 prefix
  span: { wordsForward: 2 }
```

### 8.4 Cross-word: ~고 있다

```
pat:go_itta
  compose:
    - fund:connective_go     @ focus+0  (or previous word if focus is auxiliary)
    - fund:verb_itda         @ focus+1 prefix
  span: { wordsForward: 1 }
```

Focus may be `공부` or `하고` depending on hover — anchor rules may need
**multiple anchor profiles** per pattern (`anchorProfiles: ['after_stem', 'on_connective']`).

### 8.5 Stacked patterns on one word

`먹었어요` may match:

1. `pat:past_polite` (composed: past + connective + polite) — **show this**
2. NOT also separate `pat:polite_present` on `어요` (consumed)

`먹기 때문에` in one word:

1. `pat:gi_tteumune` — full cross-morpheme match

---

## 9. UI integration

### 9.1 Grammar tab (experimental)

- Opt-in: `experimentalGrammarResolution` in settings.
- Lazy: build context + resolve only on tab click.
- Show loading while neighbor tokenization runs.

**Per match card:**

```
~ㄹ/을 수 있다                    HTSK L45 →
  "can / is able to"
  In this sentence: 갈 수 있
  ▼ Built from
    ㄹ/을  future modifier
    수     bound noun (ability)
    있다   exist → can
```

### 9.2 Relationship to Morpheme breakdown tab

| Tab | Purpose |
|---|---|
| Morpheme breakdown | Analyzer truth — what mecab saw |
| Grammar | Pedagogical patterns — named, composed, sentence-aware |

No duplication: grammar tab **supersedes** per-morpheme glosses for matched
ranges; breakdown tab stays raw.

### 9.3 Relationship to Ask AI

Grammar tab = instant, structured, offline-first preview.
Ask AI = open-ended deep dive. Link from pattern card: "Explain more →"

---

## 10. Implementation phases

### Phase 0 — v0 (done)

- Flat `variants` list, single-word, experimental toggle
- Proves UI wiring and user appetite

### Phase 1 — Context + fundamentals

- [ ] Define `GrammarContext` + `ContextBuilder`
- [ ] Neighbor tokenization (mecab-inspect + cache)
- [ ] Fundamentals registry (YAML → JSON)
- [ ] Compiler: expand compose → variants for intra-word patterns
- [ ] Replace flat list in `grammar-match.js` with compiled bundle

### Phase 2 — Cross-word patterns

- [ ] Slot matcher with `wordOffset`
- [ ] Sentence quote extraction
- [ ] First cross-word set: `~ㄹ/을 수 있다`, `~고 있다`, `~ㄴ/은 적이 있다`, `~아/어 보다`
- [ ] Fixture tests from real subtitle sentences

### Phase 3 — Full HTSK catalog

- [ ] CSV → pattern compiler pipeline
- [ ] Human review queue for ambiguous rows
- [ ] Coverage report (% of HTSK rows matchable)

### Phase 4 — Harmony & irregular rules in compiler

- [ ] Rule modules for aeo / (으) / fusion
- [ ] Derive variants from stems + rules instead of enumeration
- [ ] Shares rules with lemmatizer Use B

### Phase 5 — Advanced

- [ ] Multiple anchor profiles per pattern
- [ ] Backward span (`안`, `못`, `왜`)
- [ ] Pattern conflict explanations (why this match beat that)
- [ ] Morpheme inspector integration — show grammar matches alongside tokens

---

## 11. Testing strategy

### Fixture format

```json
{
  "name": "gal su isseoyo — focus gal",
  "sentence": { "before": "", "word": "갈", "after": " 수 있어요" },
  "words": {
    "갈": [["갈", "VV+ETM"]],
    "수": [["수", "NNB"]],
    "있어요": [["있", "VX"], ["어요", "EF"]]
  },
  "expect": [{
    "patternId": "pat:eul_su_itta",
    "sentenceQuote": "갈 수 있",
    "confidence": "high"
  }]
}
```

### Metrics

| Metric | Target |
|---|---|
| Intra-word composed recall | >95% on Phase-F manual test set |
| Cross-word recall (±2 window) | >85% on curated subtitle sample |
| False positive rate | <5% (wrong pattern name) |
| Latency (grammar tab) | <100ms after tokens cached |

---

## 12. Open design questions

1. **Window size W** — is ±2 words enough, or ±3 for rare long chains?
2. **Multi-pattern display** — show all non-overlapping matches, or cap at 3?
3. **Focus on particle** — hover `에서` in `학교에서`: anchor on particle or include noun?
4. **Spacing variants** — `먹기때문에` vs `먹기 때문에`: tokenizer may differ; match on stream or normalized surface?
5. **Third-party curricula** — bundle format versioned so TTMIK / KGIU patterns can ship as plugins?
6. **Korean UI** — display patterns in Korean (`~아/어요`) vs English (`polite present`)?

---

## 13. Comparison: approaches considered

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Flat variant lists** (v0) | Simple, fast to ship | Doesn't scale; no compose; no cross-word | Prototype only |
| **B. Slot + fundamental registry** | Extensible, composable, testable | Needs compiler + schema upfront | **Recommended core** |
| **C. Full NLP pipeline (Kiwi sentence parse)** | Highest accuracy | +34 MB, LGPL, overkill for hover | Fallback only |
| **D. LLM grammar ID** | Handles anything | Network, slow, non-deterministic | Ask AI, not local resolver |

**Recommendation:** **B** for local resolution, with sentence context built from
existing mecab per-word tokenization. Kiwi stays optional future fallback for
hard cases behind "max accuracy" toggle.

---

## 14. File map (target state)

```
grammar/
  GRAMMAR_RESOLUTION.md     ← this document
  LEMMATIZATION.md          ← lemmatizer / catalog roadmap
  htsk_grammar_catalog.csv  ← human source
  fundamentals.yaml         ← atom definitions (to add)
  patterns.yaml             ← composed patterns (to add)
  rules/                    ← harmony, fusion, batchim (to add)
  grammar.bundle.json       ← compiled output (gitignored or committed)

extension/core/
  grammar-context.js        ← ContextBuilder
  grammar-resolve.js        ← slot matcher (replaces grammar-match.js)
  grammar-glosses.js          ← morpheme chips (unchanged role)

scripts/
  compile-grammar.js          ← CSV/YAML → bundle

tests/
  grammar-fixtures/*.json
  grammar-resolve.test.js
```

---

## 15. Summary

Grammar resolution is a **sentence-aware, composable pattern matcher** over a
**fundamentals library**, not a morpheme gloss table. The v0 prototype validates
UI and composition intuition; the path to full HTSK coverage runs through:

1. **GrammarContext** (focus + window + token stream)
2. **Fundamentals + slots + compose** (data-driven extensibility)
3. **Compile-time variant expansion** (scale without hand-enumeration)
4. **Cross-word spans** (patterns that respect word boundaries)
5. **Shared catalog** with the future rule-based lemmatizer

Any grammar — including ones not yet written — fits by adding fundamentals and
a pattern that composes them. Code changes should only be needed for new *rule
types* (harmony, fusion), not for new *patterns*.
