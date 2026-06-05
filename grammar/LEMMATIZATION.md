# Grammar catalog → grammar identification & lemmatization

Status: Phase 1 v0 in progress — experimental grammar tab behind opt-in toggle.
Phase 2+ (rule-based lemmatizer) still design-only.

This directory holds a curated catalog of Korean grammar and a plan for putting
it to work in the extension. Two goals, one near-term and one strategic:

1. **Grammar identification (near-term).** Use the catalog to tell the learner
   *what grammar* a hovered phrase contains — expanding the popup's existing
   morpheme glosses from ~50 hand-curated entries to the full HTSK inventory,
   including multi-morpheme patterns mecab splits apart (`~기 때문에`,
   `~ㄹ 수 있다`).
2. **Lighter lemmatization (strategic).** Use the catalog as the ending
   inventory for a **rule-based lemmatizer** that could let us drop, or lazily
   defer, the ~21 MB mecab-ko-dic — the single biggest asset the extension
   ships.

---

## Contents

| File | What |
|---|---|
| `htsk_grammar_catalog.csv` | 684 grammar entries from HowToStudyKorean Lessons 1–200. Columns: `grammar, type, meaning, lesson, link`. Every grammar-bearing lesson is covered (Lesson 151 is onomatopoeia vocab, no grammar). |

The CSV is **human-readable, not machine-matchable** — see
[§6 Catalog → machine-readable patterns](#6-catalog--machine-readable-patterns).

---

## 1. How lemmatization works today

End-to-end (see `docs/MECAB_INTEGRATION.md`):

```
hover 어절
  → content.js sendMessage({type:'lookup', surface})
  → background.js ensureMecab()           # first hover only: init WASM + gunzip dict
  → mecab.tokenize(surface)               # POS-tagged morphemes
  → lemmaCandidates(tokens, surface)      # extension/lemmatizer.js → ordered candidates
  → KRDict / OpenDict lookup              # FIRST HIT WINS
  → popup render (+ morpheme chips glossed by extension/grammar-glosses.js)
```

What it costs:

| Asset | Size | Notes |
|---|---|---|
| `mecab_ko_wasm_bg.wasm` | 145 KB | engine — cheap |
| `sys.dic.gz` | 9.3 MB | **dictionary — the weight** |
| `matrix.bin.gz` | 2.5 MB | connection-cost matrix |
| `entries.bin.gz` | 9.7 MB | dictionary entries |
| First-hover latency | ~1–2 s | fetch + gunzip + init; instant after |

The engine is tiny; **the ~21 MB is almost entirely the dictionary.** That is
the thing worth attacking.

### Two pieces of existing code the catalog touches

- **`extension/lemmatizer.js`** — pure function `lemmaCandidates(tokens, surface)`.
  Walks mecab tokens, turns verb/adjective stems into `stem + 다`, keeps nouns,
  skips particles/endings, and **always appends the surface as a fallback
  candidate**. Crucially the caller tries candidates against KRDict in order and
  takes the first hit. **This is already a generate-and-validate design** — the
  lemmatizer only needs *recall* (propose the right form somewhere), and KRDict
  supplies *precision*. That property is what makes a rule-based replacement
  viable (see §3).
- **`extension/grammar-glosses.js`** — ~50 hand-curated glosses for the
  commonest particles/endings (`에서` → "from / at (action)", `으니까` →
  "because", …), two-tier lookup (exact form, then POS fallback), used to
  annotate the morpheme chips. **The catalog is a 13× superset of this table.**

---

## 2. Use A — grammar identification (near-term, low-risk)

**Status:** v0 shipped behind **Settings → Experimental grammar resolution**
(opt-in). See `extension/core/grammar-match.js`.

**Target architecture:** [`GRAMMAR_RESOLUTION.md`](GRAMMAR_RESOLUTION.md) —
composable fundamentals, sentence context, cross-word spans, compiled catalog.

The catalog's first, easiest payoff is feeding `grammar-glosses.js` and a
dedicated **Grammar** tab in the popup.

### Compositional matching

Mecab often splits endings that learners read as one unit — `어` + `요`, `지`
+ `요`, `었` + `어요`. The experimental resolver **merges fundamentals into
one named pattern** instead of listing each morpheme separately:

| mecab tail | merged pattern |
|---|---|
| `었` + `어요` | ~았/었어요 — past tense, polite |
| `어` + `요` / `어요` | ~아/어요 — polite present |
| `지` + `요` / `죠` | ~죠 / ~지요 — confirming |
| `기` + `때문` + `에` | ~기 때문에 — because |

Each hit can optionally show **fundamentals** (the building blocks) beneath
the composed gloss, so learners see both the textbook pattern name and how
mecab carved it up.

- **Single morphemes:** the catalog already covers (with richer meanings) most
  of what's hand-curated today, plus hundreds more particles/endings the popup
  currently falls back to a bare POS label for.
- **Multi-morpheme patterns:** the higher-value win. mecab splits `먹기 때문에`
  into `먹` / `기` / `때문` / `에`; the learner sees four chips but the *grammar*
  is one construction, `~기 때문에` ("because"). The catalog enumerates these
  patterns, so after tokenizing we can run a **longest-match pass over the
  morpheme sequence** and surface "**~기 때문에** — because" as a single grammar
  note alongside the per-morpheme chips.

This needs no change to the lemmatization backend and carries no accuracy risk —
it's additive annotation. It is also the most direct expression of the stated
aim ("identify the grammar involved").

**Prerequisite:** the normalized pattern form (§6), so patterns match real
tokenized text rather than the human-readable `~기 때문에` string.

---

## 3. Use B — rule-based lemmatizer (strategic)

### The key finding from the options survey

None of the off-the-shelf statistical analyzers shrink the footprint, because
the weight is the dictionary/LM, not the engine:

| Option | Engine | Dict / model | Footprint vs today | License | Verdict |
|---|---|---|---|---|---|
| **mecab-ko WASM** (status quo) | 145 KB | mecab-ko-dic ~21 MB gz | — (baseline) | BSD/GPL/LGPL mix | Fastest, proven, heavy. The bar to beat. |
| **Lindera** (`lindera-wasm`) | small | **same** ko-dic, ~9–15 MB, loaded fully into memory | ≈ no win | **MIT** | Cleaner/maintained engine, but same data → no size win. |
| **Kiwi** (`kiwi-nlp` WASM) | small | LM **~34 MB** | **larger** | **LGPL-v3** | Best accuracy + official browser build, but bigger and more encumbered. |
| **Rule-based stripper + KRDict** | few KB JS + catalog + jamo lib | **none** (reuses KRDict) | **drops ~21 MB** | our code + MIT deps | Only real footprint win; plays to existing validation. |

Sources: Lindera [github.com/lindera/lindera](https://github.com/lindera/lindera),
[lib.rs/crates/lindera-ko-dic](https://lib.rs/crates/lindera-ko-dic),
full-dict-in-memory [issue #437](https://github.com/lindera/lindera/issues/437);
Kiwi [github.com/bab2min/Kiwi](https://github.com/bab2min/Kiwi),
[kiwi-nlp](https://www.jsdelivr.com/package/npm/kiwi-nlp); mecab-ko-dic size
[Elastic Nori](https://www.elastic.co/blog/nori-the-official-elasticsearch-plugin-for-korean-language-analysis).

**Conclusion: the only path that meaningfully drops the dictionary is the
rule-based one — and it's the one our generate-and-validate pipeline is already
shaped for.**

### Prior art (don't invent this from scratch)

`lovit/korean_lemmatizer` (packaged as `soylemma`) is the canonical Korean
reverse-conjugation lemmatizer and documents exactly the design we'd want:
split the word at every cut point into `(stem L, ending R)`, **validate L
against a stem set and R against an ending set**, and only keep pairs where both
exist.
- Write-up: <https://lovit.github.io/nlp/2018/06/07/lemmatizer/>
- Code: <https://github.com/lovit/korean_lemmatizer> · <https://pypi.org/project/soylemma/>

For us, **the "ending set" is the HTSK catalog**, and **the "stem set" oracle is
KRDict** (we already query it).

### Architecture sketch

```
surface 어절
  → for each cut point (L = candidate stem, R = candidate ending):
        - is R in the ending catalog?            (longest-match-first)
        - reverse jamo fusion + irregulars on L  (recover dictionary stem)
        - emit candidate lemma  L' + 다  (or L' for nouns)
  → ordered candidate list (by ending length / specificity)
  → KRDict lookup, first hit wins   ← already implemented
  → mecab fallback ONLY if no candidate validates (lazy-load the 21 MB then)
```

The three hard parts, all solved in prior art:

1. **Ending inventory + longest-match-first.** Straight from the catalog. Prefer
   `~습니다` over `~습`, `~ㄹ 수밖에 없다` over `~ㄹ 수 있다`'s shape, etc.
2. **Jamo fusion.** Endings starting with ㄴ/ㄹ/ㅁ/ㅆ fuse into the stem's final
   syllable as a 받침 (`가`+`ㄹ`→`갈`, `살`+`ㅁ`→`삶`, `입`+`니다`→`입니다`). You
   must decompose/recompose syllables via the Unicode Hangul algorithm. Use
   **es-hangul** (MIT, maintained, also does josa selection by final consonant):
   <https://github.com/toss/es-hangul>.
3. **Irregular reversal (ㅂ/ㄷ/ㅅ/르/ㅎ/ㅡ/우·러).** A small enumerable rule set;
   lovit publishes concrete reverse rules (e.g. ㄷ-irregular: L ends in ㄹ + R
   starts with a vowel → restore ㄹ→ㄷ, `깨달아`→`깨닫`+`아`). **The catalog's
   own `~불규칙` rows are the human-readable spec for these rules.**

### Why generate-and-validate makes this tractable

The classic blocker for surface-only lemmatization is that **the same change can
be regular or irregular depending on the lexeme** — `묻다` "ask" is ㄷ-irregular
(`물어`) but `묻다` "bury" is regular (`묻어`); you can't decide from the surface.
The generate-and-validate pattern sidesteps this: over-generate cheap
candidates, let **KRDict** be the arbiter. We already do this. So the rule engine
only has to *propose*, not *decide*.

---

## 4. What the catalog can and can't do

| | Catalog-driven rule engine | Needs the statistical dict |
|---|---|---|
| Strip & identify endings/particles | ✅ (this is its job) | |
| Verb/adjective → dictionary form | ✅ (reverse rules + KRDict validate) | |
| Multi-morpheme grammar patterns | ✅ (longest-match) | |
| **Which substring is the content word** (segmenting `학교에서` → `학교`+`에서`, or an unknown compound) | ⚠️ tractable for *one hovered word* (longest KRDict-valid prefix) | ✅ this is most of mecab-ko-dic's bulk |
| Unknown / OOV content words, neologisms | ❌ | ⚠️ (also struggles; soynlp-style cohesion is the alternative) |

The catalog replaces the **inflectional** half of the analyzer. It does **not**
contain a content-word lexicon — for a single hovered 어절 we can lean on KRDict
("try the longest prefix that's a real headword, strip the rest as ending"), but
for unsegmentable runs and OOV words a dictionary is still the safety net. Hence
the recommendation keeps mecab as a **lazy fallback**, not a hard dependency.

---

## 5. Recommendation & phased roadmap

**Keep mecab, but demote it to a lazy fallback behind a tiny rule-based path.**
The common hover (regular conjugation, a particle, a familiar ending) should be
served by the catalog + KRDict in a few KB and never pay the 21 MB / 1–2 s cost;
mecab loads only when the cheap path fails to validate.

- **Phase 1 — grammar identification (Use A).** Derive the normalized pattern
  set (§6); extend `grammar-glosses.js` to gloss full catalog entries and
  longest-match multi-morpheme patterns over mecab's existing tokens. Additive,
  no backend change, no accuracy regression. Highest value-to-risk.
- **Phase 2 — rule engine, shadow mode.** Build the ending-stripper
  (catalog + es-hangul + irregular reverse rules) as a pure function mirroring
  `lemmaCandidates`'s contract. Run it **alongside** mecab and log where the two
  candidate lists agree/disagree against KRDict outcomes. No user-facing change.
- **Phase 3 — rule engine first, mecab fallback.** Flip the order: try the rule
  engine + KRDict first; lazy-load mecab only on miss. Measure the hit rate and
  how often mecab is still needed.
- **Phase 4 — (maybe) drop mecab.** If Phase 3 shows mecab is rarely the
  decider, ship without the 21 MB dict (or behind an opt-in "max accuracy"
  toggle). If we still want a maintained statistical engine for the fallback,
  **Lindera (`lindera-wasm`, MIT)** is the cleaner swap; **Kiwi (`kiwi-nlp`)**
  the higher-accuracy option if LGPL-v3 + ~34 MB is acceptable.

---

## 6. Catalog → machine-readable patterns

The CSV's `grammar` column is for humans (`ㄴ/은 (형용사 → 명사 수식)`,
`~기 때문에`). To drive matching/stripping we need a derived JSON keyed back to
each CSV row, with per entry:

- `pattern` — normalized surface skeleton (allomorph alternations made explicit).
- `allomorphs` — concrete variants chosen by the preceding jamo (`은/는`,
  `았/었/였`, `(으)면`).
- `fusionClass` — none / ㄴ / ㄹ / ㅁ / ㅆ (how it merges into the 받침).
- `attachesTo` — verb / adjective / noun / 이다 / clause.
- `stemTransform` — for endings, how to recover the dictionary stem (incl.
  irregular class).
- `posHint` + `gloss` + `lesson`/`link` — carried through for the popup.

Building this derived file is the prerequisite for **both** Use A and Use B. The
CSV stays the source of truth / human reference; the JSON is the compiled
artifact.

---

## 7. Accuracy & evaluation

- **Gold standard:** the Sejong corpus is the standard morphological benchmark;
  metric is morpheme-level precision/recall/F1 (segment **and** POS must match).
- **Our own metric that matters more:** lemma resolution rate on *real hovered
  words* — does the candidate list contain the form KRDict resolves to? Build a
  small gold set from actual usage (the Phase-F manual test table in
  `docs/MECAB_INTEGRATION.md` is a seed) and track rule-engine-vs-mecab on it.
- **Known failure modes** to watch: spacing/segmentation ambiguity, OOV content
  words, regular-vs-irregular homographs (§3). For a one-word popup these are far
  milder than for full-sentence parsing.

---

## References

- lovit Korean lemmatizer (generate-and-validate, irregular reverse rules, jamo fusion): <https://lovit.github.io/nlp/2018/06/07/lemmatizer/> · <https://github.com/lovit/korean_lemmatizer> · <https://pypi.org/project/soylemma/>
- es-hangul (jamo decompose/compose, josa selection; MIT): <https://github.com/toss/es-hangul>
- Lindera (Rust, ko-dic, WASM, MIT): <https://github.com/lindera/lindera> · <https://lib.rs/crates/lindera-ko-dic> · <https://github.com/lindera/lindera/issues/437>
- Kiwi (C++/WASM, accuracy, LGPL-v3): <https://github.com/bab2min/Kiwi> · <https://www.jsdelivr.com/package/npm/kiwi-nlp>
- mecab-ko-dic size & Korean analysis: <https://www.elastic.co/blog/nori-the-official-elasticsearch-plugin-for-korean-language-analysis>
- Analyzer comparison (speed ranking, practitioner summary): <https://www.blog.cosadama.com/articles/2021-practicenlp-01/>
- Resource-based Korean morphological annotation: <https://arxiv.org/pdf/0711.3412> · <https://arxiv.org/pdf/0711.3453>
- HTSK source: <https://www.howtostudykorean.com/>
